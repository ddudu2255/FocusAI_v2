import { readCompare } from "./compare.ts";
import { asTarget, finalizeSession, todayKey } from "./logic.ts";
import type {
  ActiveSession,
  AppData,
  AppEvent,
  BlockState,
  GoalChange,
  InterventionLog,
  InterventionType,
  LockAttempt,
  OpenLog,
  Outcome,
  RiskBand,
  RiskModelState,
  Settings,
  StudyCard,
  UsageLog,
} from "./types.ts";

/** 브라우저(웹) 저장 키. 안드로이드는 SQLite를 쓰고, 첫 실행 때 이 키의 기록을 옮긴다. */
export const STORAGE_KEY = "hanbakja.v1";
export const MIGRATED_KEY = "hanbakja.v1.migrated";

export function defaultSettings(): Settings {
  return {
    level1Threshold: 10,
    level2Threshold: 20,
    level3Threshold: 20,
    notificationTime: "21:00",
    notifyEnabled: true,
    finalGoal: 10,
    dayEndHour: 6,
    wakeTime: "07:00",
    aiEnabled: true,
    strictMode: false,
    banditV2: true,
    studyMode: false,
    goalWeekAnswered: "",
    usageSyncEnabled: false,
    usageSyncAsked: false,
    onboardingDone: false,
    cluster: "",
    demoMode: false,
  };
}

/** 하루 목표에서 나머지 기준을 만든다. level1(중간 강도 시작)은 목표의 절반. */
export function settingsFromGoal(
  goal: number,
  rest: Pick<
    Settings,
    | "notificationTime"
    | "notifyEnabled"
    | "finalGoal"
    | "dayEndHour"
    | "wakeTime"
    | "aiEnabled"
    | "strictMode"
    | "banditV2"
    | "studyMode"
    | "goalWeekAnswered"
    | "usageSyncEnabled"
    | "usageSyncAsked"
    | "onboardingDone"
    | "cluster"
    | "demoMode"
  >,
): Settings {
  // rest에 설정 전체가 와도 목표로 계산한 단계 기준이 이기도록 뒤에 둔다.
  return {
    ...rest,
    level1Threshold: Math.max(1, Math.round(goal / 2)),
    level2Threshold: goal,
    level3Threshold: goal,
  };
}

export function defaultData(): AppData {
  return {
    settings: defaultSettings(),
    goalLog: [],
    usageLogs: [],
    interventions: [],
    lockAttempts: [],
    cards: [],
    openLogs: [],
    appEvents: [],
    riskModel: null,
    compare: null,
    activeSession: null,
    block: { until: null, minutes: 0 },
    lastNotifiedDate: null,
  };
}

