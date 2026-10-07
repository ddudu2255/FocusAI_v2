import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import {
  defaultData,
  MIGRATED_KEY,
  readBlock,
  readCard,
  readIntervention,
  readLocalStorage,
  readLockAttempt,
  readSession,
  readSettings,
  readUsageLog,
  STORAGE_KEY,
} from "./storage.ts";
import type {
  AppData,
  InterventionLog,
  LockAttempt,
  Settings,
  StudyCard,
  UsageLog,
} from "./types.ts";

/**
 * 안드로이드 저장소. localStorage는 OS가 지울 수 있어 기록은 SQLite에 둔다.
 * 표: sessions, interventions, lock_attempts, cards, settings(키-값).
 */
const DB_NAME = "shortsai";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  target TEXT NOT NULL,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  clip_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions (started_at);
CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  target TEXT,
  level INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reason_note TEXT NOT NULL DEFAULT '',
  intervention_type TEXT NOT NULL,
  alternative_action TEXT,
  alternative_completed INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  re_entered INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  block_minutes INTEGER NOT NULL DEFAULT 0,
  usage_seconds REAL NOT NULL DEFAULT 0,
  reentered_within_30min INTEGER,
  feedback TEXT
);
CREATE INDEX IF NOT EXISTS interventions_created ON interventions (created_at);
CREATE TABLE IF NOT EXISTS lock_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  date TEXT NOT NULL,
  remaining_sec INTEGER NOT NULL,
  target TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY NOT NULL,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  answer INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT ''
);
`;

/**
 * v0.8.0에서 interventions에 더한 칸. 이전 버전에서 만든 표에는 없으므로 열 때 추가한다.
 * (AI 학습 재료: 강도, 단계, 보여준 문구, 참여 확인, 성찰, 약속, 카드, 정책표 버전)
 */
const INTERVENTION_COLUMNS: [string, string][] = [
  ["band", "INTEGER"],
  ["stage", "TEXT"],
  ["framing", "TEXT"],
  ["verification", "TEXT"],
  ["reflection", "TEXT"],
  ["after_lock", "TEXT"],
  ["commit_minutes", "INTEGER NOT NULL DEFAULT 0"],
  ["card_id", "TEXT"],
  ["card_correct", "INTEGER"],
  ["extension_index", "INTEGER NOT NULL DEFAULT 0"],
  ["policy_version", "TEXT"],
];

type Statement = { statement: string; values: unknown[] };

const sqlite = new SQLiteConnection(CapacitorSQLite);
let opening: Promise<SQLiteDBConnection> | null = null;

async function connect(): Promise<SQLiteDBConnection> {
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const db =
    consistent && exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
  await db.open();
  await db.execute(SCHEMA);
  const info = await db.query("PRAGMA table_info(interventions)");
  const have = new Set(((info.values ?? []) as { name?: string }[]).map((row) => row.name));
  for (const [name, type] of INTERVENTION_COLUMNS) {
    if (!have.has(name)) await db.execute(`ALTER TABLE interventions ADD COLUMN ${name} ${type};`);
  }
  // v0.8.1: card explanation
  const cardInfo = await db.query("PRAGMA table_info(cards)");
  const cardCols = new Set(((cardInfo.values ?? []) as { name?: string }[]).map((row) => row.name));
  if (!cardCols.has("explanation")) {
    await db.execute("ALTER TABLE cards ADD COLUMN explanation TEXT NOT NULL DEFAULT '';");
  }
  return db;
}

function database(): Promise<SQLiteDBConnection> {
  if (!opening) {
    opening = connect().catch((error) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

// --- Row mapping -------------------------------------------------------------

const bit = (value: boolean) => (value ? 1 : 0);

function sessionRow(log: UsageLog): Statement {
  return {
    statement:
      "INSERT OR REPLACE INTO sessions (id, target, source, date, started_at, ended_at, duration_sec, clip_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    values: [
      log.usageId,
      log.target,
      log.source,
      log.date,
      log.startTime,
      log.endTime,
      log.duration,
      log.clipCount,
    ],
  };
}

function interventionRow(log: InterventionLog): Statement {
  return {
    statement: `INSERT OR REPLACE INTO interventions (id, created_at, date, hour, weekday, target, level, reason, reason_note,
      intervention_type, alternative_action, alternative_completed, outcome, re_entered, blocked, block_minutes,
      usage_seconds, reentered_within_30min, feedback, band, stage, framing, verification, reflection, after_lock,
      commit_minutes, card_id, card_correct, extension_index, policy_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      log.interventionId,
      log.timestamp,
      log.date,
      log.hour,
      log.weekday,
      log.target,
      log.level,
      log.reason,
      log.reasonNote,
      log.interventionType,
      log.alternativeAction,
      bit(log.alternativeCompleted),
      log.outcome,
      bit(log.reEntered),
      bit(log.blocked),
      log.blockDuration,
      log.usageSeconds,
      log.reenteredWithin30 === null ? null : bit(log.reenteredWithin30),
      log.feedback,
      log.band,
      log.stage,
      log.framing,
      log.verification,
      log.reflection,
      log.afterLock,
      log.commitMinutes,
      log.cardId,
      log.cardCorrect === null ? null : bit(log.cardCorrect),
      log.extensionIndex,
      log.policyVersion,
    ],
  };
}

