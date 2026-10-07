package app.focuson.shorts;

import android.accessibilityservice.AccessibilityService;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Toast;
import java.util.Calendar;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

/**
 * Notices the YouTube Shorts player and the Instagram Reels player.
 * - Locked: lock sheet over the player, then leave.
 * - YouTube: pause (audio focus + mute + media key), then a bottom sheet over the player
 *   whose steps come from {@link GuardFlow} and the policy table. A chosen watch time
 *   ("몇 분 볼래요?") is timed; when it is over the sheet comes back.
 * - Instagram: the web flow in ShortsAI, as before.
 * Watch time is recorded per stay with real start and end times.
 * Resource ids and package names only. Screen text is not read or stored.
 */
public class ShortsGuardService extends AccessibilityService {
    /** adb logcat -s ShortsAIGuard. Debuggable builds only; view ids and states, no screen text. */
    static final String TAG = "ShortsAIGuard";

    private static final long EVALUATE_DELAY_MS = 150L;
    private static final long LEAVE_CHECK_MS = 800L;
    /** After "watch" in the web flow, the player must be reopened within this window. */
    private static final long ALLOW_WINDOW_MS = 15_000L;
    /** Leaving during a commitment and coming back within this keeps the commitment. */
    private static final long RESUME_WINDOW_MS = 10 * 60_000L;
    /** After "나가기" from a PIP window that stays open, ask once more after this. */
    private static final long PIP_LEAVE_WAIT_MS = 60_000L;
    /** Time for YouTube to come to the front before checking whether the PIP expanded. */
    private static final long PIP_EXPAND_CHECK_MS = 900L;
    /** An alarm this far ahead counts as tomorrow's wake-up for the sleep line. */
    private static final long ALARM_HORIZON_MS = 12 * 3600_000L;

    private static WeakReference<ShortsGuardService> instance = new WeakReference<>(null);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ShortsSessionTracker tracker;
    private GuardOverlay overlay;
    /** Windows that do not mean "left the player": system UI and keyboards. */
    private Set<String> passThroughPackages = new HashSet<>();
    private boolean destroyed;
    private boolean closing;
    private boolean evaluatePending;
    private int missedPromptChecks;
    private String lastVerdictLog;

    /** Set while "나가기" is in progress, to tell a failed BACK from coming back in. */
    private String leavingKind;
    private boolean sawOtherSinceLeave;

    private GuardFlow flow;

    /** Running watch-time commitment ("몇 분 볼래요?"). */
    private String commitKind;
    private int commitMinutes;
    private int commitExtension;
    private boolean commitOverdraft;
    private int commitBand;
    private long commitEndsAt;

    /** A commitment cut short by leaving; resumed if the user is back within 10 minutes. */
    private String pausedKind;
    private long pausedRemainingMs;
    private long pausedAt;

    /** Shorts went to a picture-in-picture window and is still playing there. */
    private boolean inPip;
    /**
     * "나가기" was chosen while Shorts played in PIP and the window is still open.
     * One PIP episode (until the window closes or the stay ends) gets at most one expand
     * attempt and one second ask; nothing here repeats on a timer.
     */
    private boolean pipLeaving;
    private long pipLeftAt;
    private boolean pipExpandTried;
    private boolean pipReasked;
    private boolean pipKeptWatching;

    private AudioFocusRequest focusRequest;
    private boolean holdingFocus;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> { };

    private final Runnable commitTimer = this::onCommitmentOver;