function isLevel(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

const OUTCOMES: Outcome[] = [
  "exit",
  "watch",
  "force-quit",
  "timed-block",
  "blocked-retry",
  "kept",
  "extend",
  "day-end",
  "overdraft",
  "budget-out",
  "interrupted",
];
const TYPES: InterventionType[] = [
  "pause",
  "alternative",
  "warning",
  "framing",
  "breath",
  "reflection",
  "card",
  "commit_end",
  "strong",
  "locked",
  "pip",
];

const RISK_BANDS: RiskBand[] = ["low", "medium", "high"];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const riskBandOf = (value: unknown): RiskBand | null =>
  RISK_BANDS.includes(value as RiskBand) ? (value as RiskBand) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** 한 줄씩 읽는다. 형식이 틀린 줄만 버리고 나머지는 살린다. */
export function readUsageLog(value: unknown): UsageLog | null {
  if (!value || typeof value !== "object") return null;
  const log = value as Partial<UsageLog>;
  if (
    typeof log.usageId !== "string" ||
    typeof log.startTime !== "string" ||
    typeof log.duration !== "number" ||
    !Number.isFinite(log.duration)
  ) {
    return null;
  }
  const start = new Date(log.startTime);
  if (Number.isNaN(start.getTime())) return null;
  return {
    usageId: log.usageId,
    date: typeof log.date === "string" ? log.date : todayKey(start),
    startTime: log.startTime,
    endTime: typeof log.endTime === "string" ? log.endTime : log.startTime,
    duration: Math.max(0, log.duration),
    clipCount: typeof log.clipCount === "number" ? log.clipCount : 1,
    target: asTarget(log.target) ?? "practice",
    source: log.source === "native" ? "native" : "web",
    openId: text(log.openId),
  };
}

export function readIntervention(value: unknown): InterventionLog | null {
  if (!value || typeof value !== "object") return null;
  const log = value as Partial<InterventionLog>;
  if (
    typeof log.interventionId !== "string" ||
    typeof log.timestamp !== "string" ||
    !isLevel(log.level) ||
    typeof log.reason !== "string"
  ) {
    return null;
  }
  const at = new Date(log.timestamp);
  if (Number.isNaN(at.getTime())) return null;
  const reEntered = Boolean(log.reEntered);
  const level = log.level;
  return {
    interventionId: log.interventionId,
    timestamp: log.timestamp,
    date: typeof log.date === "string" ? log.date : todayKey(at),
    level,
    reason: log.reason,
    reasonNote: typeof log.reasonNote === "string" ? log.reasonNote : "",
    alternativeAction: typeof log.alternativeAction === "string" ? log.alternativeAction : null,
    alternativeCompleted: Boolean(log.alternativeCompleted),
    reEntered,
    blocked: Boolean(log.blocked),
    blockDuration: typeof log.blockDuration === "number" ? log.blockDuration : 0,
    usageSeconds: typeof log.usageSeconds === "number" ? log.usageSeconds : 0,
    outcome: OUTCOMES.includes(log.outcome as Outcome)
      ? (log.outcome as Outcome)
      : reEntered
        ? "watch"
        : "exit",
    hour: typeof log.hour === "number" ? log.hour : at.getHours(),
    weekday: typeof log.weekday === "number" ? log.weekday : at.getDay(),
    target: asTarget(log.target),
    interventionType: TYPES.includes(log.interventionType as InterventionType)
      ? (log.interventionType as InterventionType)
      : level === 1
        ? "pause"
        : level === 2
          ? "alternative"
          : "warning",
    reenteredWithin30:
      typeof log.reenteredWithin30 === "boolean" ? log.reenteredWithin30 : null,
    feedback: log.feedback === "helpful" || log.feedback === "not" ? log.feedback : null,
    band: isLevel(log.band) ? log.band : null,
    stage: text(log.stage),
    framing: text(log.framing),
    verification: text(log.verification),
    reflection: text(log.reflection),
    afterLock: text(log.afterLock),
    commitMinutes: count(log.commitMinutes),
    cardId: text(log.cardId),
    cardCorrect: typeof log.cardCorrect === "boolean" ? log.cardCorrect : null,
    extensionIndex: count(log.extensionIndex),
    policyVersion: text(log.policyVersion),
    openId: text(log.openId),
    riskScore: finite(log.riskScore) ? log.riskScore : null,
    riskBand: riskBandOf(log.riskBand),
    tighten: log.tighten === "full" || log.tighten === "soft" ? log.tighten : null,
    tightenFollowed: typeof log.tightenFollowed === "boolean" ? log.tightenFollowed : null,
  };
}

export function readOpenLog(value: unknown): OpenLog | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<OpenLog>;
  if (typeof raw.id !== "string" || typeof raw.createdAt !== "string") return null;
  const at = new Date(raw.createdAt);
  const band = riskBandOf(raw.band);
  if (Number.isNaN(at.getTime()) || !band || !finite(raw.score)) return null;
  if (!Array.isArray(raw.features) || !raw.features.every(finite)) return null;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    date: typeof raw.date === "string" ? raw.date : todayKey(at),
    target: asTarget(raw.target),
    features: raw.features,
    score: raw.score,
    band,
    tighten: raw.tighten === "full" || raw.tighten === "soft" ? raw.tighten : null,
    keeping: raw.keeping === true,
    modelVersion: typeof raw.modelVersion === "string" ? raw.modelVersion : "",
    label: typeof raw.label === "boolean" ? raw.label : null,
    durationSec: finite(raw.durationSec) ? raw.durationSec : null,
  };
}

