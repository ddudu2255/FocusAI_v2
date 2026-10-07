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
    public void timeSlotsMatchTheWebSide() {
        assertEquals("morning", GuardPolicy.timeSlot(5));
        assertEquals("day", GuardPolicy.timeSlot(11));
        assertEquals("evening", GuardPolicy.timeSlot(21));
        assertEquals("night", GuardPolicy.timeSlot(22));
        assertEquals("night", GuardPolicy.timeSlot(3));
    }
}
