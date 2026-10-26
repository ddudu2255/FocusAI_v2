/**
 * 다른 사용자와 비교 (사용자 확인 2026-10-26, docs/server/DESIGN.md 5장).
 * 서버(sai_compare)가 계산한 결과만 하루 한 번 받아 폰에 둔다. 원본 기록은 받지 않는다.
 * 좋은 행동 쪽 숫자만 쓴다 (3분 고름, 바로 나감, 목표 지킴). 기록이 모자란 칸(20명 미만)은 비어 온다.
 * 시연 모드면 시연 데이터(가상 사용자)를 받고, 문구 끝에 "(시연 데이터)"를 붙인다.
 */
import { firstRecordDate, goalMinutesOn, lastDates, usageSecondsOn } from "./logic.ts";
import type { SyncConfig } from "./sync-config.ts";
import type { AppData } from "./types.ts";

export type HourStat = { users: number; opens: number; shortRate: number; exitRate: number } | null;
export type CompareStats = {
  demo: boolean;
  byHour: HourStat[];
  byGoal: Record<string, { users: number; avgKeptDays: number } | null>;
  fetchedAt: string;
};

/** 하루에 한 번 받는다. */
export const COMPARE_REFRESH_MS = 24 * 3_600_000;
export const DEMO_TAG = " (시연 데이터)";

export function goalBucket(goal: number): string {
  if (goal <= 30) return "≤30";
  if (goal <= 45) return "31-45";
  if (goal <= 60) return "46-60";
  return "61+";
}

/** 서버 응답을 확인해 받는다. 형식이 틀리면 null. */
export function readCompare(value: unknown, now = new Date()): CompareStats | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { demo?: unknown; byHour?: unknown; byGoal?: unknown };
  if (!Array.isArray(raw.byHour) || raw.byHour.length !== 24) return null;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const byHour = raw.byHour.map((h): HourStat => {
    if (!h || typeof h !== "object") return null;
    const r = h as Record<string, unknown>;
    if (!num(r.users) || !num(r.opens) || !num(r.shortRate) || !num(r.exitRate)) return null;
    return { users: r.users as number, opens: r.opens as number, shortRate: r.shortRate as number, exitRate: r.exitRate as number };
  });
  const byGoal: CompareStats["byGoal"] = {};
  if (raw.byGoal && typeof raw.byGoal === "object") {
    for (const [key, g] of Object.entries(raw.byGoal as Record<string, unknown>)) {
      const r = g as Record<string, unknown> | null;
      byGoal[key] = r && num(r.users) && num(r.avgKeptDays) ? { users: r.users as number, avgKeptDays: r.avgKeptDays as number } : null;
    }
  }
  return { demo: raw.demo === true, byHour, byGoal, fetchedAt: now.toISOString() };
}

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** sai_compare 호출. 설치 번호는 보내지 않는다 (계산 결과만 받는다). 실패하면 null. */
export async function fetchCompare(config: SyncConfig, demo: boolean, fetchImpl: FetchLike = fetch): Promise<CompareStats | null> {
  if (!config.url || !config.anonKey) return null;
  try {
    const response = await fetchImpl(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/sai_compare`, {
      method: "POST",
      headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_demo: demo }),
    });
    if (!response.ok) return null;
    return readCompare(await response.json());
  } catch {
    return null;
  }
}

/** "10명 중 N명". 0명이면 null (그 문구는 쓰지 않는다). */
export function outOfTen(rate: number): number | null {
  const n = Math.round(rate * 10);
  return n >= 1 && n <= 10 ? n : null;
}

/** 지난 7일(오늘 제외) 중 그날 목표 안에서 끝낸 날. 기록이 처음 생긴 날 전은 세지 않는다. */
export function keptDaysLastWeek(data: AppData, now = new Date()): number {
  const first = firstRecordDate(data);
  if (!first) return 0;
  return lastDates(8, now)
    .slice(0, 7)
    .filter((day) => day >= first && usageSecondsOn(data, day) <= goalMinutesOn(data, day) * 60).length;
}

/** 홈 "오늘 사용" 아래 한 줄. 비교할 기록이 없으면 null. */
export function homeLine(stats: CompareStats | null, data: AppData, now = new Date()): string | null {
  const group = stats?.byGoal[goalBucket(data.settings.level3Threshold)];
  if (!stats || !group) return null;
  const tag = stats.demo ? DEMO_TAG : "";
  return `목표가 비슷한 사람들은 지난주 7일 중 평균 ${formatDays(group.avgKeptDays)}일을 지켰어요. 나는 ${keptDaysLastWeek(data, now)}일이에요.${tag}`;
}

/** 일일 리포트 한 줄. */
export function reportLine(stats: CompareStats | null, data: AppData): string | null {
  const group = stats?.byGoal[goalBucket(data.settings.level3Threshold)];
  if (!stats || !group) return null;
  return `비슷한 목표의 사람들 : 지난주 평균 ${formatDays(group.avgKeptDays)}일 지킴${stats.demo ? DEMO_TAG : ""}`;
}

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 서비스(시트)에 넘길 시간대별 10명 중 몇 명 (정책표 compare). */
export function sheetCompare(stats: CompareStats | null): { demo: boolean; short: (number | null)[]; exit: (number | null)[] } | null {
  if (!stats) return null;
  return {
    demo: stats.demo,
    short: stats.byHour.map((h) => (h ? outOfTen(h.shortRate) : null)),
    exit: stats.byHour.map((h) => (h ? outOfTen(h.exitRate) : null)),
  };
}
