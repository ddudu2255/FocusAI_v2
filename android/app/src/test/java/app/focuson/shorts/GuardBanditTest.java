package app.focuson.shorts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.Test;

public class GuardBanditTest {
    @Test
    public void betaDrawsAverageToTheMean() {
        Random random = new Random(7);
        double sum = 0;
        int n = 20000;
        for (int i = 0; i < n; i++) sum += GuardBandit.beta(8, 2, random);
        assertEquals(0.8, sum / n, 0.01);
        double small = 0;
        for (int i = 0; i < n; i++) small += GuardBandit.beta(0.5, 0.5, random);
        assertEquals(0.5, small / n, 0.02);
    }

    @Test
    public void picksTheStrongerArmMostOfTheTime() {
        Map<String, double[]> posteriors = new HashMap<>();
        posteriors.put("breath", new double[] {30, 5});   // stops ~86%
        posteriors.put("card", new double[] {5, 30});     // stops ~14%
        List<String> arms = Arrays.asList("breath", "card");
        Random random = new Random(42);
        int breath = 0;
        for (int i = 0; i < 1000; i++) {
            if ("breath".equals(GuardBandit.pick(arms, posteriors, random))) breath++;
        }
        assertTrue("breath picked " + breath, breath > 950);
    }

    @Test
    public void unseenArmsStillGetTried() {
        Map<String, double[]> posteriors = new HashMap<>();
        posteriors.put("pause", new double[] {6, 6}); // middling, some data
        List<String> arms = Arrays.asList("pause", "reflection"); // reflection: no record → Beta(1, 1)
        Random random = new Random(3);
        int reflection = 0;
        for (int i = 0; i < 1000; i++) {
            if ("reflection".equals(GuardBandit.pick(arms, posteriors, random))) reflection++;
        }
        assertTrue("reflection picked " + reflection, reflection > 300 && reflection < 700);
    }

    @Test
    public void handlesEmptyAndMissingTables() {
        assertNull(GuardBandit.pick(Arrays.<String>asList(), null, new Random(1)));
        assertEquals("only", GuardBandit.pick(Arrays.asList("only"), null, new Random(1)));
        assertEquals(0.5, GuardBandit.mean(null), 0.0);
    }

    @Test
    public void recentlyShownArmsAreLessLikelyForAWhile() {
        Map<String, double[]> posteriors = new HashMap<>();
        posteriors.put("breath", new double[] {6, 6});
        posteriors.put("card", new double[] {6, 6});
        List<String> arms = Arrays.asList("breath", "card");
        long now = 100L * 3_600_000L;
        Map<String, Long> shown = new HashMap<>();
        shown.put("breath", now - 60_000L); // a minute ago
        Random random = new Random(11);
        int breath = 0;
        for (int i = 0; i < 2000; i++) {
            if ("breath".equals(GuardBandit.pick(arms, posteriors, random, shown, now, 0.3, 6))) breath++;
        }
        assertTrue("breath picked " + breath, breath < 800);

        // Off (strength 0) or long ago: back to an even split.
        assertEquals(1.0, GuardBandit.freshness(now - 60_000L, now, 0, 6), 0.0);
        assertEquals(1.0, GuardBandit.freshness(0L, now, 0.3, 6), 0.0);
        assertEquals(0.7, GuardBandit.freshness(now, now, 0.3, 6), 1e-9);
        assertEquals(0.85, GuardBandit.freshness(now - 6 * 3_600_000L, now, 0.3, 6), 1e-9);
        assertTrue(GuardBandit.freshness(now - 72 * 3_600_000L, now, 0.3, 6) > 0.999);
    }

    @Test
    public void looksUpWeekdayCellsThenFallsBackToOldKeys() {
        GuardPolicy.Ai ai = new GuardPolicy.Ai();
        Map<String, double[]> weekend = new HashMap<>();
        weekend.put("breath", new double[] {9, 1});
        Map<String, double[]> old = new HashMap<>();
        old.put("card", new double[] {2, 2});
        ai.methods.put("2:night:weekend", weekend);
        ai.methods.put("2:day", old);
        java.util.Calendar saturdayNight = java.util.Calendar.getInstance();
        saturdayNight.set(2026, java.util.Calendar.OCTOBER, 10, 23, 0); // Saturday
        java.util.Calendar mondayNoon = java.util.Calendar.getInstance();
        mondayNoon.set(2026, java.util.Calendar.OCTOBER, 12, 13, 0); // Monday
        assertEquals("weekend", GuardPolicy.dayType(saturdayNight));
        assertEquals("weekday", GuardPolicy.dayType(mondayNoon));
        assertEquals(weekend, ai.methodsAt(2, saturdayNight));
        assertEquals(old, ai.methodsAt(2, mondayNoon));
        assertNull(ai.methodsAt(1, mondayNoon));
    }

    @Test
    public void timeSlotsMatchTheWebSide() {
        assertEquals("morning", GuardPolicy.timeSlot(5));
        assertEquals("day", GuardPolicy.timeSlot(11));
        assertEquals("evening", GuardPolicy.timeSlot(21));
        assertEquals("night", GuardPolicy.timeSlot(22));
        assertEquals("night", GuardPolicy.timeSlot(3));
    }
}
