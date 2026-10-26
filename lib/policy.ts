import { banditTables, HABITUATION, hourLabel, riskHours, tightenTable, type BetaTable } from "./ai.ts";
import { FRAMINGS, usageStats } from "./logic.ts";
import { bandsFor, keepingGoal, kept7, modelState } from "./risk.ts";
import { START_MODEL } from "./risk-model.ts";
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
  /**
   * 공부 모드: 쉬는 중이 아닌 카드가 있으면 약함·중간 활동 대신 공부 카드.
   * 모든 카드가 쉬는 중이거나 카드가 없으면 서비스가 평소 활동으로 넘어간다.
   */
  studyMode: boolean;
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
    /**
     * 방식별 Beta(α, β). 서비스가 톰슨 샘플링으로 뽑는다.
     * 칸 이름: ai-2는 "강도:시간대:평일주말", ai-1은 "강도:시간대" (서비스는 둘 다 찾아본다).
     */
    methods: BetaTable;
    /** 문구 종류별 Beta(α, β). 칸 이름: ai-2는 "시간대:평일주말", ai-1은 "시간대". */
    framings: BetaTable;
    /**
     * 질림 반영: 최근에 나온 선택지는 뽑은 값을 (1 − strength·0.5^(지난 시간/recoveryHours))배.
     * ai-1에서는 strength 0 (반영 안 함).
     */
    habituation: { strength: number; recoveryHours: number };
    /**
     * 평소 오래 보는 시간 (0~23시). 위험 시간 10분 전 알림과 "남겨 둘까요?" 추천에만 쓴다.
     * 제한은 예측 모델(model)이 그 순간의 위험도로 정한다.
     */
    riskHours: number[];
    /** 문구에 쓸 위험 시간 이름, 예: "밤 11시" */
    riskLabel: string;
    /** 위험 높음에서 정한 동작: 약속 최대 3분(연장 횟수 제한 없음), "3분만 더" 대기 10초. */
    risk: { commitMax: number; overdraftWaitSec: number };
    /**
     * 예측 모델 (lib/risk.ts). 서비스가 연 순간 날것 특징값으로 점수를 낸다.
     * kept7은 웹이 계산해 넣는 특징값이다 (최근 7일 약속 지킨 비율).
     */
    model: {
      version: string;
      mean: number[];
      std: number[];
      weights: number[];
      bias: number;
      /** 낮음 < bands[0] ≤ 보통 < bands[1] ≤ 높음. 사람별 상대 기준 (risk.ts bandsFor). */
      bands: number[];
      cap: number;
      kept7: number;
      /** 최근 7일 목표를 다 지켰으면 true: 서비스가 위험도 개입을 한 단계 약하게 한다. */
      keepingGoal: boolean;
    } | null;
    /** 위험 보통·높음에서 full(정한 동작) / soft(한 단계 약하게) Beta(α, β). 칸 이름 "medium", "high". */
    tighten: BetaTable;
    /** 칭찬 화면에서 피드백을 묻는 간격 (N번에 1번) */
    feedbackEvery: number;
  };
};

export const RULE_POLICY_VERSION = "rule-2";
export const AI_POLICY_VERSION = "ai-1";
/** AI + 밴딧 학습 개선 (v0.9.1). 기록의 policyVersion으로 전후를 나눠 본다. */
export const AI_SHARED_POLICY_VERSION = "ai-2";
/** AI + 예측 모델 (v0.11). 밴딧 학습 개선(ai-2) 위에 위험도 예측을 더한다. */
export const AI_RISK_POLICY_VERSION = "ai-3";

export function buildPolicy(settings: Settings, data?: AppData, now = new Date()): Policy {
  const stats = data
    ? usageStats(data, now)
    : { avg7Seconds: -1, pastWeekSeconds: -1, daysBeforeToday: 0, yesterdayCumulative: null };
  const [wakeHour, wakeMinute] = settings.wakeTime.split(":").map(Number);
  const aiOn = settings.aiEnabled && data !== undefined;
  const tables = aiOn ? banditTables(data, now) : { methods: {}, framings: {} };
  const risk = aiOn ? riskHours(data, now) : null;
  const state = aiOn ? modelState(data) : null;
  const model: Policy["ai"]["model"] =
    aiOn && state
      ? {
          version: state.version,
          mean: [...START_MODEL.mean],
          std: [...START_MODEL.std],
          weights: state.weights,
          bias: state.bias,
          bands: bandsFor(data, now),
          cap: START_MODEL.cap,
          kept7: kept7(data, now),
          keepingGoal: keepingGoal(data, now),
        }
      : null;
  return {
    version: !aiOn
      ? RULE_POLICY_VERSION
      : settings.banditV2
        ? AI_RISK_POLICY_VERSION
        : AI_POLICY_VERSION,
    goalMinutes: settings.level3Threshold,
    mediumAt: 0.5,
    strongAt: 1,
    methods: {
      light: ["pause", "framing"],
      medium: ["breath", "alternative", "reflection", "card", "pause", "framing"],
    },
    studyMode: settings.studyMode,
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
      habituation:
        aiOn && settings.banditV2 ? { ...HABITUATION } : { strength: 0, recoveryHours: HABITUATION.recoveryHours },
      riskHours: risk?.hours ?? [],
      riskLabel: risk ? hourLabel(risk.hours[0]) : "",
      risk: { commitMax: 3, overdraftWaitSec: 10 },
      model,
      tighten: aiOn ? tightenTable(data, now) : {},
      feedbackEvery: 5,
    },
  };
}

