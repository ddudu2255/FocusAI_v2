package app.focuson.shorts;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Policy table the service reads at the moment of an intervention. The web side builds it
 * (rules now, the AI phase later) and hands it over through GuardPlugin.sync, so the
 * service never computes personalisation itself. Missing fields fall back to defaults.
 */
final class GuardPolicy {
    static final int BAND_LIGHT = 1;
    static final int BAND_MEDIUM = 2;
    static final int BAND_STRONG = 3;

    final String version;
    final int goalMinutes;
    final double mediumAt;
    final double strongAt;
    final List<String> lightMethods;
    final List<String> mediumMethods;
    final int[] commitOptions;
    final int[] extensionLadder;
    final int overdraftMinutes;
    final int overdraftWaitSec;
    final int dayEndHour;
    /** Kinds of the time line (S1): guilt, weekly, motivate, future, yesterday, average, goal, sleep. */
    final List<String> framings;
    /** Stats the web side computed for the wording. Negative = unknown. */
    Stats stats = Stats.none();
    /** AI phase settings and learned tables (lib/ai.ts, lib/policy.ts). */
    Ai ai = new Ai();
    /** 공부 모드: a due study card replaces the light/medium activity (normal methods otherwise). */
    boolean studyMode;
    /** Others' choices by hour (lib/compare.ts sheetCompare); null without stats. */
    Compare compare;

    /** Out of 10 people who opened Shorts at that hour: how many chose 3 minutes / left right away. */
    static final class Compare {
        final boolean demo;
        /** 24 entries, 0 = no figure for that hour */
        final int[] shortOf10;
        final int[] exitOf10;

        Compare(boolean demo, int[] shortOf10, int[] exitOf10) {
            this.demo = demo;
            this.shortOf10 = shortOf10;
            this.exitOf10 = exitOf10;
        }
    }

    /**
     * What the AI decides inside the rules: which method / line to show (Thompson
     * sampling over learned posteriors), how hard to hold back by the predicted risk of
     * this open ({@link GuardRisk}), and when to ask for feedback. The band itself stays
     * rule based.
     */
    static final class Ai {
        boolean enabled;
        boolean strict;
        /** "band:slot" → arm → {alpha, beta} */
        Map<String, Map<String, double[]>> methods = new HashMap<>();
        /** "slot" → framing kind → {alpha, beta} */
        Map<String, Map<String, double[]>> framings = new HashMap<>();
        /** Earliest usual heavy hour (lib/ai.ts riskHours); only for the "남겨 둘까요?" hint. */
        int firstRiskHour = -1;
        String riskLabel = "";
        /** High risk (decided behaviour): longest commitment, wait before "3분만 더". */
        int riskCommitMax = 3;
        int riskOverdraftWaitSec = 10;
        int feedbackEvery = 5;
        /** Habituation (ai-2): 0 = off. See GuardBandit.freshness. */
        double habituationStrength = 0;
        double habituationRecoveryHours = 6;
        /** Risk model (lib/risk.ts); null when AI is off or the table has none. */
        Model model;
        /** "medium" | "high" → full / soft → {alpha, beta} */
        Map<String, Map<String, double[]>> tighten = new HashMap<>();

        /**
         * Method posteriors for this band right now: "band:slot:weekday|weekend" (ai-2),
         * falling back to "band:slot" (ai-1).
         */
        Map<String, double[]> methodsAt(int band, Calendar now) {
            String slot = timeSlot(now.get(Calendar.HOUR_OF_DAY));
            Map<String, double[]> row = methods.get(band + ":" + slot + ":" + dayType(now));
            return row != null ? row : methods.get(band + ":" + slot);
        }

        /** Framing posteriors right now: "slot:weekday|weekend" (ai-2), falling back to "slot". */
        Map<String, double[]> framingsAt(Calendar now) {
            String slot = timeSlot(now.get(Calendar.HOUR_OF_DAY));
            Map<String, double[]> row = framings.get(slot + ":" + dayType(now));
            return row != null ? row : framings.get(slot);
        }

        /** Before today's first risky hour: suggest keeping budget for later. */
        boolean beforeRisk(int hour) {
            return enabled && firstRiskHour >= 0 && hour < firstRiskHour && hour >= 5;
        }
    }

