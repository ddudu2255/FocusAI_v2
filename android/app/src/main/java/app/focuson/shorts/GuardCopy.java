package app.focuson.shorts;

import java.util.Locale;

/**
 * Sheet wording. Every line here was approved by the user per situation (S1–S9 in
 * docs/HANDOFF.md); change wording only after showing the user the new table.
 * Lines rotate in a fixed order (GuardState.nextInTurn); a line whose numbers are
 * unknown or meaningless right now returns null and is skipped.
 * REASONS and the reflection answers must match lib/logic.ts so records line up.
 */
final class GuardCopy {
    private GuardCopy() {}

    static final String[] REASONS = {
        "심심해서",
        "습관적으로",
        "잠깐 보려고",
        "스트레스 해소를 위해",
        "특별한 이유 없이",
        "기타"
    };

    static final class Alternative {
        final String label;
        final String guide;

        Alternative(String label, String guide) {
            this.label = label;
            this.guide = guide;
        }
    }

    /** All alternatives, in the order the medium band rotates through them. */
    static final Alternative[] ALTERNATIVES = {
        new Alternative("물 마시기", "자리에서 일어나 물 한 잔을 마시고 오세요."),
        new Alternative("간단한 스트레칭", "어깨를 천천히 돌리고, 목을 좌우로 기울여 보세요."),
        new Alternative("잠시 걷기", "방 안이라도 열 걸음만 걸어 보세요."),
        new Alternative("눈 쉬기", "화면에서 눈을 떼고, 멀리 있는 한 점을 바라보세요."),
    };

    static final String REFLECTION_QUESTION = "지금 보면 뭐가 남을까요?";
    static final String[] REFLECTION_ANSWERS = {"기분 전환", "아무것도", "할 일 미루는 중", "잘 모르겠어요"};

    static final String[] AFTER_LOCK_ANSWERS = {"쉬었어요", "공부·일", "그냥 기다림"};

    static final String STRONG_TITLE = "오늘은 여기까지 해볼까요?";
    static final String LOCKED_TITLE = "쇼츠 쉬는 중";
    static final String PIP_NOTE = "작은 창으로 보던 쇼츠예요";
    static final String PIP_CLOSE_GUIDE = "작은 창의 X를 눌러 닫아 주세요. 닫으면 소리가 돌아와요.";

    // --- AI phase lines (approved 2026-10-06, docs/HANDOFF.md) ---

    /** Sheet notice in a risky hour (A7). */
    static String aiRiskNotice(String riskLabel) {
        return "AI · " + riskLabel + "쯤은 평소 오래 보던 시간이라 조금 짧게 잡았어요";
    }

    /** Commitment step before today's risky hour (A5). */
    static String reserveHint(String riskLabel) {
        return "보통 " + riskLabel + "쯤 많이 보셔서, 지금은 3분만 쓰고 남겨 둘까요?";
    }

    static final String FEEDBACK_QUESTION = "방금 화면, 멈추는 데 도움이 됐나요?";
    static final String FEEDBACK_YES = "도움 됐어요";
    static final String FEEDBACK_NO = "아니에요";

    /** Numbers a line may use. Negative or null = unknown, and lines that need it are skipped. */
    static final class Facts {
        double usage;
        double goal;
        double weekProjection = -1;
        double avg7 = -1;
        double yesterdayByNow = -1;
        /** Sleep left if the user went to bed now, or -1 outside night hours / unknown. */
        double sleepSeconds = -1;
        /** e.g. "7:10 알람 기준" or "일어나는 시각 7:00 기준" */
        String sleepBasis = "";
        int keptToday;
        double restToday;

        double remaining() {
            return Math.max(0, goal - usage);
        }
    }

    // --- S1. Time line (entry sheet) -------------------------------------------

