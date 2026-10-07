package app.focuson.shorts;

import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/** Day keys, midnight splits and level bands. No Android types so it can be unit tested. */
public final class GuardTime {
    private GuardTime() {}

    /** Local date as yyyy-MM-dd, same format as todayKey() on the web side. */
    public static String dayKey(long millis, TimeZone zone) {
        Calendar cal = Calendar.getInstance(zone);
        cal.setTimeInMillis(millis);
        return String.format(Locale.ROOT, "%04d-%02d-%02d",
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    /** Start of the next local day after {@code millis}. */
    static long nextMidnight(long millis, TimeZone zone) {
        Calendar cal = Calendar.getInstance(zone);
        cal.setTimeInMillis(millis);
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        cal.add(Calendar.DAY_OF_MONTH, 1);
        return cal.getTimeInMillis();
    }

    /** Seconds of [start, end) that fall on each local date, in date order. */
    public static Map<String, Double> splitByDay(long start, long end, TimeZone zone) {
        Map<String, Double> out = new LinkedHashMap<>();
        if (end <= start) return out;
        long cursor = start;
        while (cursor < end) {
            long boundary = Math.min(end, nextMidnight(cursor, zone));
            String key = dayKey(cursor, zone);
            Double prev = out.get(key);
            out.put(key, (prev == null ? 0 : prev) + (boundary - cursor) / 1000.0);
            cursor = boundary;
        }
        return out;
    }

    /** Same bands as levelForUsage() in lib/logic.ts. */
    public static int levelFor(double seconds, int level1Minutes, int level3Minutes) {
        double minutes = seconds / 60.0;
        if (minutes < level1Minutes) return 1;
        if (minutes < level3Minutes) return 2;
        return 3;
    }
}
