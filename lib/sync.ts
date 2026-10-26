/**
 * 사용 기록 올리기 (동의한 사람만). 팀원 hanbakja focusai 브랜치의 usage-sync 설계를 이어받았다:
 * 설치마다 무작위 번호(install_id), 공개 키로 넣기만, 같은 id는 다시 와도 한 번만, 서버에서 지우기.
 *
 * 팀원 기존 표(sessions, interventions, lock_attempts)에는 팀원이 정한 칸만 넣는다.
 * 우리 기록(열기·위험 점수, 하루 목표·요약, 쇼츠/릴스, 고른 이유 번호)은 sai_ 표에 넣는다.
 * sai_ 표는 supabase/shortsai_v1.sql을 실행해야 생긴다. 앱은 sai_schema_version()으로 확인하고,
 * 없으면 팀원 표에만 올린다 (그 사이 sai_ 기록은 보내지 않고 남겨 둔다).
 *
 * 올리지 않는 것: 화면 글, 성찰 답, "기타" 직접 쓴 글, 공부 카드 내용, 설정(목표 빼고).
 * 이 모듈은 저장소를 직접 읽고 쓰지 않는다: 보낼 줄을 만들고(buildUploads), 보낸 뒤 보낸 id를 돌려준다(flush).
 */
import { goalMinutesOn, lastDates, todayKey, usageSecondsOn, firstRecordDate } from "./logic.ts";
import type { SyncConfig } from "./sync-config.ts";
import type { AppData, InterventionLog } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;
const METHODS = new Set(["pause", "framing", "breath", "alternative", "reflection", "card", "warning"]);
const STAGES = new Set(["entry", "commit_end", "strong", "web", "locked", "pip"]);
const WATCH_OUTCOMES = new Set(["watch", "extend", "overdraft", "budget-out", "interrupted"]);
/** 앱의 이유 버튼 순서 (logic.ts REASONS). 서버에는 번호만 보낸다. */
const REASON_INDEX = ["심심해서", "습관적으로", "잠깐 보려고", "스트레스 해소를 위해", "특별한 이유 없이", "기타"];
/** 하루 요약은 최근 이만큼만 보낸다. */
const DAILY_DAYS = 60;
/** 한 번에 보내는 줄 수 */
const CHUNK = 200;

export type SyncTable =
  | "sessions"
  | "interventions"
  | "lock_attempts"
  | "sai_session_links"
  | "sai_opens"
  | "sai_intervention_details"
  | "sai_daily";

/** 보낼 줄. key는 보낸 기록(sync_sent)에 남기는 이름 (표:id). */
export type Upload = { table: SyncTable; key: string; row: Record<string, unknown> };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** 재진입 판정이 아직이면 개입은 보내지 않는다 (팀원 설계와 같다). 시청을 고른 줄은 바로 보낸다. */
export function interventionReady(log: Pick<InterventionLog, "outcome" | "reenteredWithin30">): boolean {
  return log.reenteredWithin30 !== null || WATCH_OUTCOMES.has(log.outcome);
}

/**
 * 아직 안 보낸 줄. schema가 1 이상이면 sai_ 표 줄도 만든다.
 * 열려 있는 연습 세션, 정답이 안 붙은 열기, 오늘(아직 안 끝난 날)의 하루 요약은 보내지 않는다.
 */