    /** Logistic regression weights and scaling from lib/policy.ts ai.model. */
    static final class Model {
        final String version;
        final double[] mean;
        final double[] std;
        final double[] weights;
        final double bias;
        /** low < bands[0] <= medium < bands[1] <= high */
        final double[] bands;
        final double cap;
        /** Share of kept commitments in the last 7 days; a feature the web side computes. */
        final double kept7;
        /** Every one of the last 7 days within the goal: risk actions go one step softer. */
        final boolean keepingGoal;

        Model(String version, double[] mean, double[] std, double[] weights, double bias, double[] bands,
              double cap, double kept7, boolean keepingGoal) {
            this.version = version;
            this.mean = mean;
            this.std = std;
            this.weights = weights;
            this.bias = bias;
            this.bands = bands;
            this.cap = cap;
            this.kept7 = kept7;
            this.keepingGoal = keepingGoal;
        }
    }

    /** 아침 5~11, 낮 11~17, 저녁 17~22, 밤 22~5 (same as lib/ai.ts timeSlot). */
    static String timeSlot(int hour) {
        if (hour >= 5 && hour < 11) return "morning";
        if (hour >= 11 && hour < 17) return "day";
        if (hour >= 17 && hour < 22) return "evening";
        return "night";
    }

    /** 토·일은 weekend (same as lib/ai.ts dayType). */
    static String dayType(Calendar now) {
        int day = now.get(Calendar.DAY_OF_WEEK);
        return day == Calendar.SATURDAY || day == Calendar.SUNDAY ? "weekend" : "weekday";
    }

    /** Numbers behind the lines ("어제 이 시간엔…", "이번 주 평균보다…"). */
    static final class Stats {
        /** Average of the last 7 days before today (seconds). */
        double avg7Seconds = -1;
        /** This week (Monday-based) before today, and how many days that covers. */
        double pastWeekSeconds = -1;
        int daysBeforeToday = 0;
        /** Yesterday's running total at the end of each hour 0..23, or null. */
        double[] yesterdayCumulative;
        int wakeHour = 7;
        int wakeMinute = 0;

        static Stats none() {
            return new Stats();
        }

        /** Yesterday's total by this time of day, or -1 when there is no record. */
        double yesterdayByNow(int hour, int minute) {
            if (yesterdayCumulative == null || yesterdayCumulative.length < 24) return -1;
            double before = hour == 0 ? 0 : yesterdayCumulative[hour - 1];
            double end = yesterdayCumulative[hour];
            return before + (end - before) * (minute / 60.0);
        }

        /** Projected total for this week at today's pace, or -1. */
        double weekProjection(double todaySeconds) {
            if (pastWeekSeconds < 0) return -1;
            int days = daysBeforeToday + 1;
            return (pastWeekSeconds + todaySeconds) / days * 7;
        }
    }

    GuardPolicy(
        String version,
        int goalMinutes,
        double mediumAt,
        double strongAt,
        List<String> lightMethods,
        List<String> mediumMethods,
        int[] commitOptions,
        int[] extensionLadder,
        int overdraftMinutes,
        int overdraftWaitSec,
        int dayEndHour,
        List<String> framings
    ) {
        this.version = version;
        this.goalMinutes = Math.max(1, goalMinutes);
        this.mediumAt = mediumAt;
        this.strongAt = strongAt;
        this.lightMethods = lightMethods;
        this.mediumMethods = mediumMethods;
        this.commitOptions = commitOptions;
        this.extensionLadder = extensionLadder;
        this.overdraftMinutes = Math.max(1, overdraftMinutes);
        this.overdraftWaitSec = Math.max(0, overdraftWaitSec);
        this.dayEndHour = Math.max(0, Math.min(23, dayEndHour));
        this.framings = framings;
    }

    static GuardPolicy defaults(int goalMinutes) {
        return new GuardPolicy(
            "rule-default",
            goalMinutes,
            0.5,
            1.0,
            Arrays.asList("pause", "framing"),
            Arrays.asList("breath", "alternative", "reflection", "card", "pause", "framing"),
            new int[] {3, 5, 10},
            new int[] {10, 5, 3},
            3,
            3,
            6,
            Arrays.asList("guilt", "yesterday", "motivate", "weekly", "future", "average", "goal", "sleep"));
    }