function cardRow(card: StudyCard): Statement {
  return {
    statement:
      "INSERT OR REPLACE INTO cards (id, question, options, answer, created_at, source, shown, correct, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    values: [
      card.id,
      card.question,
      JSON.stringify(card.options),
      card.answer,
      card.createdAt,
      card.source,
      card.shown,
      card.correct,
      card.explanation,
    ],
  };
}

function lockRow(row: LockAttempt): Statement {
  return {
    statement:
      "INSERT OR REPLACE INTO lock_attempts (id, created_at, date, remaining_sec, target) VALUES (?, ?, ?, ?, ?)",
    values: [row.id, row.createdAt, row.date, row.remainingSec, row.target],
  };
}

function settingRow(key: string, value: unknown): Statement {
  return {
    statement: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    values: [key, JSON.stringify(value)],
  };
}

type Row = Record<string, unknown>;

function fromSessionRow(row: Row): UsageLog | null {
  return readUsageLog({
    usageId: row.id,
    target: row.target,
    source: row.source,
    date: row.date,
    startTime: row.started_at,
    endTime: row.ended_at,
    duration: Number(row.duration_sec),
    clipCount: Number(row.clip_count),
  });
}

function fromInterventionRow(row: Row): InterventionLog | null {
  const within = row.reentered_within_30min;
  return readIntervention({
    interventionId: row.id,
    timestamp: row.created_at,
    date: row.date,
    hour: Number(row.hour),
    weekday: Number(row.weekday),
    target: row.target,
    level: Number(row.level),
    reason: row.reason,
    reasonNote: row.reason_note,
    interventionType: row.intervention_type,
    alternativeAction: row.alternative_action ?? null,
    alternativeCompleted: Number(row.alternative_completed) === 1,
    outcome: row.outcome,
    reEntered: Number(row.re_entered) === 1,
    blocked: Number(row.blocked) === 1,
    blockDuration: Number(row.block_minutes),
    usageSeconds: Number(row.usage_seconds),
    reenteredWithin30: within === null || within === undefined ? null : Number(within) === 1,
    feedback: row.feedback ?? null,
    band: row.band === null || row.band === undefined ? null : Number(row.band),
    stage: row.stage ?? null,
    framing: row.framing ?? null,
    verification: row.verification ?? null,
    reflection: row.reflection ?? null,
    afterLock: row.after_lock ?? null,
    commitMinutes: Number(row.commit_minutes ?? 0),
    cardId: row.card_id ?? null,
    cardCorrect:
      row.card_correct === null || row.card_correct === undefined ? null : Number(row.card_correct) === 1,
    extensionIndex: Number(row.extension_index ?? 0),
    policyVersion: row.policy_version ?? null,
  });
}

function fromCardRow(row: Row): StudyCard | null {
  return readCard({
    id: row.id,
    question: row.question,
    options: parse(row.options),
    answer: Number(row.answer),
    createdAt: row.created_at,
    source: row.source,
    shown: Number(row.shown),
    correct: Number(row.correct),
    explanation: row.explanation ?? "",
  });
}