    private final Runnable evaluateRunnable = () -> {
        evaluatePending = false;
        evaluate();
    };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (destroyed) return;
            try {
                tick();
            } finally {
                if (!destroyed) mainHandler.postDelayed(this, 1000);
            }
        }
    };

    private final Runnable leaveCheck = () -> {
        String kind = leavingKind;
        if (kind == null) return;
        if (!sawOtherSinceLeave && kind.equals(classifyActiveWindow())) {
            log("나가기: BACK 후에도 플레이어 → HOME");
            performGlobalAction(GLOBAL_ACTION_HOME);
            // Keep ignoring the player until HOME has taken effect.
            mainHandler.postDelayed(this::clearLeaving, LEAVE_CHECK_MS);
            return;
        }
        clearLeaving();
    };

    private void clearLeaving() {
        leavingKind = null;
        restoreAudio(false);
    }

    // --- Called from GuardPlugin (web flow results) ----------------------------

    static void requestLeave(Context context, String target) {
        log(context, "나가기 요청: " + target);
        GuardState.clearPrompt(context);
        if ("youtube".equals(target)) return;
        if (context instanceof android.app.Activity) {
            ((android.app.Activity) context).moveTaskToBack(true);
        }
        ShortsGuardService service = instance.get();
        if (service != null) service.leaveReelsThenReturn();
    }

    static void requestWatch(Context context, String target) {
        log(context, "시청 허용: " + target);
        GuardState.clearPrompt(context);
        GuardState.allow(context, target, System.currentTimeMillis() + ALLOW_WINDOW_MS);
        if ("youtube".equals(target)) openYoutubeShorts(context);
    }

    static void onBlockStarted(Context context, long blockedUntil) {
        log(context, "시간 차단 시작: " + GuardCopy.countdown(blockedUntil - System.currentTimeMillis()));
        GuardNotifier.showLock(context, blockedUntil);
    }

    // --- Lifecycle -------------------------------------------------------------

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        destroyed = false;
        instance = new WeakReference<>(this);
        passThroughPackages = buildPassThroughPackages();
        tracker = new ShortsSessionTracker(mainHandler, this::classifyActiveWindow, trackerListener);
        overlay = new GuardOverlay(this, mainHandler);
        flow = new GuardFlow(this, overlay, mainHandler, flowHost);
        // A previous run may have died with the music stream muted.
        restoreAudio(false);

        GuardState.ActiveSession stale = GuardState.activeSession(this);
        if (stale != null) {
            double seconds = GuardState.endSession(this, stale.lastSeenAt);
            log("이전 세션 정리: " + stale.target + " " + Math.round(seconds) + "초");
        }
        long until = GuardState.blockedUntil(this);
        if (until > System.currentTimeMillis()) GuardNotifier.showLock(this, until);

        mainHandler.removeCallbacks(tick);
        mainHandler.postDelayed(tick, 1000);
        log("서비스 연결됨");
    }

    @Override
    public boolean onUnbind(Intent intent) {
        cleanUp();
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        cleanUp();
        super.onDestroy();
    }

    private void cleanUp() {
        if (destroyed) return;
        destroyed = true;
        mainHandler.removeCallbacksAndMessages(null);
        if (overlay != null) overlay.dismissNow();
        restoreAudio(false);
        if (tracker != null) tracker.release();
        GuardState.endSession(this, System.currentTimeMillis());
        ShortsGuardService current = instance.get();
        if (current == this) instance = new WeakReference<>(null);
    }

    @Override
    public void onInterrupt() {}

    // --- Events and samples ----------------------------------------------------

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || destroyed) return;
        CharSequence packageChars = event.getPackageName();
        if (packageChars == null) return;
        String packageName = packageChars.toString();
        if (GuardScreens.isWatchedPackage(packageName)) {
            scheduleEvaluate();
            return;
        }
        if (passThroughPackages.contains(packageName)) return;
        // Another app's window (or a toast) changed. Check which app is really in front
        // before ending the stay, so a toast over Shorts does not end it.
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            && tracker.currentKind() != null) {
            scheduleEvaluate();
        }
    }

    /** Folds a burst of events into one check. */
    private void scheduleEvaluate() {
        if (evaluatePending) return;
        evaluatePending = true;
        mainHandler.postDelayed(evaluateRunnable, EVALUATE_DELAY_MS);
    }

    /** Samples the window in front: a watched app's screen, or another app that ends the stay. */
    private void evaluate() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            CharSequence packageChars = root.getPackageName();
            if (packageChars == null) return;
            String packageName = packageChars.toString();
            if (GuardScreens.isWatchedPackage(packageName)) {
                inPip = false;
                sample(classifyNode(root), packageName);
            } else if (!passThroughPackages.contains(packageName) && tracker.currentKind() != null) {
                leftOrPip();
            }
        } finally {
            root.recycle();
        }
    }

    /** Once a second while on a player or recording: screen off and other apps end the stay. */
    private void tick() {
        checkPipLeave(System.currentTimeMillis());
        String current = tracker == null ? null : tracker.currentKind();
        if (current == null && GuardState.activeSession(this) == null) return;
        long now = System.currentTimeMillis();
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null && !power.isInteractive()) {
            if (current != null) tracker.onLeftApp("화면 꺼짐", now);
            else GuardState.endSession(this, now);
            return;
        }
        String packageName = activePackage();
        if (packageName == null || passThroughPackages.contains(packageName)) return;
        if (GuardScreens.isWatchedPackage(packageName)) {
            evaluate();
        } else if (current != null) {
            leftOrPip();
        } else {
            GuardState.endSession(this, now);
        }
        if (tracker.currentKind() != null) GuardState.touchSession(this, now);
    }

    /**
     * Another app is in front. If the YouTube Shorts we were tracking went to a
     * picture-in-picture window, the stay goes on; otherwise it ends. Only the PIP
     * window's package is checked; other windows are not opened or logged.
     */
    private void leftOrPip() {
        if ("youtube".equals(tracker.currentKind()) && youtubePipVisible()) {
            if (!inPip) log("PIP: 작은 창으로 계속 시청");
            inPip = true;
            tracker.onSample("youtube", System.currentTimeMillis());
            return;
        }
        inPip = false;
        tracker.onLeftApp("다른 앱", System.currentTimeMillis());
    }

    private boolean youtubePipVisible() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        List<AccessibilityWindowInfo> windows;
        try {
            windows = getWindows();
        } catch (RuntimeException e) {
            return false;
        }
        for (AccessibilityWindowInfo window : windows) {
            if (!window.isInPictureInPictureMode()) continue;
            AccessibilityNodeInfo root = window.getRoot();
            if (root == null) continue;
            try {
                CharSequence pkg = root.getPackageName();
                if (pkg != null && GuardScreens.YOUTUBE.equals(pkg.toString())) return true;
            } finally {
                root.recycle();
            }
        }
        return false;
    }

    /** While waiting for the user to close a PIP window after "나가기". Called once a second. */
    private void checkPipLeave(long now) {
        if (!pipLeaving) return;
        if (!youtubePipVisible()) {
            pipLeaving = false;
            restoreAudio(false);
            log("PIP 닫힘: 소리 되돌림");
            return;
        }
        if (!pipReasked && now - pipLeftAt >= PIP_LEAVE_WAIT_MS && "youtube".equals(tracker.currentKind())) {
            pipReasked = true;
            pipLeaving = false;
            log("PIP 1분: 한 번만 다시 묻기");
            pausePlayback();
            GuardPolicy policy = GuardState.policy(this);
            double usage = GuardState.todaySeconds(this, now);
            if (policy.band(usage) == GuardPolicy.BAND_STRONG) {
                flow.strong("youtube", usage, policy, null, false);
            } else {
                flow.entry("youtube", usage, policy, false);
            }
        }
    }

    /** One try per PIP episode: bring YouTube to the front, which usually expands the window. */
    private void afterPipExpand(String kind) {
        if (destroyed || !pipLeaving) return;
        if (youtubePipVisible()) {
            pipStillOpen(kind);
            return;
        }
        pipLeaving = false;
        inPip = false;
        if (kind.equals(classifyActiveWindow())) {
            log("PIP 펼침: BACK으로 나가기");
            leavePlayer(kind);
        } else {
            log("PIP 사라짐");
            restoreAudio(false);
        }
    }

    /**
     * The PIP window stayed open after "나가기": ask the user to close it, and if they keep
     * watching, the time still counts (a session runs) and is recorded once as kept watching.
     */
    private void pipStillOpen(String kind) {
        log("PIP 계속 열림: 닫기 안내, 계속 보면 시청으로 기록");
        Toast.makeText(this, GuardCopy.PIP_CLOSE_GUIDE, Toast.LENGTH_LONG).show();
        if (GuardState.activeSession(this) == null) startWatch(kind);
        if (pipKeptWatching) return;
        pipKeptWatching = true;
        long now = System.currentTimeMillis();
        GuardPolicy policy = GuardState.policy(this);
        double usage = GuardState.todaySeconds(this, now);
        JSONObject row = new JSONObject();
        try {
            row.put("id", java.util.UUID.randomUUID().toString())
                .put("createdAt", now)
                .put("target", kind)
                .put("level", policy.band(usage))
                .put("band", policy.band(usage))
                .put("stage", "pip")
                .put("reason", "선택하지 않음")
                .put("interventionType", "pip")
                .put("outcome", usage >= policy.goalMinutes * 60.0 ? "overdraft" : "watch")
                .put("usageSeconds", usage)
                .put("policyVersion", policy.version);
        } catch (org.json.JSONException ignored) {
            return;
        }
        GuardState.addIntervention(this, row);
    }

    private void endPipEpisode() {
        pipLeaving = false;
        pipExpandTried = false;
        pipReasked = false;
        pipKeptWatching = false;
    }

    private void sample(String kind, String packageName) {
        if (leavingKind != null) {
            if (kind == null) {
                sawOtherSinceLeave = true;
            } else if (!sawOtherSinceLeave) {
                return; // BACK has not taken effect yet; not a new entry.
            }
        }
        if (kind == null) {
            noteAwayFromPrompt(packageName);
        } else {
            missedPromptChecks = 0;
        }
        tracker.onSample(kind, System.currentTimeMillis());
    }

    /** A prompt the user never answered is dropped once they browse the app normally. */
    private void noteAwayFromPrompt(String packageName) {
        if (closing) return;
        String kind = GuardScreens.YOUTUBE.equals(packageName) ? "youtube" : "instagram";
        if (!GuardState.isPrompting(this, kind)) return;
        missedPromptChecks += 1;
        if (missedPromptChecks < 2) return;
        missedPromptChecks = 0;
        GuardState.clearPrompt(this);
        log("응답 없는 개입 정리: " + kind);
    }

    // --- Stay start / end ------------------------------------------------------

    private final ShortsSessionTracker.Listener trackerListener = new ShortsSessionTracker.Listener() {
        @Override
        public void onEntered(String kind) {
            log("▶ 진입: " + kind);
            leavingKind = null;
            decide(kind);
        }

        @Override
        public void onExited(String kind, long endedAt, String reason) {
            double seconds = GuardState.endSession(ShortsGuardService.this, endedAt);
            log("■ 종료: " + kind + " (" + reason + ")" + (seconds > 0 ? " 시청 " + Math.round(seconds) + "초" : ""));
            pauseCommitment(kind);
            boolean wasPipLeaving = pipLeaving;
            endPipEpisode();
            inPip = false;
            if (overlay != null && overlay.isShowing()) {
                flow.abandon();
                if (leavingKind == null) restoreAudio(false);
            } else if (wasPipLeaving) {
                restoreAudio(false);
            }
        }
    };

    private void decide(String kind) {
        if (closing) return;
        long now = System.currentTimeMillis();
        if (GuardState.isLocked(this, now)) {
            showLock(kind, now);
            return;
        }
        if (GuardState.consumeAllow(this, kind, now) || !GuardState.isBlockerEnabled(this)) {
            startWatch(kind);
            return;
        }
        if (resumeCommitment(kind, now)) return;
        GuardPolicy policy = GuardState.policy(this);
        double usage = GuardState.todaySeconds(this, now);
        int band = policy.band(usage);
        boolean afterLock = GuardState.needsAfterLockQuestion(this, now);
        log("개입 판단: " + kind + " 강도 " + band + " 오늘 " + Math.round(usage) + "초 (" + policy.version + ")");
        if ("instagram".equals(kind)) {
            GuardState.startPrompt(this, kind, band, usage);
            bringSelf(this);
            return;
        }
        pausePlayback();
        if (band == GuardPolicy.BAND_STRONG) {
            flow.strong(kind, usage, policy, null, afterLock);
        } else {
            flow.entry(kind, usage, policy, afterLock);
        }
    }

    private final GuardFlow.Host flowHost = new GuardFlow.Host() {
        @Override
        public void onWatch(String kind, int minutes, boolean overdraft, int extensionIndex, int band) {
            log("시청: " + minutes + "분" + (overdraft ? " (목표 초과)" : extensionIndex > 0 ? " (연장 " + extensionIndex + ")" : ""));
            if (!kind.equals(tracker.currentKind())) {
                restoreAudio(false);
                return;
            }
            restoreAudio(true);
            if (GuardState.activeSession(ShortsGuardService.this) == null) startWatch(kind);
            commitKind = kind;
            commitMinutes = minutes;
            commitExtension = extensionIndex;
            commitOverdraft = overdraft;
            commitBand = band;
            scheduleCommitment(minutes * 60_000L);
        }

        @Override
        public void onLeave(String kind) {
            log("나가기 선택");
            leavePlayer(kind);
        }

        @Override
        public void onBlock(String kind, long until, int minutes, boolean dayEnd) {
            GuardState.startBlockUntil(ShortsGuardService.this, until, minutes, dayEnd);
            onBlockStarted(ShortsGuardService.this, until);
            leavePlayer(kind);
        }

        @Override
        public void record(JSONObject row) {
            GuardState.addIntervention(ShortsGuardService.this, row);
        }

        @Override
        public GuardCopy.Facts facts() {
            return buildFacts(System.currentTimeMillis());
        }

        @Override
        public boolean inPip() {
            return inPip;
        }
    };

    /** Numbers for the sheet wording: today, the goal, the web side's stats, and sleep left. */
    private GuardCopy.Facts buildFacts(long now) {
        GuardPolicy policy = GuardState.policy(this);
        GuardCopy.Facts f = new GuardCopy.Facts();
        f.usage = GuardState.todaySeconds(this, now);
        f.goal = policy.goalMinutes * 60.0;
        f.weekProjection = policy.stats.weekProjection(f.usage);
        f.avg7 = policy.stats.avg7Seconds;
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        int hour = cal.get(Calendar.HOUR_OF_DAY);
        f.yesterdayByNow = policy.stats.yesterdayByNow(hour, cal.get(Calendar.MINUTE));
        f.keptToday = GuardState.countToday(this, "kept", now);
        f.restToday = GuardState.restSecondsToday(this, now);
        if (hour >= 22 || hour < 4) {
            long wake = -1;
            AlarmManager alarms = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            AlarmManager.AlarmClockInfo next = alarms == null ? null : alarms.getNextAlarmClock();
            if (next != null && next.getTriggerTime() > now && next.getTriggerTime() - now <= ALARM_HORIZON_MS) {
                wake = next.getTriggerTime();
                Calendar at = Calendar.getInstance();
                at.setTimeInMillis(wake);
                f.sleepBasis = String.format(java.util.Locale.ROOT, "%d:%02d 알람 기준",
                    at.get(Calendar.HOUR_OF_DAY), at.get(Calendar.MINUTE));
            } else {
                Calendar at = Calendar.getInstance();
                at.setTimeInMillis(now);
                at.set(Calendar.HOUR_OF_DAY, policy.stats.wakeHour);
                at.set(Calendar.MINUTE, policy.stats.wakeMinute);
                at.set(Calendar.SECOND, 0);
                if (at.getTimeInMillis() <= now) at.add(Calendar.DAY_OF_MONTH, 1);
                wake = at.getTimeInMillis();
                f.sleepBasis = String.format(java.util.Locale.ROOT, "일어나는 시각 %d:%02d 기준",
                    policy.stats.wakeHour, policy.stats.wakeMinute);
            }
            f.sleepSeconds = (wake - now) / 1000.0;
        }
        return f;
    }

    private void scheduleCommitment(long delayMs) {
        commitEndsAt = SystemClock.elapsedRealtime() + delayMs;
        mainHandler.removeCallbacks(commitTimer);
        mainHandler.postDelayed(commitTimer, delayMs);
    }

    /** The user left during a commitment: keep what is left for 10 minutes. */
    private void pauseCommitment(String kind) {
        if (commitKind != null && commitKind.equals(kind)) {
            pausedKind = kind;
            pausedRemainingMs = Math.max(0, commitEndsAt - SystemClock.elapsedRealtime());
            pausedAt = System.currentTimeMillis();
        }
        cancelCommitment();
    }

    /** Back within 10 minutes with time left on the commitment: no sheet, carry on. */
    private boolean resumeCommitment(String kind, long now) {
        String paused = pausedKind;
        pausedKind = null;
        if (paused == null || !paused.equals(kind) || now - pausedAt > RESUME_WINDOW_MS
            || pausedRemainingMs < 5_000) {
            return false;
        }
        commitKind = kind;
        startWatch(kind);
        scheduleCommitment(pausedRemainingMs);
        log("약속 이어가기: 남은 " + Math.round(pausedRemainingMs / 1000.0) + "초");
        Toast.makeText(this, GuardCopy.resumeToast(commitMinutes, pausedRemainingMs / 1000.0), Toast.LENGTH_SHORT)
            .show();
        return true;
    }

    /** The chosen watch time is over: stop and ask again. */
    private void onCommitmentOver() {
        String kind = commitKind;
        commitKind = null;
        if (kind == null || destroyed || !kind.equals(tracker.currentKind())) return;
        GuardPolicy policy = GuardState.policy(this);
        double usage = GuardState.todaySeconds(this, System.currentTimeMillis());
        log("약속 시간 끝: " + commitMinutes + "분");
        pausePlayback();
        if (commitOverdraft) {
            flow.strong(kind, usage, policy, policy.overdraftMinutes + "분이 끝났어요.", false);
        } else {
            flow.commitmentOver(kind, usage, policy, commitMinutes, commitExtension, commitBand);
        }
    }

    private void cancelCommitment() {
        commitKind = null;
        mainHandler.removeCallbacks(commitTimer);
    }

    private void startWatch(String kind) {
        GuardState.startSession(this, kind, System.currentTimeMillis());
        log("시청 기록 시작: " + kind);
    }

    private void showLock(String kind, long now) {
        long until = GuardState.blockedUntil(this);
        GuardState.addLockAttempt(this, kind, now, until - now);
        log("잠금 중 진입: 남은 " + GuardCopy.countdown(until - now));
        pausePlayback();
        flow.locked(kind, until);
    }

    /** BACK, then HOME if the player is still there 0.8 s later. The stay ends right away. */
    private void leavePlayer(String kind) {
        if (inPip) {
            // BACK would hit the app in front, and another app's PIP cannot be closed for
            // the user. Keep the stay (time keeps counting), keep the sound off, and try once
            // to expand the window by bringing YouTube to the front.
            pipLeaving = true;
            pipLeftAt = System.currentTimeMillis();
            if (!pipExpandTried) {
                pipExpandTried = true;
                log("나가기: PIP → 큰 화면으로 펼치기 1회 시도");
                openYoutubeFront(this);
                mainHandler.postDelayed(() -> afterPipExpand(kind), PIP_EXPAND_CHECK_MS);
            } else {
                pipStillOpen(kind);
            }
            return;
        }
        log("나가기: BACK");
        leavingKind = kind;
        sawOtherSinceLeave = false;
        tracker.forceExit(System.currentTimeMillis(), "나가기");
        performGlobalAction(GLOBAL_ACTION_BACK);
        mainHandler.removeCallbacks(leaveCheck);
        mainHandler.postDelayed(leaveCheck, LEAVE_CHECK_MS);
    }

    // --- Instagram: leave the Reels player, then return to ShortsAI ------------

    private void stepAway(String kind, int attempt) {
        if (destroyed) {
            closing = false;
            return;
        }
        String packageName = activePackage();
        boolean stillPlayer = kind.equals(classifyActiveWindow());
        int limit = 3;
        if (packageName == null && attempt < limit + 2) {
            mainHandler.postDelayed(() -> stepAway(kind, attempt + 1), 200);
            return;
        }
        if (stillPlayer && attempt < limit) {
            log("BACK " + (attempt + 1) + "회");
            performGlobalAction(GLOBAL_ACTION_BACK);
            mainHandler.postDelayed(() -> stepAway(kind, attempt + 1), 280);
            return;
        }
        log("앱 열기 (BACK " + attempt + "회 후)");
        bringSelf(this);
        closing = false;
    }

    private void leaveReelsThenReturn() {
        mainHandler.postDelayed(() -> stepAway("instagram", 0), 350);
    }

    // --- Media keys and apps ---------------------------------------------------

    /**
     * Stops what plays under the sheet: transient audio focus (players pause on losing it
     * and usually resume when it comes back) plus muting the music stream until the sheet
     * is gone. Media keys are not used: they did not reach Shorts on a Galaxy, and a play
     * key could start another app's paused media instead.
     */
    private void pausePlayback() {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        requestFocus(audio);
        try {
            if (!GuardState.mutedByUs(this) && !audio.isStreamMute(AudioManager.STREAM_MUSIC)) {
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0);
                GuardState.setMutedByUs(this, true);
            }
        } catch (RuntimeException ignored) {
            // Some modes (e.g. Do Not Disturb policies) refuse; focus still applies.
        }
    }

    /**
     * Undoes {@link #pausePlayback}. Giving focus back lets the player resume on its own;
     * {@code resume} only marks the intent in the log.
     */
    private void restoreAudio(boolean resume) {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        if (GuardState.mutedByUs(this)) {
            try {
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
            } catch (RuntimeException ignored) {
                // Nothing else to do; the flag is cleared so we do not keep retrying.
            }
            GuardState.setMutedByUs(this, false);
        }
        abandonFocus(audio);
        if (resume) log("재생 이어가기 (오디오 포커스 반환)");
    }

    private void requestFocus(AudioManager audio) {
        if (holdingFocus) return;
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
                .setOnAudioFocusChangeListener(focusListener)
                .build();
            result = audio.requestAudioFocus(focusRequest);
        } else {
            result = audio.requestAudioFocus(
                focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
        holdingFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        log("오디오 포커스 요청: " + (holdingFocus ? "받음" : "거절"));
    }

    private void abandonFocus(AudioManager audio) {
        if (!holdingFocus) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
            audio.abandonAudioFocusRequest(focusRequest);
        } else {
            audio.abandonAudioFocus(focusListener);
        }
        holdingFocus = false;
    }

    private static void bringSelf(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        context.startActivity(intent);
    }

    /** Like tapping the YouTube icon: brings its task to the front (a PIP usually expands). */
    private static void openYoutubeFront(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(GuardScreens.YOUTUBE);
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(launch);
        } catch (RuntimeException ignored) {
            // The fallback (close guide, time recorded) still applies.
        }
    }

    private static void openYoutubeShorts(Context context) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/shorts"));
        intent.setPackage(GuardScreens.YOUTUBE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
        } catch (RuntimeException ignored) {
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(GuardScreens.YOUTUBE);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launch);
            }
        }
    }

    private Set<String> buildPassThroughPackages() {
        Set<String> packages = new HashSet<>();
        packages.add("com.android.systemui");
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) {
            for (InputMethodInfo info : imm.getEnabledInputMethodList()) packages.add(info.getPackageName());
        }
        return packages;
    }

    // --- Classification --------------------------------------------------------

    private String classifyActiveWindow() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        try {
            return classifyNode(root);
        } finally {
            root.recycle();
        }
    }

    private String activePackage() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        try {
            CharSequence packageChars = root.getPackageName();
            return packageChars == null ? null : packageChars.toString();
        } finally {
            root.recycle();
        }
    }

    private String classifyNode(AccessibilityNodeInfo node) {
        CharSequence packageChars = node.getPackageName();
        if (packageChars == null) return null;
        String packageName = packageChars.toString();
        if (!GuardScreens.isWatchedPackage(packageName)) return null;
        if (GuardScreens.YOUTUBE.equals(packageName)) return classifyYoutube(node);
        return GuardScreens.classify(packageName, inspect(node));
    }

    /** Looks up only the known ids instead of walking the tree. */
    private String classifyYoutube(AccessibilityNodeInfo root) {
        List<String> visible = new ArrayList<>();
        collectVisible(root, GuardScreens.YOUTUBE_SHORTS_IDS, visible);
        if (!visible.isEmpty()) {
            collectVisible(root, GuardScreens.YOUTUBE_LONGFORM_IDS, visible);
        }
        String kind = GuardScreens.classify(GuardScreens.YOUTUBE, visible);
        if (isDebuggable(this)) {
            String line = "[판별] 쇼츠=" + (kind != null)
                + " 쇼츠ID=" + leaf(GuardScreens.firstExact(visible, GuardScreens.YOUTUBE_SHORTS_IDS))
                + " 롱폼ID=" + leaf(GuardScreens.firstExact(visible, GuardScreens.YOUTUBE_LONGFORM_IDS));
            if (!line.equals(lastVerdictLog)) {
                lastVerdictLog = line;
                log(line);
            }
        }
        return kind;
    }

    /** Adds each id that has at least one node visible to the user. Hidden back-stack pages do not count. */
    private static void collectVisible(AccessibilityNodeInfo root, String[] ids, List<String> out) {
        for (String id : ids) {
            List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByViewId(id);
            if (nodes == null) continue;
            boolean visible = false;
            for (AccessibilityNodeInfo node : nodes) {
                if (node == null) continue;
                if (node.isVisibleToUser()) visible = true;
                node.recycle();
            }
            if (visible) out.add(id);
        }
    }

    private static String leaf(String id) {
        if (id == null) return "-";
        return id.startsWith(GuardScreens.YOUTUBE_ID) ? id.substring(GuardScreens.YOUTUBE_ID.length()) : id;
    }

    /**
     * Instagram only. Resource ids only. Does not call getText or read password fields.
     */
    private static GuardScreens.Hit inspect(AccessibilityNodeInfo root) {
        List<String> ids = new ArrayList<>();
        int[] count = new int[] {0};
        walk(root, ids, 0, count);
        return new GuardScreens.Hit(ids, false, false, false);
    }

    private static void walk(AccessibilityNodeInfo node, List<String> ids, int depth, int[] count) {
        if (node == null || depth > 30 || count[0] > 800) return;
        count[0] += 1;
        String id = node.getViewIdResourceName();
        if (id != null) ids.add(id);
        if (GuardScreens.classify(GuardScreens.INSTAGRAM, ids) != null) return;
        int children = node.getChildCount();
        for (int i = 0; i < children && count[0] <= 800; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            walk(child, ids, depth + 1, count);
            child.recycle();
        }
    }

    // --- Logging ---------------------------------------------------------------

    private static boolean isDebuggable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static void log(Context context, String message) {
        if (isDebuggable(context)) Log.d(TAG, message);
    }

    private void log(String message) {
        log(this, message);
    }
}