    static String insight(String kind, Facts f) {
        if (f.usage < 60) return null;
        switch (kind) {
            case "guilt":
                return "오늘 쇼츠에 쓴 " + minutes(f.usage) + ", 다시 돌아오지 않아요.";
            case "weekly":
                if (f.weekProjection < 600) return null;
                return "이 속도면 이번 주에 " + minutes(f.weekProjection) + "을 쇼츠에 써요.";
            case "motivate":
                if (f.remaining() < 60) return null;
                return "지금 멈추면 오늘 목표 안에서 끝낼 수 있어요. (" + minutes(f.remaining()) + " 남음)";
            case "future":
                return "자기 전의 나는 오늘 이 " + minutes(f.usage) + "을 어떻게 생각할까요?";
            case "yesterday":
                if (f.yesterdayByNow < 0 || f.usage - f.yesterdayByNow < 60) return null;
                return "어제 이 시간엔 " + minutes(f.yesterdayByNow) + "이었는데, 오늘은 벌써 "
                    + minutes(f.usage) + "이에요.";
            case "average":
                if (f.avg7 <= 0 || f.usage - f.avg7 < 60) return null;
                return "이번 주 평균보다 " + minutes(f.usage - f.avg7) + " 더 보고 있어요.";
            case "goal":
                if (f.usage >= f.goal) return null;
                return "정한 " + minutes(f.goal) + " 중 " + minutes(f.usage) + "을 썼어요.";
            case "sleep":
                return sleepLine(f);
            default:
                return null;
        }
    }

    private static String sleepLine(Facts f) {
        if (f.sleepSeconds < 600) return null;
        return "지금 자면 " + minutes(f.sleepSeconds) + " 잘 수 있어요. 10분 더 보면 "
            + minutes(f.sleepSeconds - 600) + "이에요. (" + f.sleepBasis + ")";
    }

    // --- S2. Commitment over ---------------------------------------------------

    static String commitmentOver(int index, Facts f) {
        switch (Math.floorMod(index, 3)) {
            case 0:
                return "약속을 지키면 오늘 스스로 멈춘 횟수가 하나 늘어요.";
            case 1:
                if (f.remaining() >= 60) {
                    return "오늘 목표까지 " + minutes(f.remaining()) + " 남았어요. 여기서 멈추면 여유가 생겨요.";
                }
                return "약속을 지키면 오늘 스스로 멈춘 횟수가 하나 늘어요.";
            default:
                return "방금 정한 건 몇 분 전의 나예요. 그 약속, 지켜 볼까요?";
        }
    }

    // --- S3. Strong band -------------------------------------------------------

    static String strong(int index, Facts f) {
        if (Math.floorMod(index, 3) == 2 && f.sleepSeconds >= 600) {
            return "지금 자면 " + minutes(f.sleepSeconds) + " 잘 수 있어요. 오늘은 여기서 마무리해 볼까요? ("
                + f.sleepBasis + ")";
        }
        if (Math.floorMod(index, 3) == 1) {
            return "한 개만 더 보려다 30분이 지나기 쉬워요. 오늘은 이미 " + minutes(f.usage) + "이에요.";
        }
        return "오늘 정한 " + minutes(f.goal) + "을 넘어 " + minutes(f.usage)
            + "을 봤어요. 지금 멈추거나, 잠시 쇼츠를 잠가 둘 수 있어요.";
    }

    // --- S4. "3분만 더" nudge ---------------------------------------------------

    static String overdraftTitle(int count, int minutes) {
        return "오늘 " + count + "번째 " + minutes + "분이에요";
    }

    static String overdraft(int count, int extraMinutes, Facts f) {
        double overAfter = f.usage + extraMinutes * 60.0 - f.goal;
        switch (count) {
            case 1:
                return "오늘 목표를 넘어서 보는 첫 " + extraMinutes + "분이에요. 정말 필요할까요?";
            case 2:
                return "벌써 두 번째 " + extraMinutes + "분이에요. 이번 " + extraMinutes + "분까지 목표보다 "
                    + minutes(overAfter) + " 더 보게 돼요.";
            case 3:
                return "세 번째예요. 자기 전의 나는 이 시간을 어떻게 생각할까요?";
            default:
                String over = "오늘 목표보다 " + minutes(f.usage - f.goal) + " 넘게 봤어요.";
                if (f.yesterdayByNow >= 0) {
                    return over + " 어제는 이 시간까지 " + minutes(f.yesterdayByNow) + "이었어요.";
                }
                return over + " " + count + "번째 " + extraMinutes + "분이에요.";
        }
    }

