package app.focuson.shorts;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

public class GuardRiskTest {
    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");

    /** lib/risk-model.ts, made by scripts/risk-model/compare.py. The unit test runs in android/app. */
    private static String startModel() throws IOException {
        Path path = Paths.get("..", "..", "lib", "risk-model.ts");
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
    }

    private static double[] array(String text, String key) {
        Matcher m = Pattern.compile("\"" + key + "\":\\s*\\[([^\\]]*)\\]").matcher(text);
        assertTrue(key, m.find());
        return numbers(m.group(1));
    }

    private static double number(String text, String key) {
        Matcher m = Pattern.compile("\"" + key + "\":\\s*(-?[0-9.eE+-]+)").matcher(text);
        assertTrue(key, m.find());
        return Double.parseDouble(m.group(1));
    }

    private static double[] numbers(String list) {
        String[] parts = list.split(",");
        double[] out = new double[parts.length];
        for (int i = 0; i < parts.length; i++) out[i] = Double.parseDouble(parts[i].trim());
        return out;
    }

    private static GuardPolicy.Model model(String text) {
        return new GuardPolicy.Model(
            "lr-1",
            array(text, "mean"),
            array(text, "std"),
            array(text, "weights"),
            number(text, "bias"),
            array(text, "bands"),
            number(text, "cap"),
            0.75,
            false);
    }

    @Test
    public void givesTheSameProbabilitiesAsPythonAndTypeScript() throws IOException {
        String text = startModel();
        GuardPolicy.Model model = model(text);
        Matcher m = Pattern.compile("\"raw\":\\s*\\[([^\\]]*)\\],\\s*\"p\":\\s*([0-9.eE-]+)").matcher(text);
        int checks = 0;
        while (m.find()) {
            double[] raw = numbers(m.group(1));
            assertEquals(GuardRisk.RAW_COUNT, raw.length);
            assertEquals(Double.parseDouble(m.group(2)), GuardRisk.score(model, raw), 1e-6);
            checks++;
        }
        assertTrue("checks in risk-model.ts", checks >= 5);
    }

    @Test
    public void unknownReasonTakesTheAverage() throws IOException {
        double[] mean = array(startModel(), "mean");
        double[] x = GuardRisk.transform(new double[] {22, 0, 0.5, 3, 10, 0.2, 1e4, 0.5, 0.8, -1}, mean, 720);
        assertArrayEquals(Arrays.copyOfRange(mean, 10, 15), Arrays.copyOfRange(x, 10, 15), 0);
    }

    @Test
    public void bandsSplitAt20And40Percent() {
        double[] bands = {0.2, 0.4};
        assertEquals(GuardRisk.LOW, GuardRisk.band(0.19, bands));
        assertEquals(GuardRisk.MEDIUM, GuardRisk.band(0.2, bands));
        assertEquals(GuardRisk.MEDIUM, GuardRisk.band(0.39, bands));
        assertEquals(GuardRisk.HIGH, GuardRisk.band(0.4, bands));
    }

    @Test
    public void softTakesTheDecidedBehaviourOneStepWeaker() {
        assertEquals(GuardRisk.Action.SHORT, GuardRisk.action(GuardRisk.HIGH, GuardRisk.FULL, false));
        assertEquals(GuardRisk.Action.SUGGEST, GuardRisk.action(GuardRisk.HIGH, GuardRisk.SOFT, false));
        assertEquals(GuardRisk.Action.SUGGEST, GuardRisk.action(GuardRisk.MEDIUM, GuardRisk.FULL, false));
        assertEquals(GuardRisk.Action.NONE, GuardRisk.action(GuardRisk.MEDIUM, GuardRisk.SOFT, false));
        assertEquals(GuardRisk.Action.NONE, GuardRisk.action(GuardRisk.LOW, null, false));
    }

    @Test
    public void keepingTheGoalSoftensByOneStep() {
        assertEquals(GuardRisk.Action.SUGGEST, GuardRisk.action(GuardRisk.HIGH, GuardRisk.FULL, true));
        assertEquals(GuardRisk.Action.NONE, GuardRisk.action(GuardRisk.MEDIUM, GuardRisk.FULL, true));
        assertEquals(GuardRisk.Action.SUGGEST, GuardRisk.action(GuardRisk.HIGH, GuardRisk.SOFT, true));
    }