export function buildUploads(
  data: AppData,
  sent: ReadonlySet<string>,
  installId: string,
  schema: number,
  now = new Date(),
): Upload[] {
  const out: Upload[] = [];
  const add = (table: SyncTable, id: string, row: Record<string, unknown>) => {
    const key = `${table}:${id}`;
    if (!sent.has(key)) out.push({ table, key, row: { install_id: installId, ...row } });
  };
  const ours = schema >= 1;
  const active = data.activeSession?.usageId ?? null;

  for (const log of data.usageLogs) {
    if (!isUuid(log.usageId) || log.usageId === active) continue;
    add("sessions", log.usageId, {
      event_id: log.usageId,
      target: log.target,
      source: log.source,
      started_at: log.startTime,
      ended_at: log.endTime,
      duration_sec: Math.max(0, log.duration),
      clip_count: Math.max(0, Math.round(log.clipCount)),
    });
    if (ours) {
      add("sai_session_links", log.usageId, { event_id: log.usageId, open_id: log.openId ?? null, target: log.target });
    }
  }

  for (const log of data.interventions) {
    if (!isUuid(log.interventionId) || !interventionReady(log)) continue;
    const intensity = log.band ?? log.level;
    add("interventions", log.interventionId, {
      event_id: log.interventionId,
      created_at: log.timestamp,
      weekday: log.weekday,
      intensity,
      stage: log.stage && STAGES.has(log.stage) ? log.stage : null,
      method: METHODS.has(log.interventionType) ? log.interventionType : null,
      commit_minutes: Math.max(0, Math.round(log.commitMinutes || 0)),
      card_correct: log.cardCorrect,
      outcome: log.outcome,
      reentered_within_30min: log.reenteredWithin30,
      policy_version: log.policyVersion && POLICY_VERSION.test(log.policyVersion) ? log.policyVersion : null,
    });
    if (ours) {
      const reason = REASON_INDEX.indexOf(log.reason);
      add("sai_intervention_details", log.interventionId, {
        event_id: log.interventionId,
        hour: log.hour,
        target: log.target,
        reason: reason >= 0 ? reason : null,
        risk_band: log.riskBand,
        tighten: log.tighten,
        open_id: log.openId,
      });
    }
  }

  for (const row of data.lockAttempts) {
    if (!isUuid(row.id)) continue;
    add("lock_attempts", row.id, {
      event_id: row.id,
      created_at: row.createdAt,
      remaining_sec: Math.max(0, Math.round(row.remainingSec)),
    });
  }

  if (ours) {
    for (const open of data.openLogs) {
      if (!isUuid(open.id) || open.label === null) continue;
      add("sai_opens", open.id, {
        event_id: open.id,
        created_at: open.createdAt,
        target: open.target,
        features: open.features,
        score: open.score,
        band: open.band,
        tighten: open.tighten,
        keeping: open.keeping,
        label: open.label,
        watched_sec: open.durationSec ?? 0,
        model_version: open.modelVersion,
      });
    }
    const first = firstRecordDate(data);
    const today = todayKey(now);
    for (const day of lastDates(DAILY_DAYS + 1, now)) {
      if (!first || day < first || day >= today) continue;
      const goal = goalMinutesOn(data, day);
      const watched = usageSecondsOn(data, day);
      add("sai_daily", day, { day, goal_minutes: goal, watched_sec: watched, kept: watched <= goal * 60 });
    }
  }
  return out;
}

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

export function isConfigured(config: SyncConfig): boolean {
  if (!config.url || !config.anonKey) return false;
  try {
    const url = new URL(config.url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function endpoint(config: SyncConfig, path: string): string {
  return `${config.url.replace(/\/+$/, "")}/rest/v1/${path}`;
}

function headers(config: SyncConfig, installId: string): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
    "x-install-id": installId,
  };
}

/** 우리 SQL(supabase/shortsai_v1.sql)이 실행됐으면 1, 아니면 0. 연결이 안 되면 null. */
export async function schemaVersion(config: SyncConfig, installId: string, fetchImpl: FetchLike = fetch): Promise<number | null> {
  try {
    const response = await fetchImpl(endpoint(config, "rpc/sai_schema_version"), {
      method: "POST",
      headers: headers(config, installId),
      body: "{}",
    });
    if (response.status === 404) return 0;
    if (!response.ok || !response.json) return null;
    const value = await response.json();
    return typeof value === "number" ? value : 0;
  } catch {
    return null;
  }
}

/** 이 설치의 서버 기록을 지운다. 우리 SQL이 있으면 sai_ 표까지, 없으면 팀원 표만. */
export async function deleteServerRows(
  config: SyncConfig,
  installId: string,
  schema: number,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!isConfigured(config) || !isUuid(installId)) return false;
  try {
    const fn = schema >= 1 ? "sai_delete_own" : "delete_own_usage";
    const response = await fetchImpl(endpoint(config, `rpc/${fn}`), {
      method: "POST",
      headers: headers(config, installId),
      body: "{}",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function post(config: SyncConfig, installId: string, table: SyncTable, rows: Record<string, unknown>[], fetchImpl: FetchLike) {
  try {
    const response = await fetchImpl(endpoint(config, table), {
      method: "POST",
      headers: headers(config, installId),
      body: JSON.stringify(rows),
    });
    return response.status;
  } catch {
    return 0;
  }
}

/**
 * 표마다 묶어 보낸다. 성공(2xx)이면 묶음 전체를 보낸 것으로 본다.
 * 409(이미 있는 id)가 오면 묶음 전체가 거절된 것이라, 한 줄씩 다시 보내 409인 줄만 이미 받은 줄로 본다.
 * 그 밖의 실패는 다음에 다시 보낸다. 보낸 줄의 key를 돌려준다.
 */
export async function flush(
  uploads: Upload[],
  config: SyncConfig,
  installId: string,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  if (!isConfigured(config) || !isUuid(installId)) return [];
  const done: string[] = [];
  const tables = [...new Set(uploads.map((u) => u.table))];
  for (const table of tables) {
    const rows = uploads.filter((u) => u.table === table);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const status = await post(config, installId, table, chunk.map((u) => u.row), fetchImpl);
      if (status >= 200 && status < 300) {
        done.push(...chunk.map((u) => u.key));
      } else if (status === 409) {
        for (const one of chunk) {
          const single = await post(config, installId, table, [one.row], fetchImpl);
          if ((single >= 200 && single < 300) || single === 409) done.push(one.key);
        }
      } else {
        break; // 연결이 안 되거나 서버가 거절하면 이 표는 다음에
      }
    }
  }
  return done;
}
