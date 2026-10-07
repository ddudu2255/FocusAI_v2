package app.focuson.shorts;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.TimeZone;
import org.junit.Test;

public class GuardPolicyTest {
    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");
    private final GuardPolicy policy = GuardPolicy.defaults(20);

    @Test
    public void bandsFollowShareOfGoal() {
        assertEquals(GuardPolicy.BAND_LIGHT, policy.band(0));
        assertEquals(GuardPolicy.BAND_LIGHT, policy.band(9.9 * 60));
        assertEquals(GuardPolicy.BAND_MEDIUM, policy.band(10 * 60));
        assertEquals(GuardPolicy.BAND_MEDIUM, policy.band(19.9 * 60));
        assertEquals(GuardPolicy.BAND_STRONG, policy.band(20 * 60));
        assertEquals(7 * 60, policy.remainingSeconds(13 * 60), 0.001);
        assertEquals(0, policy.remainingSeconds(25 * 60), 0.001);
    }

    @Test
    public void commitmentChoicesFitBudgetAndLadder() {
        assertEquals(Arrays.asList(3, 5, 10), policy.commitChoices(15 * 60, 0));
        assertEquals(Arrays.asList(3, 5), policy.commitChoices(7 * 60, 0));
        // Extension ladder: second ask caps at 10, third at 5, then 3.
        assertEquals(Arrays.asList(3, 5, 10), policy.commitChoices(15 * 60, 1));
        assertEquals(Arrays.asList(3, 5), policy.commitChoices(15 * 60, 2));
        assertEquals(Collections.singletonList(3), policy.commitChoices(15 * 60, 3));
        assertEquals(Collections.singletonList(3), policy.commitChoices(15 * 60, 9));
        // Less than the smallest option left: offer what is left, rounded up.
        assertEquals(Collections.singletonList(2), policy.commitChoices(100, 0));
        assertEquals(Collections.emptyList(), policy.commitChoices(10, 0));
    }

    @Test
    public void dayEndIsNextMorning() {
        Calendar cal = Calendar.getInstance(SEOUL);
        cal.clear();
        cal.set(2026, Calendar.OCTOBER, 6, 23, 30, 0);
        long night = cal.getTimeInMillis();
        cal.set(2026, Calendar.OCTOBER, 7, 6, 0, 0);
        assertEquals(cal.getTimeInMillis(), policy.nextDayEnd(night, SEOUL));

        cal.set(2026, Calendar.OCTOBER, 7, 2, 0, 0);
        long lateNight = cal.getTimeInMillis();
        cal.set(2026, Calendar.OCTOBER, 7, 6, 0, 0);
        assertEquals(cal.getTimeInMillis(), policy.nextDayEnd(lateNight, SEOUL));
    }
}
