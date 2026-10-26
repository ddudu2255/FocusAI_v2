export type Level = 1 | 2 | 3;

/**
 * 개입 결과.
 * exit = 나가기, kept = 약속 시간 지키고 나가기, day-end = 오늘은 끝, timed-block = 시간 잠금,
 * watch = 보기, extend = 약속 연장, overdraft = 목표 초과 "3분만 더",
 * budget-out = 약속할 시간이 남지 않아 강함 단계로 넘어감, interrupted = 다른 시트로 바뀜.
 */
export type Outcome =
  | "exit"
  | "watch"
  | "force-quit"
  | "timed-block"
  | "blocked-retry"
  | "kept"
  | "extend"
  | "day-end"
  | "overdraft"
  | "budget-out"
  | "interrupted";

/**
 * level3Threshold = 하루 목표(분). 강도는 목표 대비 비율로 정한다 (50% 중간, 100% 강함).
 * level1Threshold는 목표의 절반으로 자동 계산한다 (이전 버전 호환용).
 */
export type Settings = {
  level1Threshold: number;
  level2Threshold: number;
  level3Threshold: number;
  notificationTime: string;
  notifyEnabled: boolean;
  /** 목표를 줄여 갈 최종 목표(분). AI 단계에서 쓴다. */
  finalGoal: number;
  /** "오늘은 끝" 잠금이 풀리는 시각(0-23시). */
  dayEndHour: number;
  /** 일어나는 시각 HH:MM. 밤의 "잠과 비교" 문구에 쓴다. 다음 알람이 있으면 알람을 먼저 쓴다. */
  wakeTime: string;
  /** AI 개인화. 끄면 규칙대로 동작한다 (AI 전후 비교용). */
  aiEnabled: boolean;
  /** 엄격 모드: 연장과 "3분만 더"가 없다. 사용자가 직접 켠다. */
  strictMode: boolean;
  /**
   * 밴딧 학습 개선 (v0.9.1): 칸 사이 공유, 최근 가중치, 세밀한 보상, 평일/주말, 질림 반영.
   * 끄면 v0.9.0과 같은 계산. 화면에는 없고, 전후 비교가 필요할 때 쓴다.
   */
  banditV2: boolean;
  /** 공부 모드: 약함·중간 단계의 개입을 공부 카드로만 한다 (카드가 없으면 평소대로). */
  studyMode: boolean;
  /** 주간 목표 제안을 이미 답한 주 (월요일 날짜). */
  goalWeekAnswered: string;
};

export type SessionTarget = "youtube" | "instagram" | "practice";

/**
 * 계획서 UsageLog. 한 번의 시청 세션. duration 단위는 초.
 * date는 시작한 날짜이고, 자정을 넘긴 세션은 secondsOnDate()가 날짜별로 나눈다.
 * source: native = 접근성 서비스가 잰 실제 쇼츠, web = 연습 피드·이관한 기록.
 */
export type UsageLog = {
  usageId: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  clipCount: number;
  target: SessionTarget;
  source: "native" | "web";
  /** 이 시청이 이어진 열기(OpenLog.id). 시트 없이 본 시청(개입 꺼짐, 연습 피드)은 없다. */
  openId?: string | null;
};

/**
 * 개입 화면에서 보여준 방식. 웹 흐름: pause / alternative / warning.
 * 화면 위 시트: pause, framing(시간 바꿔 말하기), breath, alternative, reflection, card,
 * commit_end(약속 시간 끝), strong(마무리 선택), locked.
 */
export type InterventionType =
  | "pause"
  | "alternative"
  | "warning"
  | "framing"
  | "breath"
  | "reflection"
  | "card"
  | "commit_end"
  | "strong"
  | "locked"
  | "pip";

/** 강도: 1 가벼움(목표 50% 미만), 2 중간(100% 미만), 3 강함(목표 초과). */
export type Band = 1 | 2 | 3;

