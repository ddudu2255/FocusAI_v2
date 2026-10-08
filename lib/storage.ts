import { asTarget, finalizeSession, todayKey } from "./logic.ts";
import type {
  ActiveSession,
  AppData,
  BlockState,
  InterventionLog,
  InterventionType,
  LockAttempt,
  Outcome,
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
    interestTopic: "",
    wakeTime: "07:00",
    aiEnabled: true,
    strictMode: false,
    banditV2: true,
    goalWeekAnswered: "",
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
    | "interestTopic"
    | "wakeTime"
    | "aiEnabled"
    | "strictMode"
    | "banditV2"
    | "goalWeekAnswered"
  >,
): Settings {
  return {
    level1Threshold: Math.max(1, Math.round(goal / 2)),
    level2Threshold: goal,
    level3Threshold: goal,
    ...rest,
  };
}

export function defaultData(): AppData {
  return {
    settings: defaultSettings(),
    usageLogs: [],
    interventions: [],
    lockAttempts: [],
    cards: [],
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
    interestTopic: typeof raw.interestTopic === "string" ? raw.interestTopic.slice(0, 40) : "",
    wakeTime:
      typeof raw.wakeTime === "string" && /^\d{2}:\d{2}$/.test(raw.wakeTime)
        ? raw.wakeTime
        : defaults.wakeTime,
    aiEnabled: raw.aiEnabled !== false,
    strictMode: raw.strictMode === true,
    banditV2: raw.banditV2 !== false,
    goalWeekAnswered: typeof raw.goalWeekAnswered === "string" ? raw.goalWeekAnswered : "",
  };
  const goal =
    Number.isFinite(level3) && level3 >= 1 && level3 <= 360 ? Math.round(level3) : defaults.level3Threshold;
  const settings = settingsFromGoal(goal, rest);
  return { ...settings, finalGoal: Math.min(settings.finalGoal, goal) };
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
    usageLogs: readAll(raw.usageLogs, readUsageLog),
    interventions: readAll(raw.interventions, readIntervention),
    lockAttempts: readAll(raw.lockAttempts, readLockAttempt),
    cards: readAll(raw.cards, readCard),
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