    // --- S5. Praise ------------------------------------------------------------

    static String praise(String outcome, int index, Facts f, int blockMinutes) {
        switch (outcome) {
            case "kept":
                return Math.floorMod(index, 2) == 0
                    ? "약속을 지켰어요. 이게 쌓이면 습관이 돼요."
                    : "정한 만큼만 봤어요. 오늘 " + Math.max(1, f.keptToday) + "번째예요.";
            case "day_end":
                return "오늘을 스스로 마무리했어요. 내일 아침에 고마워할 거예요.";
            case "lock":
                String length = blockText(blockMinutes);
                switch (Math.floorMod(index, 4)) {
                    case 0:
                        return "스스로 쉬는 시간을 정했어요. 그것만으로도 반은 성공이에요.";
                    case 1:
                        return "좋은 선택이에요. " + length + " 뒤에 다시 만나요.";
                    case 2:
                        return length + ", 폰 말고 다른 걸 해 볼 시간이에요.";
                    default:
                        return "멈추기로 한 건 지금의 나예요. " + length + " 동안 그 결정을 지켜 볼게요.";
                }
            default:
                return Math.floorMod(index, 2) == 0
                    ? "방금 나간 건 진짜 어려운 일이에요."
                    : "멈출 줄 아는 게 진짜 실력이에요.";
        }
    }

    // --- S6–S8 -----------------------------------------------------------------

    static String locked(long remainingMs, double restToday) {
        String line = clockFromMs(remainingMs) + " 남았어요.";
        if (restToday >= 60) line += " 지금까지 오늘 " + minutes(restToday) + " 쉬었어요.";
        return line;
    }

    static String afterLockQuestion(int blockMinutes) {
        return blockText(blockMinutes) + " 잘 쉬었어요. 그동안 뭐 했어요?";
    }

    static String resumeToast(int commitMinutes, double remainingSeconds) {
        return "약속한 " + commitMinutes + "분 중 " + minutes(Math.max(60, remainingSeconds)) + " 남았어요.";
    }

    // --- Formatting ------------------------------------------------------------

    /** Whole minutes for sentences: "23분", "2시간 40분". */
    static String minutes(double seconds) {
        long total = Math.max(1, Math.round(seconds / 60.0));
        long hours = total / 60;
        long rest = total % 60;
        if (hours > 0 && rest > 0) return hours + "시간 " + rest + "분";
        if (hours > 0) return hours + "시간";
        return total + "분";
    }

    static String blockText(int minutes) {
        return minutes >= 60 && minutes % 60 == 0 ? (minutes / 60) + "시간" : minutes + "분";
    }

    static String clock(double totalSeconds) {
        long safe = Math.max(0, (long) Math.floor(totalSeconds));
        long hours = safe / 3600;
        long minutes = (safe % 3600) / 60;
        long seconds = safe % 60;
        if (hours > 0) return hours + "시간 " + minutes + "분";
        if (minutes > 0 && seconds == 0) return minutes + "분";
        if (minutes > 0) return minutes + "분 " + seconds + "초";
        return seconds + "초";
    }

    private static String clockFromMs(long ms) {
        long total = Math.max(0, (ms + 59_999) / 60_000);
        if (total >= 60) return (total / 60) + "시간 " + (total % 60) + "분";
        return total + "분";
    }

    /** mm:ss or h:mm:ss for the lock countdown. */
    static String countdown(long remainingMs) {
        long total = Math.max(0, (remainingMs + 999) / 1000);
        long hours = total / 3600;
        long minutes = (total % 3600) / 60;
        long seconds = total % 60;
        if (hours > 0) return String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds);
        return String.format(Locale.ROOT, "%02d:%02d", minutes, seconds);
    }
}