/** 계획서 InterventionLog. date는 기기 로컬 날짜. */
export type InterventionLog = {
  interventionId: string;
  timestamp: string;
  date: string;
  level: Level;
  reason: string;
  reasonNote: string;
  alternativeAction: string | null;
  alternativeCompleted: boolean;
  reEntered: boolean;
  blocked: boolean;
  blockDuration: number;
  usageSeconds: number;
  outcome: Outcome;
  /** 기기 로컬 시각(0-23)과 요일(0=일). AI 학습용. */
  hour: number;
  weekday: number;
  target: SessionTarget | null;
  interventionType: InterventionType;
  /** 나간 뒤 30분 안에 다시 쇼츠를 열었는지. 30분이 지나기 전이거나 시청을 고른 경우 null. */
  reenteredWithin30: boolean | null;
  /** 도움이 됐는지. AI 단계에서 쓴다. */
  feedback: "helpful" | "not" | null;
  /** 아래는 v0.8.0 시트 기록 (AI 학습 재료). 웹 흐름에서는 대부분 null. */
  band: Band | null;
  /** entry / commit_end / strong / web */
  stage: string | null;
  /** 시간 바꿔 말하기 종류: shorts / walk / book / sleep / study */
  framing: string | null;
  /** 참여 확인: verified / self / answered / waited / seen / skipped */
  verification: string | null;
  reflection: string | null;
  afterLock: string | null;
  commitMinutes: number;
  cardId: string | null;
  cardCorrect: boolean | null;
  extensionIndex: number;
  policyVersion: string | null;
  /** 아래는 예측 모델 기록 (v0.11). 그 시청의 열기(OpenLog.id), 위험 점수와 위험도. */
  openId: string | null;
  riskScore: number | null;
  riskBand: RiskBand | null;
  /** 밴딧이 고른 동작: full = 정한 동작 그대로, soft = 한 단계 약하게. 위험 낮음이면 null. */
  tighten: Tighten | null;
  /** 정한 동작을 썼을 때 3분 이하를 골랐는지. 고르지 않았으면 null. */
  tightenFollowed: boolean | null;
};

export type RiskBand = "low" | "medium" | "high";
export type Tighten = "full" | "soft";

/**
 * 쇼츠를 열어 시트가 뜬 순간 한 줄 (예측 모델 기록). 그 열기에서 이어진 시청(연장, 10분 안에
 * 이어 보기 포함)은 UsageLog.openId로 묶인다. 바로 나가면 시청 기록이 없다.
 * features는 risk.ts RAW_FEATURES 순서의 날것 특징값이다.
 */
export type OpenLog = {
  id: string;
  createdAt: string;
  date: string;
  target: SessionTarget | null;
  features: number[];
  score: number;
  band: RiskBand;
  /** 밴딧 선택. 위험 높음 + full이면 3분 제한이 걸린 열기라 모델 학습에서 뺀다. */
  tighten: Tighten | null;
  /** 최근 7일 목표를 지키는 중이라 한 단계 약하게 개입했는지 (risk.ts keepingGoal). */
  keeping: boolean;
  modelVersion: string;
  /** 정답: 이 열기에서 본 시간 합이 그날 목표의 절반 이상인지. 열기가 끝나기 전에는 null. */
  label: boolean | null;
  /** 이 열기에서 본 시간 합 (초). 정답을 정할 때 채운다. */
  durationSec: number | null;
};

/** 개입 스위치를 끄고 켠 기록. 측정만 하고 밴딧 점수에는 쓰지 않는다. */
export type AppEvent = {
  id: string;
  createdAt: string;
  kind: "blocker_off" | "blocker_on";
  /** 그때까지 오늘 본 초 */
  todaySeconds: number;
};

/** 폰에서 고친 예측 모델 가중치. 없으면 시작 모델(risk-model.ts)을 쓴다. */
export type RiskModelState = {
  version: string;
  weights: number[];
  bias: number;
  /** 지금까지 고친 횟수 */
  updates: number;
  updatedAt: string | null;
};

/** 내 공부 카드. 직접 입력하거나 ChatGPT·Gemini 결과를 붙여넣어 만든다. */
export type StudyCard = {
  id: string;
  question: string;
  options: string[];
  /** 정답 보기의 0부터 시작하는 번호 */
  answer: number;
  createdAt: string;
  source: "manual" | "import";
  shown: number;
  correct: number;
  /** 풀이 뒤에 보여 줄 해설. 없으면 "". */
  explanation: string;
};

/** 시간 차단 중에 쇼츠를 연 기록. */
export type LockAttempt = {
  id: string;
  createdAt: string;
  date: string;
  remainingSec: number;
  target: SessionTarget | null;
};

export type ActiveSession = {
  usageId: string;
  date: string;
  startTime: string;
  duration: number;
  clipCount: number;
  interventionId: string;
  levelAtStart: Level;
  lastTickAt: number;
};

export type BlockState = {
  until: string | null;
  minutes: number;
};