    /** Reads the table the web side stored. Anything unreadable keeps its default. */
    static GuardPolicy fromJson(String raw, int fallbackGoal) {
        GuardPolicy base = defaults(fallbackGoal);
        if (raw == null || raw.isEmpty()) return base;
        try {
            JSONObject json = new JSONObject(raw);
            JSONObject methods = json.optJSONObject("methods");
            GuardPolicy policy = new GuardPolicy(
                json.optString("version", base.version),
                json.optInt("goalMinutes", base.goalMinutes),
                json.optDouble("mediumAt", base.mediumAt),
                json.optDouble("strongAt", base.strongAt),
                strings(methods == null ? null : methods.optJSONArray("light"), base.lightMethods),
                strings(methods == null ? null : methods.optJSONArray("medium"), base.mediumMethods),
                ints(json.optJSONArray("commitOptions"), base.commitOptions),
                ints(json.optJSONArray("extensionLadder"), base.extensionLadder),
                json.optInt("overdraftMinutes", base.overdraftMinutes),
                json.optInt("overdraftWaitSec", base.overdraftWaitSec),
                json.optInt("dayEndHour", base.dayEndHour),
                strings(json.optJSONArray("framings"), base.framings));
            policy.stats = stats(json.optJSONObject("stats"));
            policy.ai = ai(json.optJSONObject("ai"));
            policy.studyMode = json.optBoolean("studyMode", false);
            policy.compare = compare(json.optJSONObject("compare"));
            return policy;
        } catch (Exception e) {
            return base;
        }
    }

    private static Ai ai(JSONObject json) {
        Ai ai = new Ai();
        if (json == null) return ai;
        ai.enabled = json.optBoolean("enabled", false);
        ai.strict = json.optBoolean("strict", false);
        ai.methods = table(json.optJSONObject("methods"));
        ai.framings = table(json.optJSONObject("framings"));
        JSONArray hours = json.optJSONArray("riskHours");
        if (hours != null) {
            for (int i = 0; i < hours.length(); i++) {
                int hour = hours.optInt(i, -1);
                if (hour < 0 || hour > 23) continue;
                if (ai.firstRiskHour < 0 || hour < ai.firstRiskHour) ai.firstRiskHour = hour;
            }
        }
        ai.riskLabel = json.optString("riskLabel", "");
        JSONObject risk = json.optJSONObject("risk");
        if (risk != null) {
            ai.riskCommitMax = Math.max(1, risk.optInt("commitMax", ai.riskCommitMax));
            ai.riskOverdraftWaitSec = Math.max(0, risk.optInt("overdraftWaitSec", ai.riskOverdraftWaitSec));
        }
        ai.feedbackEvery = Math.max(1, json.optInt("feedbackEvery", ai.feedbackEvery));
        JSONObject habituation = json.optJSONObject("habituation");
        if (habituation != null) {
            ai.habituationStrength = Math.max(0, Math.min(1, habituation.optDouble("strength", 0)));
            ai.habituationRecoveryHours = Math.max(0.1, habituation.optDouble("recoveryHours", 6));
        }
        ai.model = ai.enabled ? model(json.optJSONObject("model")) : null;
        ai.tighten = table(json.optJSONObject("tighten"));
        return ai;
    }

    private static Compare compare(JSONObject json) {
        if (json == null) return null;
        int[] shortOf10 = tens(json.optJSONArray("short"));
        int[] exitOf10 = tens(json.optJSONArray("exit"));
        if (shortOf10 == null || exitOf10 == null) return null;
        return new Compare(json.optBoolean("demo", false), shortOf10, exitOf10);
    }

    /** 24 numbers 1..10, or 0 where the web side sent null. */
    private static int[] tens(JSONArray array) {
        if (array == null || array.length() != 24) return null;
        int[] out = new int[24];
        for (int i = 0; i < 24; i++) {
            int n = array.isNull(i) ? 0 : array.optInt(i, 0);
            out[i] = n >= 1 && n <= 10 ? n : 0;
        }
        return out;
    }

    /** Null unless every array has the length the transform needs. */
    private static Model model(JSONObject json) {
        if (json == null) return null;
        int n = GuardRisk.transform(new double[GuardRisk.RAW_COUNT], new double[15], 1).length;
        double[] mean = doubles(json.optJSONArray("mean"));
        double[] std = doubles(json.optJSONArray("std"));
        double[] weights = doubles(json.optJSONArray("weights"));
        double[] bands = doubles(json.optJSONArray("bands"));
        if (mean == null || std == null || weights == null || bands == null) return null;
        if (mean.length != n || std.length != n || weights.length != n || bands.length != 2) return null;
        for (double v : std) if (v <= 0) return null;
        return new Model(
            json.optString("version", ""),
            mean,
            std,
            weights,
            json.optDouble("bias", 0),
            bands,
            json.optDouble("cap", 720),
            json.optDouble("kept7", 0.75),
            json.optBoolean("keepingGoal", false));
    }

