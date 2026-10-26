package app.focuson.shorts;

import java.util.Calendar;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Risk model (lib/risk.ts, docs/risk-model/README.md): the chance that this open turns into
 * watching at least half of the day's goal. Same arithmetic as lib/risk.ts; the weights come
 * from the policy table ({@link GuardPolicy.Model}) and are re-learned on the web side.
 *
 * What the band does to the sheet ({@link #action}): high = 3-minute choices (extensions
 * stay, also 3 minutes) and a 10 s wait before "3분만 더"; medium = a "3분 · 추천" chip.
 * The bandit may soften either by one step ("soft"). No Android types except in callers.
 */
final class GuardRisk {
    private GuardRisk() {}

    static final String LOW = "low";
    static final String MEDIUM = "medium";
    static final String HIGH = "high";
    static final String FULL = "full";
    static final String SOFT = "soft";

    /** Raw features, in lib/risk.ts RAW_FEATURES order. */
    static final int RAW_COUNT = 10;
    static final int REASON = 9;
    /** "No record" (first open today, never locked): a big number the cap cuts down. */
    static final double NO_VALUE = 1e4;
    private static final int[] REASON_COLUMNS = {1, 2, 3, 4, 5};

    enum Action { NONE, SUGGEST, SHORT }

    /** What pushed the score up most, for the sheet line (R1·R2). */
    enum Reason { TODAY, REOPEN, PREVIOUS, TIME, GENERAL }

    /** A reason must add at least this much (log-odds) to be named; otherwise GENERAL. */
    static final double REASON_MIN = 0.3;
    /** Model input columns behind each reason (see {@link #transform}). */
    private static final int[][] REASON_GROUPS = {
        {3},          // TODAY: today's share of the goal
        {5},          // REOPEN: minutes since the last close (short gap raises it)
        {6},          // PREVIOUS: length of the last watch
        {0, 1, 2, 8}, // TIME: hour, weekend, yesterday by this time
    };

    /** One open: the sheet shown on entering Shorts or Reels, and the watching it leads to. */
    static final class Open {
        final String id = UUID.randomUUID().toString();
        final String kind;
        final long createdAt;
        final double[] raw;
        final String modelVersion;
        double score;
        String band = LOW;
        /** Bandit pick for medium / high; null for low. */
        String tighten;
        /** Keeping the goal lately (policy keepingGoal): one step softer, and not a bandit trial. */
        boolean keeping;
        /** Sent to the web side once, with the first sheet record of this open. */
        boolean queued;

        Open(String kind, long createdAt, double[] raw, String modelVersion) {
            this.kind = kind;
            this.createdAt = createdAt;
            this.raw = raw;
            this.modelVersion = modelVersion;
        }

        Action action() {
            return GuardRisk.action(band, tighten, keeping);
        }

        JSONObject toJson() {
            JSONObject row = new JSONObject();
            try {
                JSONArray features = new JSONArray();
                for (double v : raw) features.put(v);
                row.put("id", id)
                    .put("createdAt", createdAt)
                    .put("target", kind)
                    .put("features", features)
                    .put("score", score)
                    .put("band", band)
                    .put("tighten", tighten == null ? JSONObject.NULL : tighten)
                    .put("keeping", keeping)
                    .put("modelVersion", modelVersion);
            } catch (JSONException ignored) {
                // Plain values; nothing to recover.
            }
            return row;
        }
    }

    /**
     * The numbers at the moment of opening (lib/risk.ts RAW_FEATURES).
     * @param opensToday sheets shown today before this one
     * @param lastClosedAt end of the last watch, 0 when none
     * @param lastDurationSec length of the last watch
     * @param blockedUntil end of the last lock, 0 when none (a lock still running counts as none)
     * @param yesterdayByNowSec yesterday's total by this time of day, negative when unknown
     * @param reason index in {@link GuardCopy#REASONS}, -1 when not asked (yet)
     */
    static double[] features(
        Calendar now,
        double todaySeconds,
        double goalSeconds,
        int opensToday,
        long lastClosedAt,
        double lastDurationSec,
        long blockedUntil,
        double yesterdayByNowSec,
        double kept7,
        int reason
    ) {
        long at = now.getTimeInMillis();
        int day = now.get(Calendar.DAY_OF_WEEK);
        double goal = Math.max(60, goalSeconds);
        return new double[] {
            now.get(Calendar.HOUR_OF_DAY),
            day == Calendar.SATURDAY || day == Calendar.SUNDAY ? 1 : 0,
            todaySeconds / goal,
            opensToday,
            lastClosedAt > 0 && lastClosedAt <= at ? (at - lastClosedAt) / 60000.0 : NO_VALUE,
            lastDurationSec / goal,
            blockedUntil > 0 && blockedUntil <= at ? (at - blockedUntil) / 60000.0 : NO_VALUE,
            Math.max(0, yesterdayByNowSec) / goal,
            kept7,
            reason,
        };
    }

    static int reasonIndex(String reason) {
        for (int i = 0; i < GuardCopy.REASONS.length; i++) {
            if (GuardCopy.REASONS[i].equals(reason)) return i;
        }
        return -1;
    }

    /** Raw features → model input (lib/risk.ts transform). An unknown reason takes the average. */
    static double[] transform(double[] raw, double[] mean, double cap) {
        double hour = raw[0];
        double[] x = new double[10 + REASON_COLUMNS.length];
        x[0] = Math.sin(2 * Math.PI * hour / 24);
        x[1] = Math.cos(2 * Math.PI * hour / 24);
        x[2] = raw[1];
        x[3] = Math.min(raw[2], 3);
        x[4] = Math.log1p(raw[3]);
        x[5] = Math.log1p(Math.min(raw[4], cap));
        x[6] = Math.min(raw[5], 3);
        x[7] = Math.log1p(Math.min(raw[6], cap));
        x[8] = Math.min(raw[7], 3);
        x[9] = raw[8];
        double reason = raw[REASON];
        for (int i = 0; i < REASON_COLUMNS.length; i++) {
            x[10 + i] = reason < 0 ? mean[10 + i] : reason == REASON_COLUMNS[i] ? 1 : 0;
        }
        return x;
    }

    static double score(GuardPolicy.Model model, double[] raw) {
        double[] x = transform(raw, model.mean, model.cap);
        double z = model.bias;
        for (int i = 0; i < x.length; i++) z += (x[i] - model.mean[i]) / model.std[i] * model.weights[i];
        return 1 / (1 + Math.exp(-z));
    }

    /** The reason group that adds the most to the score now. */
    static Reason topReason(GuardPolicy.Model model, double[] raw) {
        double[] x = transform(raw, model.mean, model.cap);
        Reason best = Reason.GENERAL;
        double bestPush = REASON_MIN;
        Reason[] names = {Reason.TODAY, Reason.REOPEN, Reason.PREVIOUS, Reason.TIME};
        for (int g = 0; g < REASON_GROUPS.length; g++) {
            double push = 0;
            for (int i : REASON_GROUPS[g]) push += (x[i] - model.mean[i]) / model.std[i] * model.weights[i];
            if (push > bestPush) {
                bestPush = push;
                best = names[g];
            }
        }
        return best;
    }

    static String band(double score, double[] bands) {
        if (score >= bands[1]) return HIGH;
        if (score >= bands[0]) return MEDIUM;
        return LOW;
    }

    /**
     * The decided behaviour per band; "soft" takes it one step weaker, and so does keeping the
     * goal for the last 7 days (then the bandit pick is ignored).
     */
    static Action action(String band, String tighten, boolean keeping) {
        boolean soft = keeping || SOFT.equals(tighten);
        if (HIGH.equals(band)) return soft ? Action.SUGGEST : Action.SHORT;
        if (MEDIUM.equals(band)) return soft ? Action.NONE : Action.SUGGEST;
        return Action.NONE;
    }
}