export function readAppEvent(value: unknown): AppEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AppEvent>;
  if (typeof raw.id !== "string" || typeof raw.createdAt !== "string") return null;
  if (raw.kind !== "blocker_off" && raw.kind !== "blocker_on") return null;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    kind: raw.kind,
    todaySeconds: finite(raw.todaySeconds) ? Math.max(0, raw.todaySeconds) : 0,
  };
}

/** 저장해 둔 비교 통계. 받은 시각을 유지한다. */
export function readCompareSaved(value: unknown): AppData["compare"] {
  const stats = readCompare(value);
  if (!stats) return null;
  const at = (value as { fetchedAt?: unknown }).fetchedAt;
  return { ...stats, fetchedAt: typeof at === "string" ? at : new Date(0).toISOString() };
}

/** 폰에서 고친 가중치. 형식이 틀리면 null (시작 모델을 쓴다). */
export function readRiskModel(value: unknown): RiskModelState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RiskModelState>;
  if (typeof raw.version !== "string" || !Array.isArray(raw.weights) || !raw.weights.every(finite)) return null;
  if (!finite(raw.bias)) return null;
  const start =
    raw.start && Array.isArray(raw.start.weights) && raw.start.weights.every(finite) && finite(raw.start.bias)
      ? { weights: raw.start.weights, bias: raw.start.bias }
      : null;
  return {
    version: raw.version,
    weights: raw.weights,
    bias: raw.bias,
    updates: count(raw.updates),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    start,
  };
}

export function readCard(value: unknown): StudyCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StudyCard>;
  if (typeof raw.id !== "string" || typeof raw.question !== "string" || !raw.question.trim()) {
    return null;
  }
  if (!Array.isArray(raw.options)) return null;
  const options = raw.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
  if (options.length < 2 || options.length !== raw.options.length) return null;
  const answer = typeof raw.answer === "number" ? raw.answer : -1;
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return {
    id: raw.id,
    question: raw.question.trim(),
    options: options.map((o) => o.trim()),
    answer,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    source: raw.source === "import" ? "import" : "manual",
    shown: count(raw.shown),
    correct: count(raw.correct),
    explanation: typeof raw.explanation === "string" ? raw.explanation.trim().slice(0, 500) : "",
  };
}

export function readLockAttempt(value: unknown): LockAttempt | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<LockAttempt>;
  if (typeof row.id !== "string" || typeof row.createdAt !== "string") return null;
  const at = new Date(row.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    date: typeof row.date === "string" ? row.date : todayKey(at),
    remainingSec: typeof row.remainingSec === "number" ? row.remainingSec : 0,
    target: asTarget(row.target),
  };
}

export function readSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Partial<Settings>;
  const level3 = Number(raw.level3Threshold ?? defaults.level3Threshold);
  const notificationTime =
    typeof raw.notificationTime === "string" && /^\d{2}:\d{2}$/.test(raw.notificationTime)
      ? raw.notificationTime
      : defaults.notificationTime;
  const rest = {
    notificationTime,
    notifyEnabled: raw.notifyEnabled !== false,
    finalGoal: count(raw.finalGoal) || defaults.finalGoal,
    dayEndHour:
      typeof raw.dayEndHour === "number" && raw.dayEndHour >= 0 && raw.dayEndHour <= 12
        ? Math.round(raw.dayEndHour)
        : defaults.dayEndHour,
    wakeTime:
      typeof raw.wakeTime === "string" && /^\d{2}:\d{2}$/.test(raw.wakeTime)
        ? raw.wakeTime
        : defaults.wakeTime,
    aiEnabled: raw.aiEnabled !== false,
    strictMode: raw.strictMode === true,
    banditV2: raw.banditV2 !== false,
    studyMode: raw.studyMode === true,
    goalWeekAnswered: typeof raw.goalWeekAnswered === "string" ? raw.goalWeekAnswered : "",
    usageSyncEnabled: raw.usageSyncEnabled === true,
    usageSyncAsked: raw.usageSyncAsked === true,
    // 이 칸이 생기기 전 버전에서 쓰던 사람은 처음 질문을 묻지 않는다 (이미 기록이 있다).
    onboardingDone: raw.onboardingDone !== false,
    cluster: typeof raw.cluster === "string" ? raw.cluster : "",
    demoMode: raw.demoMode === true,
  };
  const goal =
    Number.isFinite(level3) && level3 >= 1 && level3 <= 360 ? Math.round(level3) : defaults.level3Threshold;
  const settings = settingsFromGoal(goal, rest);
  return { ...settings, finalGoal: Math.min(settings.finalGoal, goal) };
}

