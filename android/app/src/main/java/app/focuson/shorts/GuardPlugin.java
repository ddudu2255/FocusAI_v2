package app.focuson.shorts;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONException;

@CapacitorPlugin(name = "HanbakjaGuard")
public class GuardPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", isServiceEnabled());
        ret.put("pendingTarget", GuardState.pendingTarget(getContext()));
        ret.put("pendingLevel", GuardState.pendingLevel(getContext()));
        ret.put("pendingUsageSeconds", GuardState.pendingUsage(getContext()));
        ret.put("watching", GuardState.activeSession(getContext()) != null);
        ret.put("blockerEnabled", GuardState.isBlockerEnabled(getContext()));
        ret.put("blockedUntil", GuardState.blockedUntil(getContext()));
        ret.put("blockMinutes", GuardState.blockMinutes(getContext()));
        ret.put("appVersion", appVersion());
        call.resolve(ret);
    }

    @PluginMethod
    public void setBlocker(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        GuardState.setBlockerEnabled(getContext(), enabled);
        JSObject ret = new JSObject();
        ret.put("blockerEnabled", GuardState.isBlockerEnabled(getContext()));
        call.resolve(ret);
    }

    /**
     * Hands the service the thresholds and the seconds the web counted itself today,
     * and returns everything queued since the last {@link #ack}.
     */
    @PluginMethod
    public void sync(PluginCall call) {
        int level1 = call.getInt("level1Threshold", GuardState.level1Minutes(getContext()));
        int level3 = call.getInt("level3Threshold", GuardState.level3Minutes(getContext()));
        String webDate = call.getString("webDate", "");
        Double webSeconds = call.getDouble("webSeconds", 0.0);
        GuardState.setConfig(getContext(), level1, level3, webDate, webSeconds == null ? 0 : webSeconds);
        JSObject policy = call.getObject("policy");
        JSArray cards = call.getArray("cards");
        GuardState.setPolicyAndCards(
            getContext(),
            policy == null ? null : policy.toString(),
            cards == null ? null : cards.toString());
        try {
            call.resolve(JSObject.fromJSONObject(GuardState.peekPending(getContext())));
        } catch (JSONException e) {
            call.reject("대기 중인 기록을 읽지 못했습니다.");
        }
    }

    /** The web side stored these rows in SQLite; drop them from the queue. */
    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<String> set = new HashSet<>();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, "");
                if (!id.isEmpty()) set.add(id);
            }
        }
        GuardState.ack(getContext(), set);
        call.resolve();
    }

    @PluginMethod
    public void finish(PluginCall call) {
        String outcome = call.getString("outcome", "");
        String target = call.getString("target", "");
        if (!"youtube".equals(target) && !"instagram".equals(target)) {
            call.reject("대상 앱이 없습니다.");
            return;
        }
        android.content.Context host = getActivity() != null ? getActivity() : getContext();
        if ("watch".equals(outcome)) {
            ShortsGuardService.requestWatch(getContext(), target);
            if ("instagram".equals(target) && getActivity() != null) {
                getActivity().moveTaskToBack(true);
            }
        } else if ("leave".equals(outcome)) {
            ShortsGuardService.requestLeave(host, target);
        } else if ("block".equals(outcome)) {
            int minutes = call.getInt("blockMinutes", 0);
            boolean dayEnd = Boolean.TRUE.equals(call.getBoolean("dayEnd", false));
            if (minutes > 0) {
                long until = GuardState.startBlockUntil(
                    getContext(), System.currentTimeMillis() + minutes * 60_000L, minutes, dayEnd);
                ShortsGuardService.onBlockStarted(getContext(), until);
            }
            ShortsGuardService.requestLeave(host, target);
        } else {
            call.reject("알 수 없는 결과입니다.");
            return;
        }
        call.resolve();
    }

    /** Starts a time block from the web side without an open prompt (e.g. practice flow). */
    @PluginMethod
    public void startBlock(PluginCall call) {
        int minutes = call.getInt("minutes", 0);
        if (minutes <= 0) {
            call.reject("차단 시간이 없습니다.");
            return;
        }
        long until = GuardState.startBlock(getContext(), minutes, System.currentTimeMillis());
        ShortsGuardService.onBlockStarted(getContext(), until);
        JSObject ret = new JSObject();
        ret.put("blockedUntil", until);
        call.resolve(ret);
    }

    @PluginMethod
    public void resetRecords(PluginCall call) {
        GuardState.resetRecords(getContext());
        GuardNotifier.cancelLock(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private String appVersion() {
        try {
            PackageInfo info = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    private boolean isServiceEnabled() {
        String enabled = Settings.Secure.getString(
            getContext().getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (TextUtils.isEmpty(enabled)) return false;
        String id = getContext().getPackageName() + "/" + ShortsGuardService.class.getName();
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            if (id.equalsIgnoreCase(splitter.next())) return true;
        }
        return false;
    }
}
