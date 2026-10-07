package app.focuson.shorts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import java.util.Map;
import java.util.TimeZone;
import org.junit.Test;

public class GuardTimeTest {
    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");

    private static long at(int year, int month, int day, int hour, int minute, int second) {
        Calendar cal = Calendar.getInstance(SEOUL);
        cal.clear();
        cal.set(year, month - 1, day, hour, minute, second);
        return cal.getTimeInMillis();
    }

    @Test
    public void dayKeyUsesLocalDate() {
        assertEquals("2026-09-30", GuardTime.dayKey(at(2026, 9, 30, 23, 59, 59), SEOUL));
        assertEquals("2026-10-01", GuardTime.dayKey(at(2026, 10, 1, 0, 0, 0), SEOUL));
    }

    @Test
    public void splitsAcrossMidnight() {
        Map<String, Double> parts = GuardTime.splitByDay(
            at(2026, 9, 30, 23, 58, 0), at(2026, 10, 1, 0, 3, 0), SEOUL);
        assertEquals(2, parts.size());
        assertEquals(120.0, parts.get("2026-09-30"), 0.001);
        assertEquals(180.0, parts.get("2026-10-01"), 0.001);
    }

    @Test
    public void splitsWithinOneDayAndEmpty() {
        Map<String, Double> parts = GuardTime.splitByDay(
            at(2026, 10, 1, 10, 0, 0), at(2026, 10, 1, 10, 0, 45), SEOUL);
        assertEquals(45.0, parts.get("2026-10-01"), 0.001);
        assertTrue(GuardTime.splitByDay(5000, 5000, SEOUL).isEmpty());
        assertTrue(GuardTime.splitByDay(5000, 1000, SEOUL).isEmpty());
    }

    @Test
    public void levelBandsMatchWeb() {
        assertEquals(1, GuardTime.levelFor(0, 10, 20));
        assertEquals(1, GuardTime.levelFor(9.9 * 60, 10, 20));
        assertEquals(2, GuardTime.levelFor(10 * 60, 10, 20));
        assertEquals(2, GuardTime.levelFor(19.9 * 60, 10, 20));
        assertEquals(3, GuardTime.levelFor(20 * 60, 10, 20));
    }
}