/** 서비스에 넘길 공부 카드: 덜 본 카드부터 최대 {limit}장. */
export function cardsForService(
  data: AppData,
  limit = 60,
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
export const CARD_PROMPT = `아래 자료(붙여 넣은 글이나 첨부한 파일)로 객관식 문제 5개를 만들어 줘.
범위: (비워 두면 전체. 예: 3장, 1~10쪽)
반드시 아래 JSON 형식만 코드 블록 하나로 출력하고, 그 밖의 말은 쓰지 마.
[{"question":"문제","options":["보기1","보기2","보기3","보기4"],"answer":1,"explanation":"정답인 이유를 한두 문장으로"}]
- answer는 정답 보기의 번호(1~4)야.
- explanation에는 왜 그게 정답인지 짧게 설명해 줘.
- 따옴표는 곧은 따옴표(")만 써 줘.
- 숫자나 연도를 외우는 문제보다, 개념을 이해했는지 묻는 문제로 만들어 줘.
- 다 만든 뒤 정답이 자료에 실제로 나오는지 다시 확인하고, 애매하거나 자료에 없는 문제는 빼 줘.

자료:
`;

/** 비교용: 띄어쓰기·문장부호·대소문자를 지운다. */
export function normalizeCardText(text: string): string {
  return text.toLowerCase().replace(/[\s.,!?·'"“”‘’()[\]{}:;~\-]/g, "");
}

/** "보기1", "...", "-" 처럼 내용 없는 보기 */
const JUNK_OPTION = /^(보기\s*\d+|선택지\s*\d+|option\s*\d+|\.{2,}|…+|-+|\?+|_+)$/i;

/**
 * 해설이 정답이 아닌 보기를 가리키는 것 같으면 true.
 * 해설에 보기 글자가 하나 이상 나오는데 정답 보기는 없을 때만 의심한다
 * (정답을 풀어 쓴 해설은 보기 글자가 안 나오므로 의심하지 않는다).
 */
export function explanationLooksWrong(card: Pick<StudyCard, "options" | "answer" | "explanation">): boolean {
  const explanation = normalizeCardText(card.explanation);
  if (!explanation) return false;
  const mentioned = card.options
    .map((o, i) => ({ i, text: normalizeCardText(o) }))
    .filter((o) => o.text.length >= 2 && explanation.includes(o.text));
  return mentioned.length > 0 && !mentioned.some((o) => o.i === card.answer);
}

/**
 * 붙여넣은 글에서 카드를 꺼낸다. 앞뒤 설명이나 코드 블록 표시가 섞여 있어도
 * 첫 [ 부터 마지막 ] 까지를 읽는다.
 * 자동 검사: 형식이 틀리거나, 보기가 비었거나 겹치거나, 내용 없는 보기("보기1", "...")가 있으면 건너뛴다.
 * 이미 있는 카드(또는 같은 묶음 안)와 문제가 같으면 duplicates로 센다.
 * 해설이 다른 보기를 가리키는 것 같으면 가져오되 suspectIds에 넣는다 (가져온 뒤 확인 화면에 표시).
 */
export function parseCardImport(
  text: string,
  now = new Date(),
  makeId: () => string = () => crypto.randomUUID(),
  existing: Pick<StudyCard, "question">[] = [],
): { cards: StudyCard[]; skipped: number; duplicates: number; suspectIds: string[]; error: string | null } {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  const none = { cards: [], skipped: 0, duplicates: 0, suspectIds: [] };
  if (start < 0 || end <= start) {
    return { ...none, error: "[ ] 로 묶인 JSON을 찾지 못했어요." };
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
    return { ...none, error: "JSON 형식이 맞지 않아요. 결과를 그대로 다시 붙여넣어 주세요." };
  }
  if (!Array.isArray(parsed)) {
    return { ...none, error: "문제 목록(배열)이 아니에요." };
  }
  const cards: StudyCard[] = [];
  const suspectIds: string[] = [];
  const seen = new Set(existing.map((card) => normalizeCardText(card.question)));
  let skipped = 0;
  let duplicates = 0;
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
    const optionKeys = options.map(normalizeCardText);
    if (
      question.length < 4 ||
      options.length < 2 ||
      options.length > 6 ||
      options.some((o) => JUNK_OPTION.test(o)) ||
      optionKeys.some((key) => !key) ||
      new Set(optionKeys).size !== optionKeys.length ||
      !Number.isInteger(answer) ||
      answer < 1 ||
      answer > options.length ||
      question.length > 300
    ) {
      skipped += 1;
      continue;
    }
    const key = normalizeCardText(question);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const card: StudyCard = {
      id: makeId(),
      question,
      options,
      answer: answer - 1,
      createdAt: now.toISOString(),
      source: "import",
      shown: 0,
      correct: 0,
      explanation: typeof raw.explanation === "string" ? raw.explanation.trim().slice(0, 500) : "",
    };
    if (explanationLooksWrong(card)) suspectIds.push(card.id);
    cards.push(card);
  }
  return {
    cards,
    skipped,
    duplicates,
    suspectIds,
    error: cards.length === 0 ? "가져올 수 있는 문제가 없어요." : null,
  };
}
