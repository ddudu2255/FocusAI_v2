package app.focuson.shorts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class GuardCopyTest {
    private static GuardCopy.Facts facts(double usageMin, double goalMin) {
        GuardCopy.Facts f = new GuardCopy.Facts();
        f.usage = usageMin * 60;
        f.goal = goalMin * 60;
        return f;
    }

    @Test
    public void minutesReadNaturally() {
        assertEquals("23분", GuardCopy.minutes(23 * 60 + 10));
        assertEquals("2시간 40분", GuardCopy.minutes(160 * 60));
        assertEquals("1시간", GuardCopy.minutes(3600));
        assertEquals("1분", GuardCopy.minutes(5));
    }

    @Test
    public void timeLinesNeedTheirNumbers() {
        GuardCopy.Facts f = facts(23, 30);
        assertEquals("오늘 쇼츠에 쓴 23분, 다시 돌아오지 않아요.", GuardCopy.insight("guilt", f));
        assertEquals("지금 멈추면 오늘 목표 안에서 끝낼 수 있어요. (7분 남음)", GuardCopy.insight("motivate", f));
        assertEquals("정한 30분 중 23분을 썼어요.", GuardCopy.insight("goal", f));
        // Unknown numbers: skipped.
        assertNull(GuardCopy.insight("yesterday", f));
        assertNull(GuardCopy.insight("average", f));
        assertNull(GuardCopy.insight("weekly", f));
        assertNull(GuardCopy.insight("sleep", f));
        // Less than a minute watched: nothing to say yet.
        assertNull(GuardCopy.insight("guilt", facts(0.5, 30)));

        f.yesterdayByNow = 12 * 60;
        f.avg7 = 15 * 60;
        f.weekProjection = 160 * 60;
        assertEquals("어제 이 시간엔 12분이었는데, 오늘은 벌써 23분이에요.", GuardCopy.insight("yesterday", f));
        assertEquals("이번 주 평균보다 8분 더 보고 있어요.", GuardCopy.insight("average", f));
        assertEquals("이 속도면 이번 주에 2시간 40분을 쇼츠에 써요.", GuardCopy.insight("weekly", f));

        f.sleepSeconds = (6 * 60 + 20) * 60;
        f.sleepBasis = "7:10 알람 기준";
        assertEquals("지금 자면 6시간 20분 잘 수 있어요. 10분 더 보면 6시간 10분이에요. (7:10 알람 기준)",
            GuardCopy.insight("sleep", f));
    }

    @Test
    public void overdraftLinesEscalate() {
        GuardCopy.Facts f = facts(26, 20);
        assertEquals("오늘 1번째 3분이에요", GuardCopy.overdraftTitle(1, 3));
        assertTrue(GuardCopy.overdraft(1, 3, f).startsWith("오늘 목표를 넘어서 보는 첫 3분"));
        assertEquals("벌써 두 번째 3분이에요. 이번 3분까지 목표보다 9분 더 보게 돼요.", GuardCopy.overdraft(2, 3, f));
        assertEquals("오늘 목표보다 6분 넘게 봤어요. 4번째 3분이에요.", GuardCopy.overdraft(4, 3, f));
        f.yesterdayByNow = 12 * 60;
        assertEquals("오늘 목표보다 6분 넘게 봤어요. 어제는 이 시간까지 12분이었어요.", GuardCopy.overdraft(5, 3, f));
    }

    @Test
    public void praiseAndLockLines() {
        GuardCopy.Facts f = facts(10, 20);
        f.keptToday = 2;
        assertEquals("정한 만큼만 봤어요. 오늘 2번째예요.", GuardCopy.praise("kept", 1, f, 0));
        assertEquals("좋은 선택이에요. 30분 뒤에 다시 만나요.", GuardCopy.praise("lock", 1, f, 30));
        assertEquals("1시간, 폰 말고 다른 걸 해 볼 시간이에요.", GuardCopy.praise("lock", 2, f, 60));
        assertEquals("30분 잘 쉬었어요. 그동안 뭐 했어요?", GuardCopy.afterLockQuestion(30));
        assertEquals("12분 남았어요. 지금까지 오늘 45분 쉬었어요.", GuardCopy.locked(12 * 60_000L, 45 * 60));
        assertEquals("12분 남았어요.", GuardCopy.locked(12 * 60_000L, 0));
        assertEquals("약속한 3분 중 2분 남았어요.", GuardCopy.resumeToast(3, 110));
    }
}