/** 목표 기록. 형식이 틀린 줄은 버린다. */
export function readGoalLog(value: unknown): GoalChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Partial<GoalChange>;
    if (typeof raw.from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.from)) return [];
    const minutes = Number(raw.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 360) return [];
    return [{ from: raw.from, minutes: Math.round(minutes) }];
  });
}

export function readBlock(value: unknown): BlockState {
  if (!value || typeof value !== "object") return { until: null, minutes: 0 };
  const raw = value as Partial<BlockState>;
  return {
    until: typeof raw.until === "string" ? raw.until : null,
    minutes: typeof raw.minutes === "number" ? raw.minutes : 0,
  };
}

export function readSession(value: unknown): ActiveSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ActiveSession>;
  if (
    typeof raw.usageId !== "string" ||
    typeof raw.date !== "string" ||
    typeof raw.startTime !== "string" ||
    typeof raw.duration !== "number" ||
    typeof raw.clipCount !== "number" ||
    !isLevel(raw.levelAtStart)
  ) {
    return null;
  }
  return {
    usageId: raw.usageId,
    date: raw.date,
    startTime: raw.startTime,
    duration: raw.duration,
    clipCount: raw.clipCount,
    interventionId: typeof raw.interventionId === "string" ? raw.interventionId : "",
    levelAtStart: raw.levelAtStart,
    lastTickAt: typeof raw.lastTickAt === "number" ? raw.lastTickAt : Date.now(),
  };
}

function readAll<T>(value: unknown, read: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(read).filter((row): row is T => row !== null);
}

/** 전체 문서가 객체가 아니면 null. 줄 단위 오류는 그 줄만 버린다. */
export function normalizeData(value: unknown): AppData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AppData>;
  if (!Array.isArray(raw.usageLogs) || !Array.isArray(raw.interventions)) return null;
  return {
    settings: readSettings(raw.settings),
    goalLog: readGoalLog(raw.goalLog),
    usageLogs: readAll(raw.usageLogs, readUsageLog),
    interventions: readAll(raw.interventions, readIntervention),
    lockAttempts: readAll(raw.lockAttempts, readLockAttempt),
    cards: readAll(raw.cards, readCard),
    openLogs: readAll(raw.openLogs, readOpenLog),
    appEvents: readAll(raw.appEvents, readAppEvent),
    riskModel: readRiskModel(raw.riskModel),
    compare: raw.compare ? readCompareSaved(raw.compare) : null,
    activeSession: readSession(raw.activeSession),
    block: readBlock(raw.block),
    lastNotifiedDate: typeof raw.lastNotifiedDate === "string" ? raw.lastNotifiedDate : null,
  };
}

/** 브라우저 저장소에서 읽는다. 안드로이드 이관에도 쓴다. */
export function readLocalStorage(key = STORAGE_KEY): { data: AppData | null; corrupt: boolean } {
  const raw = localStorage.getItem(key);
  if (!raw) return { data: null, corrupt: false };
  try {
    const data = normalizeData(JSON.parse(raw));
    return data ? { data, corrupt: false } : { data: null, corrupt: true };
  } catch {
    return { data: null, corrupt: true };
  }
}

export function loadData(): { data: AppData; corrupt: boolean } {
  const { data, corrupt } = readLocalStorage();
  if (corrupt) return { data: defaultData(), corrupt: true };
  return { data: data ? finalizeSession(data) : defaultData(), corrupt: false };
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearData(): void {
  localStorage.removeItem(STORAGE_KEY);
}