function fromLockRow(row: Row): LockAttempt | null {
  return readLockAttempt({
    id: row.id,
    createdAt: row.created_at,
    date: row.date,
    remainingSec: Number(row.remaining_sec),
    target: row.target,
  });
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// --- Public API --------------------------------------------------------------

/** 저장소 변경 한 건. 화면 상태를 바꿀 때 함께 만든다. */
export type Op =
  | { kind: "session"; row: UsageLog }
  | { kind: "intervention"; row: InterventionLog }
  | { kind: "lock"; row: LockAttempt }
  | { kind: "card"; row: StudyCard }
  | { kind: "deleteCard"; id: string }
  | { kind: "settings"; settings: Settings }
  | { kind: "block"; block: AppData["block"] }
  | { kind: "activeSession"; session: AppData["activeSession"] }
  | { kind: "lastNotifiedDate"; date: string | null }
  | { kind: "clear" };

function statementsFor(op: Op): Statement[] {
  switch (op.kind) {
    case "session":
      return [sessionRow(op.row)];
    case "intervention":
      return [interventionRow(op.row)];
    case "lock":
      return [lockRow(op.row)];
    case "card":
      return [cardRow(op.row)];
    case "deleteCard":
      return [{ statement: "DELETE FROM cards WHERE id = ?", values: [op.id] }];
    case "settings":
      return [settingRow("settings", op.settings)];
    case "block":
      return [settingRow("block", op.block)];
    case "activeSession":
      return [settingRow("activeSession", op.session)];
    case "lastNotifiedDate":
      return [settingRow("lastNotifiedDate", op.date)];
    case "clear":
      return [
        { statement: "DELETE FROM sessions", values: [] },
        { statement: "DELETE FROM interventions", values: [] },
        { statement: "DELETE FROM lock_attempts", values: [] },
        { statement: "UPDATE cards SET shown = 0, correct = 0", values: [] },
        { statement: "DELETE FROM settings WHERE key != 'migrated'", values: [] },
      ];
  }
}

export async function applyOps(ops: Op[]): Promise<void> {
  const set = ops.flatMap(statementsFor);
  if (set.length === 0) return;
  const db = await database();
  await db.executeSet(set as { statement: string; values: unknown[] }[], true);
}

/** 모든 기록을 읽는다. 형식이 틀린 줄은 건너뛴다. */
export async function loadAll(): Promise<AppData> {
  const db = await database();
  const [sessions, interventions, locks, cards, settings] = await Promise.all([
    db.query("SELECT * FROM sessions ORDER BY started_at"),
    db.query("SELECT * FROM interventions ORDER BY created_at"),
    db.query("SELECT * FROM lock_attempts ORDER BY created_at"),
    db.query("SELECT * FROM cards ORDER BY created_at"),
    db.query("SELECT key, value FROM settings"),
  ]);
  const meta = new Map<string, unknown>();
  for (const row of (settings.values ?? []) as Row[]) {
    meta.set(String(row.key), parse(row.value));
  }
  const keep = <T,>(rows: unknown[] | undefined, read: (row: Row) => T | null) =>
    ((rows ?? []) as Row[]).map(read).filter((row): row is T => row !== null);
  const base = defaultData();
  return {
    settings: meta.has("settings") ? readSettings(meta.get("settings")) : base.settings,
    usageLogs: keep(sessions.values, fromSessionRow),
    interventions: keep(interventions.values, fromInterventionRow),
    lockAttempts: keep(locks.values, fromLockRow),
    cards: keep(cards.values, fromCardRow),
    activeSession: readSession(meta.get("activeSession")),
    block: readBlock(meta.get("block")),
    lastNotifiedDate:
      typeof meta.get("lastNotifiedDate") === "string"
        ? (meta.get("lastNotifiedDate") as string)
        : null,
  };
}

/**
 * 첫 실행 때 localStorage 기록을 SQLite로 옮긴다. 옮긴 뒤 원본은
 * 다른 키로 남겨 두고(되돌릴 수 있게) 다시 옮기지 않는다.
 */
export async function migrateFromLocalStorage(): Promise<number> {
  const db = await database();
  const done = await db.query("SELECT value FROM settings WHERE key = 'migrated'");
  if ((done.values ?? []).length > 0) return 0;
  const { data } = readLocalStorage();
  const ops: Op[] = [];
  if (data) {
    ops.push({ kind: "settings", settings: data.settings });
    ops.push({ kind: "block", block: data.block });
    ops.push({ kind: "lastNotifiedDate", date: data.lastNotifiedDate });
    for (const row of data.usageLogs) ops.push({ kind: "session", row });
    for (const row of data.interventions) ops.push({ kind: "intervention", row });
    for (const row of data.lockAttempts) ops.push({ kind: "lock", row });
    for (const row of data.cards) ops.push({ kind: "card", row });
  }
  const set = [...ops.flatMap(statementsFor), settingRow("migrated", new Date().toISOString())];
  await db.executeSet(set as { statement: string; values: unknown[] }[], true);
  if (data) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(MIGRATED_KEY, raw);
    localStorage.removeItem(STORAGE_KEY);
  }
  return data ? data.usageLogs.length + data.interventions.length : 0;
}