    @Test
    public void measuresTheMomentOfOpening() {
        Calendar cal = Calendar.getInstance(SEOUL);
        cal.clear();
        cal.set(2026, Calendar.OCTOBER, 24, 22, 30, 0); // Saturday
        long now = cal.getTimeInMillis();
        double[] raw = GuardRisk.features(cal, 600, 1200, 3, now - 5 * 60_000L, 300, 0, -1, 0.8, -1);
        assertArrayEquals(new double[] {22, 1, 0.5, 3, 5, 0.25, GuardRisk.NO_VALUE, 0, 0.8, -1}, raw, 1e-9);

        // A lock that ended 12 minutes ago counts; one still running does not.
        double[] ended = GuardRisk.features(cal, 0, 1200, 0, 0, 0, now - 12 * 60_000L, 300, 0.75, 2);
        assertEquals(12, ended[6], 1e-9);
        assertEquals(GuardRisk.NO_VALUE, ended[4], 0);
        assertEquals(0.25, ended[7], 1e-9);
        double[] running = GuardRisk.features(cal, 0, 1200, 0, 0, 0, now + 60_000L, 0, 0.75, 2);
        assertEquals(GuardRisk.NO_VALUE, running[6], 0);
    }

    @Test
    public void reasonsUseTheSheetOrder() {
        assertEquals(0, GuardRisk.reasonIndex("심심해서"));
        assertEquals(3, GuardRisk.reasonIndex("스트레스 해소를 위해"));
        assertEquals(-1, GuardRisk.reasonIndex("선택하지 않음"));
    }

    @Test
    public void highRiskOffersOnlyShortChoices() {
        assertEquals(Collections.singletonList(3), GuardFlow.capped(Arrays.asList(3, 5, 10), 3));
        // Less than 3 minutes left: keep what is offered.
        assertEquals(Collections.singletonList(2), GuardFlow.capped(Collections.singletonList(2), 3));
        assertEquals(Collections.singletonList(5), GuardFlow.capped(Collections.singletonList(5), 3));
        assertEquals(new ArrayList<Integer>(), GuardFlow.capped(new ArrayList<>(), 3));
    }

    @Test
    public void namesWhatPushedTheScoreUp() throws IOException {
        GuardPolicy.Model model = model(startModel());
        // Way past half the goal, otherwise ordinary.
        assertEquals(GuardRisk.Reason.TODAY,
            GuardRisk.topReason(model, new double[] {15, 0, 2.5, 1, 300, 0.1, 1e4, 0.5, 0.7, 1}));
        // Reopened a minute after closing.
        assertEquals(GuardRisk.Reason.REOPEN,
            GuardRisk.topReason(model, new double[] {15, 0, 0.6, 1, 0.5, 0.1, 1e4, 0.5, 0.7, 1}));
        // Nothing stands out: the general line.
        assertEquals(GuardRisk.Reason.GENERAL,
            GuardRisk.topReason(model, new double[] {15, 0, 0.9, 6, 30, 0.17, 360, 0.95, 0.7, 1}));
    }

    @Test
    public void sheetLinesFollowActionAndReason() {
        assertEquals(null, GuardCopy.riskNotice(GuardRisk.Action.NONE, GuardRisk.Reason.TODAY));
        assertEquals("AI · 방금 닫았다가 다시 열었어요. 3분씩 끊어서 볼게요",
            GuardCopy.riskNotice(GuardRisk.Action.SHORT, GuardRisk.Reason.REOPEN));
        assertEquals("AI · 방금 길게 봤어요. 이번엔 3분씩 끊어서 볼게요",
            GuardCopy.riskNotice(GuardRisk.Action.SHORT, GuardRisk.Reason.PREVIOUS));
        assertEquals("AI · 방금 닫았다가 다시 열었어요. 짧게 3분은 어때요?",
            GuardCopy.riskNotice(GuardRisk.Action.SUGGEST, GuardRisk.Reason.REOPEN));
        assertEquals("AI · 지금은 길어지기 쉬운 때라 3분씩 끊어서 볼게요",
            GuardCopy.riskNotice(GuardRisk.Action.SHORT, GuardRisk.Reason.GENERAL));
        assertEquals("AI · 지금은 길어지기 쉬워요. 짧게 3분은 어때요?",
            GuardCopy.riskNotice(GuardRisk.Action.SUGGEST, GuardRisk.Reason.GENERAL));
    }

    @Test
    public void scoreRisesWithTodaysShare() throws IOException {
        GuardPolicy.Model model = model(startModel());
        List<double[]> rows = Arrays.asList(
            new double[] {21, 0, 0.1, 2, 60, 0.1, 1e4, 0.3, 0.75, 1},
            new double[] {21, 0, 1.2, 2, 60, 0.1, 1e4, 0.3, 0.75, 1});
        assertTrue(GuardRisk.score(model, rows.get(1)) > GuardRisk.score(model, rows.get(0)));
    }
}
