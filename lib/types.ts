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
  /** 관심 주제. 기사 카드는 AI 단계에서 만든다. */
  interestTopic: string;
  /** 일어나는 시각 HH:MM. 밤의 "잠과 비교" 문구에 쓴다. 다음 알람이 있으면 알람을 먼저 쓴다. */
  wakeTime: string;
  /** AI 개인화. 끄면 규칙대로 동작한다 (AI 전후 비교용). */
  aiEnabled: boolean;
  /** 엄격 모드: 연장과 "3분만 더"가 없다. 사용자가 직접 켠다. */
  strictMode: boolean;
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

export type AppData = {
  settings: Settings;
  usageLogs: UsageLog[];
  interventions: InterventionLog[];
  lockAttempts: LockAttempt[];
  cards: StudyCard[];
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
> & { target?: SessionTarget | null };

/** 접근성 서비스가 쌓아 둔 기록. GuardPlugin.sync()가 넘겨준다. 시각은 epoch ms. */
export type NativeSession = {
  id: string;
  target: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
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
  /** stage "feedback": answer to "도움이 됐나요?" for the row refId */
  refId?: string;
  feedback?: string;
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
};
