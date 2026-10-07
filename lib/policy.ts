import { banditTables, hourLabel, riskHours, type BetaTable } from "./ai.ts";
import { FRAMINGS, usageStats } from "./logic.ts";
import type { AppData, Settings, StudyCard } from "./types.ts";

/**
 * 개입 정책표. 서비스(GuardPolicy.java)는 개입 순간 이 표만 읽고 결정한다.
 * v0.8.0은 규칙으로 채운다. AI 단계에서는 같은 형식을 AI가 채운다
 * (방식·문구 순서, 시간대별 약속 최대치 등). 형식을 바꾸면 GuardPolicy.fromJson도 맞춘다.
 */
export type Policy = {
  version: string;
  goalMinutes: number;
  /** 목표 대비 비율: 이 이상이면 중간 / 강함 */
  mediumAt: number;
  strongAt: number;
  /** 강도별로 번갈아 보여줄 방식 */
  methods: { light: string[]; medium: string[] };
  commitOptions: number[];
  /** 연장할 때마다 줄어드는 최대 약속 시간 */
  extensionLadder: number[];
  overdraftMinutes: number;
  overdraftWaitSec: number;
  dayEndHour: number;
  /** 시간 체감 문구(S1) 종류와 순서 */
  framings: string[];
  /** 문구에 쓰는 통계. 서비스가 지금 시각 기준으로 마무리 계산을 한다. */
  stats: {
    avg7Seconds: number;
    pastWeekSeconds: number;
    daysBeforeToday: number;
    yesterdayCumulative: number[] | null;
    wakeHour: number;
    wakeMinute: number;
  };
  /** AI 단계. enabled가 false면 서비스는 규칙대로 (번갈아) 동작한다. */
  ai: {
    enabled: boolean;
    /** 엄격 모드: 연장과 "3분만 더"를 없앤다. AI와 상관없이 적용. */
    strict: boolean;
    /** "강도:시간대" → 방식별 Beta(α, β). 서비스가 톰슨 샘플링으로 뽑는다. */
    methods: BetaTable;
    /** "시간대" → 문구 종류별 Beta(α, β) */
    framings: BetaTable;
    /** 평소 오래 보는 시간 (0~23시). 이 시간엔 세부 수치를 조인다. */
    riskHours: number[];
    /** 문구에 쓸 위험 시간 이름, 예: "밤 11시" */
    riskLabel: string;
    risk: { commitMax: number; extensionMax: number; overdraftWaitSec: number };
    /** 칭찬 화면에서 피드백을 묻는 간격 (N번에 1번) */
    feedbackEvery: number;
  };
};

export const RULE_POLICY_VERSION = "rule-2";
export const AI_POLICY_VERSION = "ai-1";

export function buildPolicy(settings: Settings, data?: AppData, now = new Date()): Policy {
  const stats = data
    ? usageStats(data, now)
    : { avg7Seconds: -1, pastWeekSeconds: -1, daysBeforeToday: 0, yesterdayCumulative: null };
  const [wakeHour, wakeMinute] = settings.wakeTime.split(":").map(Number);
  const aiOn = settings.aiEnabled && data !== undefined;
  const tables = aiOn ? banditTables(data, now) : { methods: {}, framings: {} };
  const risk = aiOn ? riskHours(data, now) : null;
  return {
    version: aiOn ? AI_POLICY_VERSION : RULE_POLICY_VERSION,
    goalMinutes: settings.level3Threshold,
    mediumAt: 0.5,
    strongAt: 1,
    methods: {
      light: ["pause", "framing"],
      medium: ["breath", "alternative", "reflection", "card", "pause", "framing"],
    },
    commitOptions: [3, 5, 10],
    extensionLadder: [10, 5, 3],
    overdraftMinutes: 3,
    overdraftWaitSec: 3,
    dayEndHour: settings.dayEndHour,
    framings: [...FRAMINGS],
    stats: { ...stats, wakeHour, wakeMinute },
    ai: {
      enabled: aiOn,
      strict: settings.strictMode,
      methods: tables.methods,
      framings: tables.framings,
      riskHours: risk?.hours ?? [],
      riskLabel: risk ? hourLabel(risk.hours[0]) : "",
      risk: { commitMax: 3, extensionMax: 1, overdraftWaitSec: 10 },
      feedbackEvery: 5,
    },
  };
}