/**
 * 하루 목표(분)를 바꾼 기록. from 날짜부터 이 목표를 쓴다.
 * 그날 판정 목표 = (그날 시작할 때 목표, 그날부터 적용된 목표들) 중 가장 작은 값.
 * 목표를 낮췄는데 오늘 이미 그보다 많이 봤으면 from은 내일이다.
 */
export type GoalChange = {
  from: string;
  minutes: number;
};

export type AppData = {
  settings: Settings;
  /** 비어 있으면 모든 날짜에 지금 목표(settings.level3Threshold)를 쓴다. */
  goalLog: GoalChange[];
  usageLogs: UsageLog[];
  interventions: InterventionLog[];
  lockAttempts: LockAttempt[];
  cards: StudyCard[];
  openLogs: OpenLog[];
  appEvents: AppEvent[];
  riskModel: RiskModelState | null;
  activeSession: ActiveSession | null;
  block: BlockState;
  lastNotifiedDate: string | null;
};

export type DailyStats = {
  date: string;
  usageSeconds: number;
  clipCount: number;
  interventionCount: number;
  levelCounts: Record<Level, number>;
  topReason: string | null;
  reentryCount: number;
  blockCount: number;
  forceQuitCount: number;
  alternativeCompletedCount: number;
  lockAttemptCount: number;
  /** 스스로 멈춘 횟수: 나가기, 약속 지키기, 오늘은 끝, 시간 잠금 */
  selfStopCount: number;
  keptCount: number;
  dayEndCount: number;
  overdraftCount: number;
  extendCount: number;
  cardsSolved: number;
  cardsCorrect: number;
  /** 시간 잠금으로 쉰 초 ("오늘은 끝"은 빼고). */
  restSeconds: number;
  /** 이 날까지 잠금이나 "오늘은 끝"을 고른 날이 이어진 수. */
  lockStreak: number;
};

/** 화면에서 넘기는 개입 결과. 나머지 필드는 기록할 때 채운다. */
export type InterventionInput = Omit<
  InterventionLog,
  | "interventionId"
  | "timestamp"
  | "date"
  | "hour"
  | "weekday"
  | "target"
  | "interventionType"
  | "reenteredWithin30"
  | "feedback"
  | "band"
  | "stage"
  | "framing"
  | "verification"
  | "reflection"
  | "afterLock"
  | "commitMinutes"
  | "cardId"
  | "cardCorrect"
  | "extensionIndex"
  | "policyVersion"
  | "openId"
  | "riskScore"
  | "riskBand"
  | "tighten"
  | "tightenFollowed"
> & { target?: SessionTarget | null };

/** 접근성 서비스가 쌓아 둔 기록. GuardPlugin.sync()가 넘겨준다. 시각은 epoch ms. */
export type NativeSession = {
  id: string;
  target: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  openId?: string | null;
};

export type NativeIntervention = {
  id: string;
  createdAt: number;
  target: string;
  level: number;
  reason: string;
  interventionType: string;
  alternativeAction: string | null;
  outcome: string;
  usageSeconds: number;
  band?: number;
  stage?: string;
  method?: string | null;
  framing?: string | null;
  verification?: string | null;
  reflection?: string | null;
  afterLock?: string | null;
  cardId?: string | null;
  cardCorrect?: boolean | null;
  commitMinutes?: number;
  blockMinutes?: number;
  extensionIndex?: number;
  policyVersion?: string;
  /** stage "card_report": 사용자가 "이상한 문제"로 신고한 카드는 cardId에 담긴다. */
  /** stage "feedback": answer to "도움이 됐나요?" for the row refId */
  refId?: string;
  feedback?: string;
  openId?: string | null;
  riskScore?: number | null;
  riskBand?: string | null;
  tighten?: string | null;
};

/** 서비스가 쇼츠를 열어 시트가 뜬 순간 남긴 줄. */
export type NativeOpenLog = {
  id: string;
  createdAt: number;
  target: string;
  features: number[];
  score: number;
  band: string;
  tighten?: string | null;
  keeping?: boolean;
  modelVersion: string;
};

export type NativeLockAttempt = {
  id: string;
  createdAt: number;
  remainingSec: number;
  target: string;
};

export type NativeBatch = {
  sessions: NativeSession[];
  interventions: NativeIntervention[];
  lockAttempts: NativeLockAttempt[];
  /** 예측 모델 이전 서비스는 보내지 않는다. */
  openLogs?: NativeOpenLog[];
};
