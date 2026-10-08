package app.focuson.shorts;

import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Random;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Order of the steps inside one sheet. Intensity (band) comes from the policy table by
 * today's share of the goal; the method shown inside a band rotates (later: picked by the
 * AI phase through the same table). Wording comes from {@link GuardCopy}.
 *
 * Entry (light / medium): [after-lock question] → method → reason → commitment → play.
 * Commitment over: [band went up → that band's activity] → kept (leave) or extend.
 * Strong: day end / lock / "3분만 더" (through a nudge screen) / leave.
 * Locked ("쇼츠 쉬는 중"): remaining time, rest so far, optionally one study card.
 */
final class GuardFlow {
    interface Host {
        /** Resume playback and start a commitment timer. */
        void onWatch(String kind, int minutes, boolean overdraft, int extensionIndex, int band);

        void onLeave(String kind);

        void onBlock(String kind, long until, int minutes, boolean dayEnd);

        void record(JSONObject row);

        /** Numbers for the wording right now. */
        GuardCopy.Facts facts();

        /** True while the Shorts being handled plays in a picture-in-picture window. */
        boolean inPip();
    }

    private static final long PRAISE_MS = 1600L;
    private static final long CARD_RESULT_MS = 1200L;
    private static final int PAUSE_SEC = 5;
    private static final int ALTERNATIVE_SEC = 30;
    private static final int SKIP_AFTER_SEC = 10;
    private static final int BREATH_CYCLES = 3;
    private static final long INHALE_MS = 4000L;
    private static final long HOLD_MS = 2000L;
    private static final long EXHALE_MS = 4000L;
    private static final int LOCK_AUTO_LEAVE_SEC = 5;
    private static final int LOCK_CARD_WAIT_SEC = 20;
    private static final long FEEDBACK_WAIT_MS = 4500L;

    private final Context context;
    private final GuardOverlay overlay;
    private final Handler handler;
    private final Host host;

    /** The record for the sheet on screen; written once, on whatever ends it. */
    private Rec open;
    /** Policy of the sheet on screen (null for the lock sheet). */
    private GuardPolicy openPolicy;
    private final Random random = new Random();

    GuardFlow(Context context, GuardOverlay overlay, Handler handler, Host host) {
        this.context = context;
        this.overlay = overlay;
        this.handler = handler;
        this.host = host;
    }

    // --- Entry points ----------------------------------------------------------

    void entry(String kind, double usage, GuardPolicy policy, boolean afterLock) {
        int band = policy.band(usage);
        Rec rec = begin(kind, "entry", band, usage, policy);
        overlay.leave("나가기", () -> finishExit(rec, "exit"));
        Runnable afterMethod = () -> reason(rec, () -> commitment(rec, policy, 0, "watch"));
        Runnable start = () -> method(rec, policy, band, afterMethod);
        if (afterLock) afterLock(rec, start);
        else start.run();
    }

    void commitmentOver(String kind, double usage, GuardPolicy policy, int minutes, int extensionIndex, int previousBand) {
        int band = policy.band(usage);
        if (band == GuardPolicy.BAND_STRONG) {
            strong(kind, usage, policy, "정한 시간이 끝났고, 오늘 목표도 다 썼어요.", false);
            return;
        }
        Rec rec = begin(kind, "commit_end", band, usage, policy);
        rec.extensionIndex = extensionIndex;
        boolean canExtend = !policy.ai.strict
            && !(policy.ai.isRiskHour(hourNow()) && extensionIndex + 1 > policy.ai.riskExtensionMax);
        Runnable choices = () -> {
            View body = null;
            if (canExtend) {
                TextView more = overlay.button("조금 더 볼래요", false);
                more.setOnClickListener(v -> commitment(rec, policy, extensionIndex + 1, "extend"));
                body = wrap(more, 52);
            }
            String line = GuardCopy.commitmentOver(GuardState.nextIndex(context, "s2"), host.facts());
            overlay.step("정한 " + minutes + "분이 됐어요", line, body);
            overlay.leave("약속 지키고 나가기", () -> finishExit(rec, "kept"));
        };
        overlay.leave("약속 지키고 나가기", () -> finishExit(rec, "kept"));
        if (band > previousBand) {
            // Crossed into the medium band while watching: its activity comes first.
            method(rec, policy, band, choices);
        } else {
            choices.run();
        }
    }

    void strong(String kind, double usage, GuardPolicy policy, String headline, boolean afterLock) {
        Rec rec = begin(kind, "strong", GuardPolicy.BAND_STRONG, usage, policy);
        overlay.leave("지금은 나가기", () -> finishExit(rec, "exit"));
        Runnable show = () -> strongChoices(rec, policy, headline);
        if (afterLock) afterLock(rec, show);
        else show.run();
    }

    void locked(String kind, long until) {
        Rec rec = begin(kind, "locked", GuardPolicy.BAND_STRONG, 0, null);
        rec.recorded = true; // The lock attempt row is written by the service.
        GuardCopy.Facts facts = host.facts();
        overlay.gauge(1, 0, GuardPolicy.BAND_STRONG);
        LinearLayout box = overlay.vertical();
        TextView remaining = overlay.text(GuardCopy.countdown(until - System.currentTimeMillis()), 48, GuardOverlay.TEXT, true);
        remaining.setGravity(Gravity.CENTER);
        remaining.setPadding(0, overlay.dp(4), 0, overlay.dp(8));
        box.addView(remaining);
        overlay.step(GuardCopy.LOCKED_TITLE, GuardCopy.locked(until - System.currentTimeMillis(), facts.restToday), box);
        overlay.leave("나가기", () -> leaveQuietly(kind));

        JSONObject card = GuardState.hasCards(context) ? GuardState.nextCard(context) : null;
        boolean[] answering = {false};
        if (card != null) {
            // Turn the urge into one question while resting (rest time keeps counting).
            Rec cardRec = new Rec(kind, "locked", GuardPolicy.BAND_STRONG, 0, "");
            cardRec.method = "card";
            TextView prompt = overlay.text("이 문제 하나만 풀고 가요.", 14, GuardOverlay.MUTED, false);
            prompt.setPadding(0, overlay.dp(4), 0, overlay.dp(4));
            box.addView(prompt);
            View cardView = cardView(cardRec, card, () -> {
                cardRec.outcome = "blocked_retry";
                host.record(cardRec.toJson());
                leaveQuietly(kind);
            }, () -> answering[0] = true);
            if (cardView != null) box.addView(cardView);
        }
        // Leave by itself after a few seconds; with a card, give time to read it, and once
        // an option is tapped wait for the user to finish.
        long leaveAt = SystemClock.uptimeMillis() + (card == null ? LOCK_AUTO_LEAVE_SEC : LOCK_CARD_WAIT_SEC) * 1000L;
        overlay.startTicker(250, () -> {
            long left = until - System.currentTimeMillis();
            remaining.setText(GuardCopy.countdown(left));
            if (left <= 0 || (!answering[0] && SystemClock.uptimeMillis() >= leaveAt)) {
                leaveQuietly(kind);
                return false;
            }
            return true;
        });
    }

    /** The user left the player while a sheet was up: record it as an exit without a choice. */
    void abandon() {
        Rec rec = open;
        open = null;
        if (rec != null && !rec.recorded) {
            rec.outcome = "exit";
            write(rec);
        }
        overlay.dismissNow();
    }

    // --- Steps -----------------------------------------------------------------

    private void afterLock(Rec rec, Runnable next) {
        List<TextView> chips = new ArrayList<>();
        for (String answer : GuardCopy.AFTER_LOCK_ANSWERS) {
            TextView chip = overlay.chip(answer);
            chip.setOnClickListener(v -> {
                if (rec.afterLock != null) return;
                rec.afterLock = answer;
                overlay.tint(chip, GuardOverlay.CARD_ON);
                GuardState.markAfterLockAsked(context);
                handler.postDelayed(next, 200);
            });
            chips.add(chip);
        }
        overlay.step(
            GuardCopy.afterLockQuestion(GuardState.blockMinutes(context)), null, overlay.grid(chips, 3, 52));
    }

    private void method(Rec rec, GuardPolicy policy, int band, Runnable next) {
        List<String> options = new ArrayList<>();
        for (String m : policy.methodsFor(band)) {
            if ("card".equals(m) && !GuardState.hasCards(context)) continue;
            if ("framing".equals(m) && rec.usage < 60) continue;
            if (isKnownMethod(m)) options.add(m);
        }
        String picked;
        if (policy.ai.enabled) {
            // AI: Thompson sampling over what worked for this band, time of day and
            // weekday/weekend, leaning away from a method shown very recently (habituation).
            Calendar now = Calendar.getInstance();
            picked = GuardBandit.pick(
                options,
                policy.ai.methodsAt(band, now),
                random,
                GuardState.lastShown(context, "method", options),
                now.getTimeInMillis(),
                policy.ai.habituationStrength,
                policy.ai.habituationRecoveryHours);
        } else {
            picked = GuardState.nextInTurn(context, "band" + band, options);
        }
        if (picked == null) picked = "pause";
        GuardState.markShown(context, "method", picked, System.currentTimeMillis());
        rec.method = picked;
        switch (picked) {
            case "framing":
                framing(rec, policy, next);
                break;
            case "breath":
                breath(rec, next);
                break;
            case "alternative":
                alternative(rec, next);
                break;
            case "reflection":
                reflection(rec, next);
                break;
            case "card":
                card(rec, policy, next);
                break;
            default:
                pause(rec, policy, next);
        }
    }

    private static boolean isKnownMethod(String m) {
        return "pause".equals(m) || "framing".equals(m) || "breath".equals(m)
            || "alternative".equals(m) || "reflection".equals(m) || "card".equals(m);
    }

    /** S1 line in turn, skipping kinds whose numbers are unknown right now. */
    private String pickInsight(Rec rec, GuardPolicy policy) {
        GuardCopy.Facts facts = host.facts();
        List<String> kinds = policy.framings;
        if (policy.ai.enabled) {
            List<String> usable = new ArrayList<>();
            for (String kind : kinds) {
                if (GuardCopy.insight(kind, facts) != null) usable.add(kind);
            }
            Calendar now = Calendar.getInstance();
            String kind = GuardBandit.pick(
                usable,
                policy.ai.framingsAt(now),
                random,
                GuardState.lastShown(context, "framing", usable),
                now.getTimeInMillis(),
                policy.ai.habituationStrength,
                policy.ai.habituationRecoveryHours);
            if (kind == null) return null;
            GuardState.markShown(context, "framing", kind, now.getTimeInMillis());
            rec.framing = kind;
            return GuardCopy.insight(kind, facts);
        }
        int start = GuardState.nextIndex(context, "framing");
        for (int i = 0; i < kinds.size(); i++) {
            String kind = kinds.get(Math.floorMod(start + i, kinds.size()));
            String line = GuardCopy.insight(kind, facts);
            if (line != null) {
                rec.framing = kind;
                return line;
            }
        }
        return null;
    }

    private void pause(Rec rec, GuardPolicy policy, Runnable next) {
        rec.verification = "waited";
        TextView count = overlay.text(String.valueOf(PAUSE_SEC), 64, GuardOverlay.TEXT, true);
        count.setGravity(Gravity.CENTER);
        overlay.step("한 박자만 쉬어 볼게요", pickInsight(rec, policy), count);
        long endAt = SystemClock.uptimeMillis() + PAUSE_SEC * 1000L;
        overlay.startTicker(250, () -> {
            long left = endAt - SystemClock.uptimeMillis();
            if (left <= 0) {
                next.run();
                return false;
            }
            count.setText(String.valueOf((left + 999) / 1000));
            return true;
        });
    }

    private void framing(Rec rec, GuardPolicy policy, Runnable next) {
        String line = pickInsight(rec, policy);
        if (line == null) {
            rec.method = "pause";
            pause(rec, policy, next);
            return;
        }
        rec.verification = "seen";
        LinearLayout box = overlay.vertical();
        TextView text = overlay.text(line, 20, GuardOverlay.TEXT, true);
        text.setPadding(0, overlay.dp(4), 0, overlay.dp(16));
        box.addView(text);
        TextView go = overlay.button("확인했어요", true);
        go.setOnClickListener(v -> next.run());
        box.addView(go, overlay.matchHeight(52));
        overlay.step("잠깐, 오늘 쓴 시간이에요", null, box);
    }

    /** Guided breathing: text and a growing / shrinking circle, no pressing. */
    private void breath(Rec rec, Runnable next) {
        LinearLayout box = overlay.vertical();
        FrameLayout stage = new FrameLayout(context);
        View circle = new View(context);
        circle.setBackground(overlay.oval(GuardOverlay.CARD_ON));
        int size = overlay.dp(120);
        stage.addView(circle, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        TextView cue = overlay.text("", 18, GuardOverlay.TEXT, true);
        cue.setGravity(Gravity.CENTER);
        stage.addView(cue, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        box.addView(stage, overlay.matchHeight(150));
        TextView status = overlay.text("", 14, GuardOverlay.MUTED, false);
        status.setGravity(Gravity.CENTER);
        box.addView(status);
        TextView skip = overlay.text("", 13, GuardOverlay.MUTED, false);
        skip.setGravity(Gravity.CENTER);
        skip.setPadding(0, overlay.dp(10), 0, 0);
        box.addView(skip);

        overlay.step("숨 한 번 고르고 갈게요", "원을 따라 천천히 숨 쉬어 보세요. " + BREATH_CYCLES + "번이에요.", box);
        long cycleMs = INHALE_MS + HOLD_MS + EXHALE_MS;
        long start = SystemClock.uptimeMillis();
        boolean[] done = {false};
        skip.setOnClickListener(v -> {
            if (done[0] || SystemClock.uptimeMillis() - start < SKIP_AFTER_SEC * 1000L) return;
            done[0] = true;
            rec.verification = "skipped";
            next.run();
        });
        overlay.startTicker(100, () -> {
            if (done[0]) return false;
            long elapsed = SystemClock.uptimeMillis() - start;
            int cycle = (int) (elapsed / cycleMs);
            if (cycle >= BREATH_CYCLES) {
                done[0] = true;
                rec.verification = "waited";
                next.run();
                return false;
            }
            long in = elapsed % cycleMs;
            float phase;
            String text;
            if (in < INHALE_MS) {
                phase = in / (float) INHALE_MS;
                text = "들이마셔요";
            } else if (in < INHALE_MS + HOLD_MS) {
                phase = 1f;
                text = "참아요";
            } else {
                phase = 1f - (in - INHALE_MS - HOLD_MS) / (float) EXHALE_MS;
                text = "내쉬어요";
            }
            float scale = 0.55f + 0.45f * phase;
            circle.setScaleX(scale);
            circle.setScaleY(scale);
            cue.setText(text);
            status.setText((cycle + 1) + " / " + BREATH_CYCLES);
            long waitLeft = SKIP_AFTER_SEC * 1000L - elapsed;
            skip.setText(waitLeft > 0 ? "건너뛰기 (" + ((waitLeft + 999) / 1000) + ")" : "건너뛰기");
            return true;
        });
    }

    private void alternative(Rec rec, Runnable next) {
        List<String> labels = new ArrayList<>();
        for (GuardCopy.Alternative alt : GuardCopy.ALTERNATIVES) labels.add(alt.label);
        String label = GuardState.nextInTurn(context, "alternative", labels);
        GuardCopy.Alternative alt = GuardCopy.ALTERNATIVES[Math.max(0, labels.indexOf(label))];
        rec.alternative = alt.label;

        LinearLayout box = overlay.vertical();
        TextView count = overlay.text(String.valueOf(ALTERNATIVE_SEC), 48, GuardOverlay.TEXT, true);
        count.setGravity(Gravity.CENTER);
        box.addView(count);
        TextView did = overlay.button("했어요 (" + ALTERNATIVE_SEC + ")", true);
        LinearLayout.LayoutParams didLp = overlay.matchHeight(52);
        didLp.setMargins(0, overlay.dp(12), 0, 0);
        box.addView(did, didLp);
        TextView skip = overlay.text("", 13, GuardOverlay.MUTED, false);
        skip.setGravity(Gravity.CENTER);
        skip.setPadding(0, overlay.dp(10), 0, 0);
        box.addView(skip);
        overlay.step(alt.label, alt.guide, box);

        long start = SystemClock.uptimeMillis();
        boolean[] done = {false};
        did.setOnClickListener(v -> {
            if (done[0] || SystemClock.uptimeMillis() - start < ALTERNATIVE_SEC * 1000L) return;
            done[0] = true;
            rec.verification = "self";
            next.run();
        });
        skip.setOnClickListener(v -> {
            if (done[0] || SystemClock.uptimeMillis() - start < SKIP_AFTER_SEC * 1000L) return;
            done[0] = true;
            rec.verification = "skipped";
            next.run();
        });
        overlay.startTicker(250, () -> {
            if (done[0]) return false;
            long elapsed = SystemClock.uptimeMillis() - start;
            long left = ALTERNATIVE_SEC * 1000L - elapsed;
            count.setText(String.valueOf(Math.max(0, (left + 999) / 1000)));
            did.setText(left > 0 ? "했어요 (" + ((left + 999) / 1000) + ")" : "했어요");
            long skipLeft = SKIP_AFTER_SEC * 1000L - elapsed;
            skip.setText(skipLeft > 0 ? "건너뛰기 (" + ((skipLeft + 999) / 1000) + ")" : "건너뛰기");
            return true;
        });
    }

    private void reflection(Rec rec, Runnable next) {
        List<TextView> chips = new ArrayList<>();
        for (String answer : GuardCopy.REFLECTION_ANSWERS) {
            TextView chip = overlay.chip(answer);
            chip.setOnClickListener(v -> {
                if (rec.reflection != null) return;
                rec.reflection = answer;
                rec.verification = "answered";
                overlay.tint(chip, GuardOverlay.CARD_ON);
                handler.postDelayed(next, 200);
            });
            chips.add(chip);
        }
        overlay.step(GuardCopy.REFLECTION_QUESTION, "솔직하게 하나만 골라 보세요.", overlay.grid(chips, 2, 52));
    }

    private void card(Rec rec, GuardPolicy policy, Runnable next) {
        JSONObject card = GuardState.nextCard(context);
        View view = card == null ? null : cardView(rec, card, next, null);
        if (view == null) {
            rec.method = "pause";
            pause(rec, policy, next);
            return;
        }
        overlay.step("한 문제만 풀고 가요", card.optString("question", ""), view);
    }

    /**
     * Options of one study card. After a choice: colours, then the explanation (if any)
     * with a "계속" button, or a short pause without one.
     * @return null when the card is unusable
     */
    private View cardView(Rec rec, JSONObject card, Runnable next, Runnable onAnswering) {
        JSONArray options = card.optJSONArray("options");
        if (options == null || options.length() < 2) return null;
        rec.cardId = card.optString("id", null);
        int answer = card.optInt("answer", -1);
        String explanation = card.optString("explanation", "").trim();
        LinearLayout box = overlay.vertical();
        if (onAnswering != null) {
            TextView question = overlay.text(card.optString("question", ""), 16, GuardOverlay.TEXT, true);
            question.setPadding(0, overlay.dp(4), 0, overlay.dp(4));
            box.addView(question);
        }
        List<TextView> buttons = new ArrayList<>();
        boolean[] answered = {false};
        TextView note = overlay.text("", 14, GuardOverlay.MUTED, false);
        note.setPadding(0, overlay.dp(8), 0, 0);
        note.setVisibility(View.GONE);
        TextView go = overlay.button("계속", true);
        go.setVisibility(View.GONE);
        go.setOnClickListener(v -> next.run());
        for (int i = 0; i < options.length(); i++) {
            int index = i;
            TextView option = overlay.chip(options.optString(i, ""));
            option.setGravity(Gravity.CENTER_VERTICAL);
            option.setPadding(overlay.dp(14), 0, overlay.dp(14), 0);
            option.setOnClickListener(v -> {
                if (answered[0]) return;
                answered[0] = true;
                if (onAnswering != null) onAnswering.run();
                rec.cardCorrect = index == answer;
                rec.verification = "answered";
                overlay.tint(option, rec.cardCorrect ? GuardOverlay.GOOD : GuardOverlay.BAD);
                if (!rec.cardCorrect && answer >= 0 && answer < buttons.size()) {
                    overlay.tint(buttons.get(answer), GuardOverlay.GOOD);
                }
                if (explanation.isEmpty()) {
                    handler.postDelayed(next, CARD_RESULT_MS);
                } else {
                    note.setText((rec.cardCorrect ? "정답이에요. " : "아쉬워요. ") + explanation);
                    note.setVisibility(View.VISIBLE);
                    go.setVisibility(View.VISIBLE);
                }
            });
            buttons.add(option);
        }
        box.addView(overlay.grid(buttons, 1, 52));
        box.addView(note);
        LinearLayout.LayoutParams goLp = overlay.matchHeight(48);
        goLp.setMargins(0, overlay.dp(10), 0, 0);
        box.addView(go, goLp);
        return box;
    }

    private void reason(Rec rec, Runnable next) {
        List<TextView> chips = new ArrayList<>();
        for (String reason : GuardCopy.REASONS) {
            TextView chip = overlay.chip(reason);
            chip.setOnClickListener(v -> {
                if (rec.reason != null) return;
                rec.reason = reason;
                overlay.tint(chip, GuardOverlay.CARD_ON);
                handler.postDelayed(next, 150);
            });
            chips.add(chip);
        }
        overlay.step("왜 쇼츠를 보려고 하나요?", null, overlay.grid(chips, 2, 56));
    }

    /** "몇 분 볼래요?" within the remaining budget and the extension ladder. */
    private void commitment(Rec rec, GuardPolicy policy, int extensionIndex, String outcome) {
        List<Integer> choices = policy.commitChoices(policy.remainingSeconds(rec.usage), extensionIndex);
        int hour = hourNow();
        boolean risky = policy.ai.isRiskHour(hour);
        if (risky && !choices.isEmpty()) {
            // AI: in a risky hour the longest choice is shorter.
            List<Integer> capped = new ArrayList<>();
            for (int c : choices) if (c <= policy.ai.riskCommitMax) capped.add(c);
            choices = capped.isEmpty() ? java.util.Collections.singletonList(choices.get(0)) : capped;
        }
        boolean reserve = !risky && extensionIndex == 0 && policy.ai.beforeRisk(hour) && !policy.ai.riskLabel.isEmpty();
        if (choices.isEmpty()) {
            rec.outcome = "budget_out";
            write(rec);
            strong(rec.kind, rec.usage, policy, "오늘 목표를 다 썼어요.", false);
            return;
        }
        List<TextView> chips = new ArrayList<>();
        for (int minutes : choices) {
            boolean suggested = reserve && minutes == choices.get(0);
            TextView chip = overlay.chip(minutes + "분" + (suggested ? " · 추천" : ""));
            if (suggested) overlay.tint(chip, GuardOverlay.CARD_ON);
            chip.setOnClickListener(v -> {
                if (rec.recorded) return;
                rec.commitMinutes = minutes;
                rec.outcome = outcome;
                write(rec);
                overlay.close(() -> host.onWatch(rec.kind, minutes, false, extensionIndex, rec.band));
            });
            chips.add(chip);
        }
        String subtitle = reserve
            ? GuardCopy.reserveHint(policy.ai.riskLabel)
            : "오늘 남은 시간 " + GuardCopy.clock(policy.remainingSeconds(rec.usage))
                + ". 정한 시간이 되면 멈춰 드려요.";
        overlay.step(extensionIndex > 0 ? "몇 분만 더 볼래요?" : "몇 분 볼래요?", subtitle, overlay.grid(chips, 3, 56));
    }

    private void strongChoices(Rec rec, GuardPolicy policy, String headline) {
        long now = System.currentTimeMillis();
        long dayEnd = policy.nextDayEnd(now, TimeZone.getDefault());
        LinearLayout box = overlay.vertical();

        TextView end = overlay.button("오늘은 끝 · 내일 " + policy.dayEndHour + "시까지", true);
        end.setOnClickListener(v -> {
            int minutes = (int) Math.ceil((dayEnd - System.currentTimeMillis()) / 60000.0);
            rec.blockMinutes = minutes;
            praiseThen(rec, "day_end", () -> host.onBlock(rec.kind, dayEnd, minutes, true));
        });
        box.addView(end, overlay.matchHeight(56));

        List<TextView> locks = new ArrayList<>();
        for (int minutes : new int[] {10, 20, 30, 60}) {
            TextView chip = overlay.chip(minutes == 60 ? "1시간 잠금" : minutes + "분 잠금");
            chip.setOnClickListener(v -> {
                rec.blockMinutes = minutes;
                long until = System.currentTimeMillis() + minutes * 60_000L;
                praiseThen(rec, "lock", () -> host.onBlock(rec.kind, until, minutes, false));
            });
            locks.add(chip);
        }
        LinearLayout lockGrid = overlay.grid(locks, 4, 48);
        LinearLayout.LayoutParams lockLp = GuardOverlay.matchWrap();
        lockLp.setMargins(0, overlay.dp(8), 0, 0);
        box.addView(lockGrid, lockLp);

        TextView more = overlay.text(policy.overdraftMinutes + "분만 더", 14, GuardOverlay.MUTED, false);
        more.setGravity(Gravity.CENTER);
        more.setPadding(0, overlay.dp(14), 0, 0);
        more.setClickable(true);
        more.setOnClickListener(v -> {
            if (!rec.recorded) overdraftNudge(rec, policy);
        });
        if (!policy.ai.strict) box.addView(more);

        String body = GuardCopy.strong(GuardState.nextIndex(context, "s3"), host.facts());
        overlay.step(GuardCopy.STRONG_TITLE, headline == null ? body : headline + " " + body, box);
    }

    /** S4: every "3분만 더" goes through a line that changes with the count. */
    private void overdraftNudge(Rec rec, GuardPolicy policy) {
        int count = GuardState.countToday(context, "overdraft", System.currentTimeMillis()) + 1;
        LinearLayout box = overlay.vertical();
        TextView stop = overlay.button("여기서 그만할래요", true);
        stop.setOnClickListener(v -> finishExit(rec, "exit"));
        box.addView(stop, overlay.matchHeight(56));
        TextView watch = overlay.text("", 14, GuardOverlay.MUTED, false);
        watch.setGravity(Gravity.CENTER);
        watch.setPadding(0, overlay.dp(14), 0, 0);
        watch.setClickable(true);
        box.addView(watch);
        int waitSec = policy.ai.isRiskHour(hourNow()) ? policy.ai.riskOverdraftWaitSec : policy.overdraftWaitSec;
        long enableAt = SystemClock.uptimeMillis() + waitSec * 1000L;
        String label = "그래도 " + policy.overdraftMinutes + "분 볼래요";
        watch.setOnClickListener(v -> {
            if (rec.recorded || SystemClock.uptimeMillis() < enableAt) return;
            GuardState.bumpToday(context, "overdraft", System.currentTimeMillis());
            rec.outcome = "overdraft";
            rec.commitMinutes = policy.overdraftMinutes;
            write(rec);
            overlay.close(() -> host.onWatch(rec.kind, policy.overdraftMinutes, true, 0, GuardPolicy.BAND_STRONG));
        });
        overlay.step(
            GuardCopy.overdraftTitle(count, policy.overdraftMinutes),
            GuardCopy.overdraft(count, policy.overdraftMinutes, host.facts()),
            box);
        overlay.startTicker(250, () -> {
            long left = enableAt - SystemClock.uptimeMillis();
            watch.setText(left > 0 ? label + " (" + ((left + 999) / 1000) + ")" : label);
            return left > 0;
        });
    }

    // --- Endings ---------------------------------------------------------------

    private void finishExit(Rec rec, String outcome) {
        praiseThen(rec, outcome, () -> host.onLeave(rec.kind));
    }

    /** Records the choice, shows a short praise line (S5), then slides away. */
    private void praiseThen(Rec rec, String outcome, Runnable after) {
        if (rec.recorded) return;
        rec.outcome = outcome;
        write(rec);
        if ("kept".equals(outcome)) GuardState.bumpToday(context, "kept", System.currentTimeMillis());
        GuardCopy.Facts facts = host.facts();
        String line = GuardCopy.praise(outcome, GuardState.nextIndex(context, "praise_" + outcome), facts, rec.blockMinutes);
        String guide = host.inPip() ? "\n" + GuardCopy.PIP_CLOSE_GUIDE : "";
        overlay.leave(null, null);
        GuardPolicy policy = openPolicy;
        boolean askFeedback = policy != null && policy.ai.enabled
            && Math.floorMod(GuardState.nextIndex(context, "feedback"), policy.ai.feedbackEvery) == 0;
        if (!askFeedback) {
            overlay.step("잘 멈췄어요", line + guide, null);
            handler.postDelayed(() -> overlay.close(after), PRAISE_MS + (guide.isEmpty() ? 0 : 1200));
            return;
        }
        // Every few times: was this sheet any help? (reward signal for the AI phase)
        boolean[] done = {false};
        Runnable finish = () -> {
            if (done[0]) return;
            done[0] = true;
            overlay.close(after);
        };
        List<TextView> chips = new ArrayList<>();
        for (String answer : new String[] {GuardCopy.FEEDBACK_YES, GuardCopy.FEEDBACK_NO}) {
            TextView chip = overlay.chip(answer);
            chip.setOnClickListener(v -> {
                if (done[0]) return;
                overlay.tint(chip, GuardOverlay.CARD_ON);
                host.record(feedbackRow(rec, GuardCopy.FEEDBACK_YES.equals(answer) ? "helpful" : "not"));
                handler.postDelayed(finish, 300);
            });
            chips.add(chip);
        }
        overlay.step("잘 멈췄어요", line + guide + "\n\n" + GuardCopy.FEEDBACK_QUESTION, overlay.grid(chips, 2, 48));
        handler.postDelayed(finish, FEEDBACK_WAIT_MS);
    }

    private static JSONObject feedbackRow(Rec rec, String feedback) {
        JSONObject row = new JSONObject();
        try {
            row.put("id", UUID.randomUUID().toString())
                .put("createdAt", System.currentTimeMillis())
                .put("target", rec.kind)
                .put("level", rec.band)
                .put("stage", "feedback")
                .put("refId", rec.id)
                .put("feedback", feedback)
                .put("reason", "선택하지 않음")
                .put("interventionType", "feedback")
                .put("outcome", "feedback")
                .put("usageSeconds", 0);
        } catch (JSONException ignored) {
            // Plain values only.
        }
        return row;
    }

    private static int hourNow() {
        return Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
    }

    private void leaveQuietly(String kind) {
        overlay.close(() -> host.onLeave(kind));
    }

    // --- Records ---------------------------------------------------------------

    private Rec begin(String kind, String stage, int band, double usage, GuardPolicy policy) {
        if (open != null && !open.recorded) {
            open.outcome = "replaced";
            write(open);
        }
        overlay.open();
        openPolicy = policy;
        String notice = host.inPip() ? GuardCopy.PIP_NOTE : null;
        if (notice == null && policy != null && policy.ai.isRiskHour(hourNow()) && !policy.ai.riskLabel.isEmpty()) {
            notice = GuardCopy.aiRiskNotice(policy.ai.riskLabel);
        }
        overlay.notice(notice);
        if (policy != null) overlay.gauge(policy.ratio(usage), policy.remainingSeconds(usage), band);
        Rec rec = new Rec(kind, stage, band, usage, policy == null ? "" : policy.version);
        open = rec;
        return rec;
    }

    private void write(Rec rec) {
        if (rec.recorded) return;
        rec.recorded = true;
        host.record(rec.toJson());
    }

    /** One sheet's worth of data for the interventions table (AI training material). */
    static final class Rec {
        final String id = UUID.randomUUID().toString();
        final long createdAt = System.currentTimeMillis();
        final String kind;
        final String stage;
        final int band;
        final double usage;
        final String policyVersion;
        String method;
        String framing;
        String verification;
        String reason;
        String reflection;
        String afterLock;
        String alternative;
        String cardId;
        Boolean cardCorrect;
        int commitMinutes;
        int blockMinutes;
        int extensionIndex;
        String outcome;
        boolean recorded;

        Rec(String kind, String stage, int band, double usage, String policyVersion) {
            this.kind = kind;
            this.stage = stage;
            this.band = band;
            this.usage = usage;
            this.policyVersion = policyVersion;
        }

        JSONObject toJson() {
            JSONObject row = new JSONObject();
            try {
                String type = method != null && ("entry".equals(stage) || "locked".equals(stage)) ? method : stage;
                row.put("id", id)
                    .put("createdAt", createdAt)
                    .put("target", kind)
                    .put("level", band)
                    .put("band", band)
                    .put("stage", stage)
                    .put("reason", reason == null ? "선택하지 않음" : reason)
                    .put("interventionType", type)
                    .put("method", opt(method))
                    .put("framing", opt(framing))
                    .put("verification", opt(verification))
                    .put("reflection", opt(reflection))
                    .put("afterLock", opt(afterLock))
                    .put("alternativeAction", opt(alternative))
                    .put("cardId", opt(cardId))
                    .put("cardCorrect", cardCorrect == null ? JSONObject.NULL : cardCorrect)
                    .put("commitMinutes", commitMinutes)
                    .put("blockMinutes", blockMinutes)
                    .put("extensionIndex", extensionIndex)
                    .put("outcome", outcome == null ? "exit" : outcome)
                    .put("usageSeconds", usage)
                    .put("policyVersion", policyVersion);
            } catch (JSONException ignored) {
                // Fields are plain values; nothing to recover.
            }
            return row;
        }

        private static Object opt(String value) {
            return value == null ? JSONObject.NULL : value;
        }
    }

    private View wrap(View view, int heightDp) {
        LinearLayout box = overlay.vertical();
        box.addView(view, overlay.matchHeight(heightDp));
        return box;
    }
}