/** 서비스에 넘길 공부 카드: 덜 본 카드부터 최대 {limit}장. */
export function cardsForService(
  data: AppData,
  limit = 20,
): { id: string; question: string; options: string[]; answer: number; explanation: string }[] {
  return [...data.cards]
    .sort((a, b) => a.shown - b.shown || a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit)
    .map((card) => ({
      id: card.id,
      question: card.question,
      options: card.options,
      answer: card.answer,
      explanation: card.explanation,
    }));
}

/** 붙여넣기 가져오기용 질문 문장. ChatGPT·Gemini 무료 채팅에 자료와 함께 붙여 넣는다. */
export const CARD_PROMPT = `아래 자료로 객관식 문제 5개를 만들어 줘.
반드시 아래 JSON 형식만 코드 블록 하나로 출력하고, 그 밖의 말은 쓰지 마.
[{"question":"문제","options":["보기1","보기2","보기3","보기4"],"answer":1,"explanation":"정답인 이유를 한두 문장으로"}]
- answer는 정답 보기의 번호(1~4)야.
- explanation에는 왜 그게 정답인지 짧게 설명해 줘.
- 따옴표는 곧은 따옴표(")만 써 줘.

자료:
`;

/**
 * 붙여넣은 글에서 카드를 꺼낸다. 앞뒤 설명이나 코드 블록 표시가 섞여 있어도
 * 첫 [ 부터 마지막 ] 까지를 읽는다. 형식이 틀린 문제는 건너뛴다.
 */
export function parseCardImport(
  text: string,
  now = new Date(),
  makeId: () => string = () => crypto.randomUUID(),
): { cards: StudyCard[]; skipped: number; error: string | null } {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return { cards: [], skipped: 0, error: "[ ] 로 묶인 JSON을 찾지 못했어요." };
  }
  // ChatGPT·Gemini가 흔히 섞는 것: 둥근 따옴표, 끝에 남은 쉼표.
  const cleaned = text
    .slice(start, end + 1)
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([\]}])/g, "$1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { cards: [], skipped: 0, error: "JSON 형식이 맞지 않아요. 결과를 그대로 다시 붙여넣어 주세요." };
  }
  if (!Array.isArray(parsed)) {
    return { cards: [], skipped: 0, error: "문제 목록(배열)이 아니에요." };
  }
  const cards: StudyCard[] = [];
  let skipped = 0;
  for (const item of parsed) {
    const raw = item as { question?: unknown; options?: unknown; answer?: unknown; explanation?: unknown };
    const options = Array.isArray(raw.options)
      ? raw.options
          .map((o) => (typeof o === "number" ? String(o) : o))
          .filter((o): o is string => typeof o === "string" && o.trim() !== "")
          .map((o) => o.trim())
      : [];
    // 정답이 "2", "2번", 또는 보기 글자 그대로 와도 읽는다.
    let answer = Number(String(raw.answer ?? "").replace(/[^0-9]/g, "") || NaN);
    if (!Number.isInteger(answer) && typeof raw.answer === "string") {
      const at = options.indexOf(raw.answer.trim());
      if (at >= 0) answer = at + 1;
    }
    const question = typeof raw.question === "string" ? raw.question.trim() : "";
    if (
      !question ||
      options.length < 2 ||
      options.length > 6 ||
      !Number.isInteger(answer) ||
      answer < 1 ||
      answer > options.length ||
      question.length > 300
    ) {
      skipped += 1;
      continue;
    }
    cards.push({
      id: makeId(),
      question,
      options,
      answer: answer - 1,
      createdAt: now.toISOString(),
      source: "import",
      shown: 0,
      correct: 0,
      explanation: typeof raw.explanation === "string" ? raw.explanation.trim().slice(0, 500) : "",
    });
  }
  return { cards, skipped, error: cards.length === 0 ? "가져올 수 있는 문제가 없어요." : null };
}
