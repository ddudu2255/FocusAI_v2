package app.focuson.shorts;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * On-device guard state. Sessions, intervention results and lock attempts wait here
 * until the web side copies them into SQLite and acknowledges them. No screen text,
 * account data, or view ids.
 */
public final class GuardState {
    private static final String PREFS = "hanbakja_guard";
    private static final String KEY_BLOCKER = "blocker_enabled";
    private static final String KEY_LEVEL1 = "level1_minutes";
    private static final String KEY_LEVEL3 = "level3_minutes";
    private static final String KEY_WEB_DATE = "web_seconds_date";
    private static final String KEY_WEB_SECONDS = "web_seconds";
    private static final String KEY_DAY_USAGE = "day_usage";
    private static final String KEY_ACTIVE = "active_session";
    private static final String KEY_SESSIONS = "pending_sessions";
    private static final String KEY_INTERVENTIONS = "pending_interventions";
    private static final String KEY_LOCKS = "pending_locks";
    private static final String KEY_BLOCKED_UNTIL = "blocked_until";
    private static final String KEY_BLOCK_MINUTES = "block_minutes";
    private static final String KEY_PROMPT_TARGET = "prompt_target";
    private static final String KEY_PROMPT_LEVEL = "prompt_level";
    private static final String KEY_PROMPT_USAGE = "prompt_usage";
    private static final String KEY_ALLOW_TARGET = "allow_target";
    private static final String KEY_ALLOW_UNTIL = "allow_until";
    private static final String KEY_POLICY = "policy";
    private static final String KEY_CARDS = "cards";
    private static final String KEY_CARD_INDEX = "card_index";
    private static final String KEY_ROTATE = "rotate_";
    private static final String KEY_SHOWN = "shown_";
    private static final String KEY_LOCK_ASKED = "lock_asked_for";
    private static final String KEY_MUTED = "muted_by_us";
    private static final String KEY_BLOCK_KIND = "block_kind";
    private static final String KEY_LOCK_LOG = "lock_log";
    private static final String KEY_COUNTERS = "day_counters";

    /** The after-lock question is asked only this soon after a timed lock ended. */
    private static final long AFTER_LOCK_WINDOW_MS = 3 * 60 * 60 * 1000L;

    /** Drop the oldest queued rows past this so a never-opened app cannot grow without bound. */
    private static final int QUEUE_LIMIT = 2000;
    private static final int DAYS_KEPT = 3;

    private static final Object LOCK = new Object();

    private GuardState() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // --- Switch and thresholds -------------------------------------------------

    public static boolean isBlockerEnabled(Context context) {
        synchronized (LOCK) {
            return prefs(context).getBoolean(KEY_BLOCKER, true);
        }
    }

    /** Off also drops a pending prompt so the Level flow does not open. */
    public static void setBlockerEnabled(Context context, boolean enabled) {
        synchronized (LOCK) {
            SharedPreferences.Editor editor = prefs(context).edit().putBoolean(KEY_BLOCKER, enabled);
            if (!enabled) editor.putString(KEY_PROMPT_TARGET, "");
            editor.commit();
        }
    }

    /**
     * Thresholds and the seconds the web side counted itself today (practice feed,
     * migrated logs). Native sessions are counted here, not by the web.
     */
    public static void setConfig(Context context, int level1, int level3, String webDate, double webSeconds) {
        synchronized (LOCK) {
            prefs(context).edit()
                .putInt(KEY_LEVEL1, level1)
                .putInt(KEY_LEVEL3, level3)
                .putString(KEY_WEB_DATE, webDate == null ? "" : webDate)
                .putFloat(KEY_WEB_SECONDS, (float) webSeconds)
                .commit();
        }
    }

    public static int level1Minutes(Context context) {
        synchronized (LOCK) {
            return prefs(context).getInt(KEY_LEVEL1, 10);
        }
    }

    public static int level3Minutes(Context context) {
        synchronized (LOCK) {
            return prefs(context).getInt(KEY_LEVEL3, 20);
        }
    }

