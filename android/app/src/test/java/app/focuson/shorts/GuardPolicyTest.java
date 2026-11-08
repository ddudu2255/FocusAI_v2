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
        assertEquals(Arrays.asList(1, 3, 5, 10), policy.commitChoices(15 * 60, 0));
        assertEquals(Arrays.asList(1, 3, 5), policy.commitChoices(7 * 60, 0));
        // Extension ladder: second ask caps at 10, third at 5, then 3.
        assertEquals(Arrays.asList(1, 3, 5, 10), policy.commitChoices(15 * 60, 1));
        assertEquals(Arrays.asList(1, 3, 5), policy.commitChoices(15 * 60, 2));
        assertEquals(Arrays.asList(1, 3), policy.commitChoices(15 * 60, 3));
        assertEquals(Arrays.asList(1, 3), policy.commitChoices(15 * 60, 9));
        // Under 3 minutes left: 1 fits, so only 1 is offered (decided 2026-11-04).
        assertEquals(Collections.singletonList(1), policy.commitChoices(100, 0));
        assertEquals(Collections.singletonList(1), policy.commitChoices(150, 0));
        // Less than the smallest option left: offer what is left, rounded up.
        assertEquals(Collections.singletonList(1), policy.commitChoices(45, 0));
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

    @Test
    public void loweredGoalStartsOnItsDayEvenWithoutTheApp() {
        // 오늘 이미 본 시간보다 낮춘 목표는 내일부터 (앱 홈·리포트와 같은 규칙)
        assertEquals(30, GuardPolicy.goalOn(30, "2026-11-09", 15, "2026-11-08"));
        assertEquals(15, GuardPolicy.goalOn(30, "2026-11-09", 15, "2026-11-09"));
        assertEquals(15, GuardPolicy.goalOn(30, "2026-11-09", 15, "2026-11-12"));
        assertEquals(30, GuardPolicy.goalOn(30, "", 0, "2026-11-12"));
    }
}