    private static double[] doubles(JSONArray array) {
        if (array == null) return null;
        double[] out = new double[array.length()];
        for (int i = 0; i < out.length; i++) {
            double v = array.optDouble(i, Double.NaN);
            if (Double.isNaN(v) || Double.isInfinite(v)) return null;
            out[i] = v;
        }
        return out;
    }

    private static Map<String, Map<String, double[]>> table(JSONObject json) {
        Map<String, Map<String, double[]>> out = new HashMap<>();
        if (json == null) return out;
        Iterator<String> contexts = json.keys();
        while (contexts.hasNext()) {
            String context = contexts.next();
            JSONObject arms = json.optJSONObject(context);
            if (arms == null) continue;
            Map<String, double[]> row = new HashMap<>();
            Iterator<String> names = arms.keys();
            while (names.hasNext()) {
                String arm = names.next();
                JSONArray ab = arms.optJSONArray(arm);
                if (ab == null || ab.length() < 2) continue;
                row.put(arm, new double[] {ab.optDouble(0, 1), ab.optDouble(1, 1)});
            }
            out.put(context, row);
        }
        return out;
    }

    private static Stats stats(JSONObject json) {
        Stats stats = new Stats();
        if (json == null) return stats;
        stats.avg7Seconds = json.optDouble("avg7Seconds", -1);
        stats.pastWeekSeconds = json.optDouble("pastWeekSeconds", -1);
        stats.daysBeforeToday = json.optInt("daysBeforeToday", 0);
        stats.wakeHour = json.optInt("wakeHour", 7);
        stats.wakeMinute = json.optInt("wakeMinute", 0);
        JSONArray cumulative = json.optJSONArray("yesterdayCumulative");
        if (cumulative != null && cumulative.length() == 24) {
            stats.yesterdayCumulative = new double[24];
            for (int i = 0; i < 24; i++) stats.yesterdayCumulative[i] = cumulative.optDouble(i, 0);
        }
        return stats;
    }

    double ratio(double seconds) {
        return seconds / (goalMinutes * 60.0);
    }

    int band(double seconds) {
        double r = ratio(seconds);
        if (r >= strongAt) return BAND_STRONG;
        if (r >= mediumAt) return BAND_MEDIUM;
        return BAND_LIGHT;
    }

    double remainingSeconds(double seconds) {
        return Math.max(0, goalMinutes * 60.0 - seconds);
    }

    List<String> methodsFor(int band) {
        return band == BAND_LIGHT ? lightMethods : mediumMethods;
    }

    /**
     * Commitment choices for this round: within the extension ladder step and the
     * remaining budget. When less than the smallest option is left, offers the
     * remaining whole minutes (at least 1).
     */
    List<Integer> commitChoices(double remainingSeconds, int extensionIndex) {
        int cap = extensionIndex <= 0
            ? Integer.MAX_VALUE
            : extensionLadder[Math.min(extensionIndex, extensionLadder.length) - 1];
        int remainingMinutes = (int) Math.floor(remainingSeconds / 60.0);
        List<Integer> out = new ArrayList<>();
        for (int option : commitOptions) {
            if (option <= cap && option <= remainingMinutes) out.add(option);
        }
        if (out.isEmpty() && remainingSeconds >= 30) {
            int fallback = Math.max(1, Math.min(cap, (int) Math.ceil(remainingSeconds / 60.0)));
            out.add(fallback);
        }
        Collections.sort(out);
        return out;
    }

    /** Next local {@link #dayEndHour}:00 strictly after {@code now} ("오늘은 끝" until then). */
    long nextDayEnd(long now, TimeZone zone) {
        Calendar cal = Calendar.getInstance(zone);
        cal.setTimeInMillis(now);
        cal.set(Calendar.HOUR_OF_DAY, dayEndHour);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= now) cal.add(Calendar.DAY_OF_MONTH, 1);
        return cal.getTimeInMillis();
    }

    private static List<String> strings(JSONArray array, List<String> fallback) {
        if (array == null || array.length() == 0) return fallback;
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "");
            if (!value.isEmpty()) out.add(value);
        }
        return out.isEmpty() ? fallback : out;
    }

    private static int[] ints(JSONArray array, int[] fallback) {
        if (array == null || array.length() == 0) return fallback;
        int[] out = new int[array.length()];
        for (int i = 0; i < array.length(); i++) out[i] = Math.max(1, array.optInt(i, 1));
        return out;
    }
}