    /** Today's Shorts seconds: finished native sessions, web seconds, and the open session. */
    public static double todaySeconds(Context context, long now) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            TimeZone zone = TimeZone.getDefault();
            String today = GuardTime.dayKey(now, zone);
            double total = readObject(prefs, KEY_DAY_USAGE).optDouble(today, 0);
            if (today.equals(prefs.getString(KEY_WEB_DATE, ""))) {
                total += prefs.getFloat(KEY_WEB_SECONDS, 0f);
            }
            JSONObject active = readObject(prefs, KEY_ACTIVE);
            if (active.has("startedAt")) {
                Double open = GuardTime.splitByDay(active.optLong("startedAt"), now, zone).get(today);
                if (open != null) total += open;
            }
            return total;
        }
    }

    // --- Policy table and cards from the web side ------------------------------

    /** Stores the policy table and study cards the web side sent with sync. */
    public static void setPolicyAndCards(Context context, String policyJson, String cardsJson) {
        synchronized (LOCK) {
            SharedPreferences.Editor editor = prefs(context).edit();
            if (policyJson != null) editor.putString(KEY_POLICY, policyJson);
            if (cardsJson != null) editor.putString(KEY_CARDS, cardsJson);
            editor.commit();
        }
    }

    static GuardPolicy policy(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            return GuardPolicy.fromJson(prefs.getString(KEY_POLICY, ""), prefs.getInt(KEY_LEVEL3, 20));
        }
    }

    public static boolean hasCards(Context context) {
        synchronized (LOCK) {
            return readArray(prefs(context), KEY_CARDS).length() > 0;
        }
    }

    /** Next study card in turn, or null when none were sent. */
    public static JSONObject nextCard(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONArray cards = readArray(prefs, KEY_CARDS);
            if (cards.length() == 0) return null;
            int index = prefs.getInt(KEY_CARD_INDEX, 0);
            prefs.edit().putInt(KEY_CARD_INDEX, index + 1).apply();
            return cards.optJSONObject(Math.floorMod(index, cards.length()));
        }
    }

    /**
     * Round-robin pick among {@code options} for this key, so the same sheet does not show
     * every time (habituation) and each method gets data before the AI phase.
     */
    public static String nextInTurn(Context context, String key, List<String> options) {
        if (options == null || options.isEmpty()) return null;
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            int index = prefs.getInt(KEY_ROTATE + key, 0);
            prefs.edit().putInt(KEY_ROTATE + key, index + 1).apply();
            return options.get(Math.floorMod(index, options.size()));
        }
    }

    /** When each of {@code arms} was last shown (0 = never), for the bandit's habituation. */
    public static Map<String, Long> lastShown(Context context, String group, List<String> arms) {
        Map<String, Long> out = new java.util.HashMap<>();
        if (arms == null) return out;
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            for (String arm : arms) out.put(arm, prefs.getLong(KEY_SHOWN + group + "_" + arm, 0L));
        }
        return out;
    }

    public static void markShown(Context context, String group, String arm, long now) {
        if (arm == null) return;
        synchronized (LOCK) {
            prefs(context).edit().putLong(KEY_SHOWN + group + "_" + arm, now).apply();
        }
    }

    /** Running counter for rotating lines: returns 0, 1, 2, ... for this key. */
    public static int nextIndex(Context context, String key) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            int index = prefs.getInt(KEY_ROTATE + key, 0);
            prefs.edit().putInt(KEY_ROTATE + key, index + 1).apply();
            return index;
        }
    }

    /**
     * True once per finished timed lock, within 3 hours of its end. Not after "오늘은 끝"
     * (asking "what did you do during the lock" first thing in the morning reads oddly).
     */
    public static boolean needsAfterLockQuestion(Context context, long now) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            long until = prefs.getLong(KEY_BLOCKED_UNTIL, 0L);
            return until > 0
                && now >= until
                && now - until <= AFTER_LOCK_WINDOW_MS
                && "timed".equals(prefs.getString(KEY_BLOCK_KIND, "timed"))
                && prefs.getLong(KEY_LOCK_ASKED, 0L) != until;
        }
    }

    public static void markAfterLockAsked(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            prefs.edit().putLong(KEY_LOCK_ASKED, prefs.getLong(KEY_BLOCKED_UNTIL, 0L)).commit();
        }
    }

    /** Remembers that we muted the music stream, so a restarted service can undo it. */
    public static void setMutedByUs(Context context, boolean muted) {
        synchronized (LOCK) {
            prefs(context).edit().putBoolean(KEY_MUTED, muted).commit();
        }
    }

    public static boolean mutedByUs(Context context) {
        synchronized (LOCK) {
            return prefs(context).getBoolean(KEY_MUTED, false);
        }
    }

    // --- Watch sessions --------------------------------------------------------

    public static final class ActiveSession {
        public final String target;
        public final long startedAt;
        public final long lastSeenAt;

        ActiveSession(String target, long startedAt, long lastSeenAt) {
            this.target = target;
            this.startedAt = startedAt;
            this.lastSeenAt = lastSeenAt;
        }
    }

    public static ActiveSession activeSession(Context context) {
        synchronized (LOCK) {
            JSONObject active = readObject(prefs(context), KEY_ACTIVE);
            if (!active.has("startedAt")) return null;
            return new ActiveSession(
                active.optString("target"), active.optLong("startedAt"), active.optLong("lastSeenAt"));
        }
    }

    public static void startSession(Context context, String target, long now) {
        synchronized (LOCK) {
            JSONObject active = new JSONObject();
            try {
                active.put("target", target).put("startedAt", now).put("lastSeenAt", now);
            } catch (JSONException ignored) {
                return;
            }
            prefs(context).edit().putString(KEY_ACTIVE, active.toString()).commit();
        }
    }

    /** Lets a restarted service close the session at the last time Shorts was seen. */
    public static void touchSession(Context context, long now) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONObject active = readObject(prefs, KEY_ACTIVE);
            if (!active.has("startedAt")) return;
            try {
                active.put("lastSeenAt", now);
            } catch (JSONException ignored) {
                return;
            }
            prefs.edit().putString(KEY_ACTIVE, active.toString()).apply();
        }
    }

    /**
     * Closes the open session at {@code endedAt}, queues it for the web side and adds
     * its seconds to each local date it covers.
     * @return seconds recorded, 0 when there was no session
     */
    public static double endSession(Context context, long endedAt) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONObject active = readObject(prefs, KEY_ACTIVE);
            SharedPreferences.Editor editor = prefs.edit().putString(KEY_ACTIVE, "");
            if (!active.has("startedAt")) {
                editor.commit();
                return 0;
            }
            long startedAt = active.optLong("startedAt");
            long end = Math.max(startedAt, endedAt);
            double seconds = (end - startedAt) / 1000.0;
            if (seconds >= 1) {
                JSONObject row = new JSONObject();
                try {
                    row.put("id", UUID.randomUUID().toString())
                        .put("target", active.optString("target"))
                        .put("startedAt", startedAt)
                        .put("endedAt", end)
                        .put("durationSec", seconds);
                } catch (JSONException ignored) {
                    editor.commit();
                    return 0;
                }
                editor.putString(KEY_SESSIONS, append(prefs, KEY_SESSIONS, row));
                JSONObject days = readObject(prefs, KEY_DAY_USAGE);
                for (Map.Entry<String, Double> part
                    : GuardTime.splitByDay(startedAt, end, TimeZone.getDefault()).entrySet()) {
                    try {
                        days.put(part.getKey(), days.optDouble(part.getKey(), 0) + part.getValue());
                    } catch (JSONException ignored) {
                        // Keep the queued row even if the day total cannot be updated.
                    }
                }
                editor.putString(KEY_DAY_USAGE, pruneDays(days).toString());
            }
            editor.commit();
            return seconds >= 1 ? seconds : 0;
        }
    }

    // --- Intervention results and lock attempts --------------------------------

    public static void addIntervention(Context context, JSONObject row) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            prefs.edit().putString(KEY_INTERVENTIONS, append(prefs, KEY_INTERVENTIONS, row)).commit();
        }
    }

    public static void addLockAttempt(Context context, String target, long now, long remainingMs) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONObject row = new JSONObject();
            try {
                row.put("id", UUID.randomUUID().toString())
                    .put("target", target)
                    .put("createdAt", now)
                    .put("remainingSec", Math.max(0, Math.round(remainingMs / 1000.0)));
            } catch (JSONException ignored) {
                return;
            }
            prefs.edit().putString(KEY_LOCKS, append(prefs, KEY_LOCKS, row)).commit();
        }
    }

    /** Everything waiting for the web side. Rows stay queued until {@link #ack}. */
    public static JSONObject peekPending(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONObject out = new JSONObject();
            try {
                out.put("sessions", readArray(prefs, KEY_SESSIONS))
                    .put("interventions", readArray(prefs, KEY_INTERVENTIONS))
                    .put("lockAttempts", readArray(prefs, KEY_LOCKS));
            } catch (JSONException ignored) {
                // An empty object is still a valid answer.
            }
            return out;
        }
    }

    /** Drops queued rows the web side has stored. */
    public static void ack(Context context, Set<String> ids) {
        if (ids == null || ids.isEmpty()) return;
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            prefs.edit()
                .putString(KEY_SESSIONS, without(prefs, KEY_SESSIONS, ids))
                .putString(KEY_INTERVENTIONS, without(prefs, KEY_INTERVENTIONS, ids))
                .putString(KEY_LOCKS, without(prefs, KEY_LOCKS, ids))
                .commit();
        }
    }

    // --- Time block (Level 3) --------------------------------------------------

    public static long blockedUntil(Context context) {
        synchronized (LOCK) {
            return prefs(context).getLong(KEY_BLOCKED_UNTIL, 0L);
        }
    }

    public static int blockMinutes(Context context) {
        synchronized (LOCK) {
            return prefs(context).getInt(KEY_BLOCK_MINUTES, 0);
        }
    }

    public static boolean isLocked(Context context, long now) {
        return now < blockedUntil(context);
    }

    /** @return the wall-clock end of the block */
    public static long startBlock(Context context, int minutes, long now) {
        return startBlockUntil(context, now + minutes * 60_000L, minutes);
    }

    /** Block until a wall-clock time, e.g. "오늘은 끝" until tomorrow morning. */
    public static long startBlockUntil(Context context, long until, int minutes) {
        return startBlockUntil(context, until, minutes, false);
    }

    /**
     * @param dayEnd true for "오늘은 끝"; those hours are not counted as "쉰 시간" and are
     *               not followed by the after-lock question
     */
    public static long startBlockUntil(Context context, long until, int minutes, boolean dayEnd) {
        long now = System.currentTimeMillis();
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            JSONArray log = readArray(prefs, KEY_LOCK_LOG);
            JSONArray kept = new JSONArray();
            for (int i = 0; i < log.length(); i++) {
                JSONObject row = log.optJSONObject(i);
                if (row != null && now - row.optLong("until") < 48 * 3600_000L) kept.put(row);
            }
            if (!dayEnd) {
                JSONObject row = new JSONObject();
                try {
                    row.put("start", now).put("until", until);
                    kept.put(row);
                } catch (JSONException ignored) {
                    // The lock still applies; only the rest-time total misses it.
                }
            }
            prefs.edit()
                .putLong(KEY_BLOCKED_UNTIL, until)
                .putInt(KEY_BLOCK_MINUTES, minutes)
                .putString(KEY_BLOCK_KIND, dayEnd ? "day_end" : "timed")
                .putString(KEY_LOCK_LOG, kept.toString())
                .commit();
        }
        return until;
    }

    /** Minutes of timed locks already gone by today ("오늘 쉰 시간"), including a running one. */
    public static double restSecondsToday(Context context, long now) {
        synchronized (LOCK) {
            JSONArray log = readArray(prefs(context), KEY_LOCK_LOG);
            TimeZone zone = TimeZone.getDefault();
            String today = GuardTime.dayKey(now, zone);
            double total = 0;
            for (int i = 0; i < log.length(); i++) {
                JSONObject row = log.optJSONObject(i);
                if (row == null) continue;
                long start = row.optLong("start");
                long end = Math.min(now, row.optLong("until"));
                Double part = GuardTime.splitByDay(start, end, zone).get(today);
                if (part != null) total += part;
            }
            return total;
        }
    }

    // --- Per-day counters (kept promises, "3분만 더") ---------------------------

    /** Adds one to today's counter and returns the new value. */
    public static int bumpToday(Context context, String name, long now) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            String today = GuardTime.dayKey(now, TimeZone.getDefault());
            JSONObject counters = readObject(prefs, KEY_COUNTERS);
            if (!today.equals(counters.optString("date"))) counters = new JSONObject();
            int next = counters.optInt(name, 0) + 1;
            try {
                counters.put("date", today).put(name, next);
            } catch (JSONException ignored) {
                return next;
            }
            prefs.edit().putString(KEY_COUNTERS, counters.toString()).commit();
            return next;
        }
    }

    public static int countToday(Context context, String name, long now) {
        synchronized (LOCK) {
            JSONObject counters = readObject(prefs(context), KEY_COUNTERS);
            String today = GuardTime.dayKey(now, TimeZone.getDefault());
            return today.equals(counters.optString("date")) ? counters.optInt(name, 0) : 0;
        }
    }

    // --- Prompt handed to the web flow (Level 3, Instagram) --------------------

    public static void startPrompt(Context context, String target, int level, double usageSeconds) {
        synchronized (LOCK) {
            prefs(context).edit()
                .putString(KEY_PROMPT_TARGET, target)
                .putInt(KEY_PROMPT_LEVEL, level)
                .putFloat(KEY_PROMPT_USAGE, (float) usageSeconds)
                .commit();
        }
    }

    public static String pendingTarget(Context context) {
        synchronized (LOCK) {
            String target = prefs(context).getString(KEY_PROMPT_TARGET, "");
            return target == null ? "" : target;
        }
    }

    public static int pendingLevel(Context context) {
        synchronized (LOCK) {
            return prefs(context).getInt(KEY_PROMPT_LEVEL, 0);
        }
    }

    public static double pendingUsage(Context context) {
        synchronized (LOCK) {
            return prefs(context).getFloat(KEY_PROMPT_USAGE, 0f);
        }
    }

    public static boolean isPrompting(Context context, String target) {
        return target != null && target.equals(pendingTarget(context));
    }

    public static void clearPrompt(Context context) {
        synchronized (LOCK) {
            prefs(context).edit().putString(KEY_PROMPT_TARGET, "").commit();
        }
    }

    /** After "watch" in the web flow, the next entry to this app's player is not stopped again. */
    public static void allow(Context context, String target, long until) {
        synchronized (LOCK) {
            prefs(context).edit()
                .putString(KEY_ALLOW_TARGET, target)
                .putLong(KEY_ALLOW_UNTIL, until)
                .commit();
        }
    }

    public static boolean consumeAllow(Context context, String target, long now) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            boolean ok = target.equals(prefs.getString(KEY_ALLOW_TARGET, ""))
                && now < prefs.getLong(KEY_ALLOW_UNTIL, 0L);
            if (ok) prefs.edit().putString(KEY_ALLOW_TARGET, "").commit();
            return ok;
        }
    }

    /** "기록 모두 지우기": usage, queues, block and prompt. Keeps the switch and thresholds. */
    public static void resetRecords(Context context) {
        synchronized (LOCK) {
            prefs(context).edit()
                .putString(KEY_DAY_USAGE, "")
                .putString(KEY_ACTIVE, "")
                .putString(KEY_SESSIONS, "")
                .putString(KEY_INTERVENTIONS, "")
                .putString(KEY_LOCKS, "")
                .putLong(KEY_BLOCKED_UNTIL, 0L)
                .putInt(KEY_BLOCK_MINUTES, 0)
                .putString(KEY_LOCK_LOG, "")
                .putString(KEY_COUNTERS, "")
                .putString(KEY_PROMPT_TARGET, "")
                .putString(KEY_ALLOW_TARGET, "")
                .putString(KEY_WEB_DATE, "")
                .putFloat(KEY_WEB_SECONDS, 0f)
                .commit();
        }
    }

    // --- JSON helpers ----------------------------------------------------------

    private static JSONObject readObject(SharedPreferences prefs, String key) {
        String raw = prefs.getString(key, "");
        if (raw == null || raw.isEmpty()) return new JSONObject();
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static JSONArray readArray(SharedPreferences prefs, String key) {
        String raw = prefs.getString(key, "");
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static String append(SharedPreferences prefs, String key, JSONObject row) {
        JSONArray array = readArray(prefs, key);
        array.put(row);
        if (array.length() <= QUEUE_LIMIT) return array.toString();
        JSONArray trimmed = new JSONArray();
        for (int i = array.length() - QUEUE_LIMIT; i < array.length(); i++) {
            trimmed.put(array.opt(i));
        }
        return trimmed.toString();
    }

    private static String without(SharedPreferences prefs, String key, Set<String> ids) {
        JSONArray array = readArray(prefs, key);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < array.length(); i++) {
            JSONObject row = array.optJSONObject(i);
            if (row != null && !ids.contains(row.optString("id"))) kept.put(row);
        }
        return kept.toString();
    }

    private static JSONObject pruneDays(JSONObject days) {
        List<String> keys = new ArrayList<>();
        Iterator<String> it = days.keys();
        while (it.hasNext()) keys.add(it.next());
        if (keys.size() <= DAYS_KEPT) return days;
        Collections.sort(keys);
        for (int i = 0; i < keys.size() - DAYS_KEPT; i++) days.remove(keys.get(i));
        return days;
    }
}
