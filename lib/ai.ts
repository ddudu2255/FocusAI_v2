/**
 * AI 개인화 (폰 안에서만 계산, 서버·유료 API 없음).
 *
 * 1. 방식·문구 고르기: 문맥(강도 × 시간대)별 톰슨 샘플링 밴딧.
 *    여기서는 지난 기록으로 각 팔(arm)의 Beta(α, β)를 계산해 정책표에 넣고,
 *    실제 뽑기는 개입 순간 서비스(GuardBandit.java)가 한다.
 * 2. 위험 시간대: 시간대별 평균 시청과 연장·초과 횟수로 "평소 오래 보는 시간"을 찾는다.
 * 3. 주간 목표 제안: 지난주 목표를 지킨 날이 5일 이상이면 2~5분 줄이자고 제안 (최종 목표에서 멈춤).
 *
 * 원칙: 강도 단계는 규칙 그대로. AI는 방식·문구·세부 수치·제안만 바꾼다. 잠금은 사람이 확정.
 */
import { hourlyUsage, lastDates, todayKey, usageSecondsOn } from "./logic.ts";
import type { AppData, InterventionLog } from "./types.ts";

/** 밴딧이 보는 기록 기간 */
export const BANDIT_WINDOW_DAYS = 30;
/** 위험 시간대·평균을 계산할 기간 */
export const RISK_WINDOW_DAYS = 14;
/** 위험 시간대를 찾으려면 이만큼의 날 기록이 있어야 한다 */
export const MIN_DAYS_FOR_RISK = 5;

export type TimeSlot = "morning" | "day" | "evening" | "night";

/** 아침 5~11시, 낮 11~17시, 저녁 17~22시, 밤 22~5시 */
export function timeSlot(hour: number): TimeSlot {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const STOP_OUTCOMES = new Set(["exit", "kept", "day-end", "timed-block", "force-quit"]);

/**
 * 보상: 스스로 멈췄으면 1, 그 뒤 30분 안에 다시 열었으면 0.5, 계속 봤으면 0.
 * "도움 안 됐어요" 피드백이 있으면 절반.
 */
export function reward(log: InterventionLog): number {
  let r = STOP_OUTCOMES.has(log.outcome) ? 1 : 0;
  if (r > 0 && log.reenteredWithin30 === true) r = 0.5;
  if (log.feedback === "not") r *= 0.5;
  return r;
}

export type BetaTable = Record<string, Record<string, [number, number]>>;

function addArm(table: BetaTable, context: string, arm: string, r: number) {
  const row = (table[context] ??= {});
  const [a, b] = row[arm] ?? [1, 1];
  row[arm] = [a + r, b + (1 - r)];
}

/**
 * 지난 30일 시트 기록으로 Beta 사후분포를 만든다.
 * methods: "강도:시간대" → 방식별 [α, β], framings: "시간대" → 문구 종류별 [α, β].
 * 사전분포는 Beta(1, 1). 기록이 없는 팔은 표에 없고, 서비스가 Beta(1, 1)로 본다.
 */
export function banditTables(
  data: AppData,
  now = new Date(),
): { methods: BetaTable; framings: BetaTable; samples: number } {
  const since = now.getTime() - BANDIT_WINDOW_DAYS * 86_400_000;
  const methods: BetaTable = {};
  const framings: BetaTable = {};
  let samples = 0;
  for (const log of data.interventions) {
    if (log.stage !== "entry" && log.stage !== "commit_end") continue;
    const at = new Date(log.timestamp);
    if (at.getTime() < since || at.getTime() > now.getTime()) continue;
    // 시청 결과가 아직 정해지지 않은 최근 30분 기록은 재진입 판정 전이라 뺀다.
    if (STOP_OUTCOMES.has(log.outcome) && log.reenteredWithin30 === null) continue;
    const r = reward(log);
    const slot = timeSlot(log.hour);
    const band = log.band ?? log.level;
    if (log.interventionType && log.stage === "entry") {
      addArm(methods, `${band}:${slot}`, log.interventionType, r);
      samples += 1;
    }
    if (log.framing) addArm(framings, slot, log.framing, r);
  }
  return { methods, framings, samples };
}

/** 지난 14일 중 기록이 있는 날 수 */
export function recordedDays(data: AppData, now = new Date()): number {
  const days = new Set(data.usageLogs.map((log) => log.date));
  return lastDates(RISK_WINDOW_DAYS, now).filter((d) => days.has(d) && d !== todayKey(now)).length;
}

export type RiskInfo = {
  /** 평소 오래 보는 시간 (0~23시), 가장 이른 시간부터 */
  hours: number[];
  /** 그 시간대 평균 시청 초 (하루 기준) */
  avgSeconds: number;
  /** 연장·초과를 고른 비율 (그 시간대 개입 중) */
  extendRate: number;
};

/**
 * 위험 시간대: 지난 14일(오늘 제외) 시간대별 평균 시청이 5분 이상이고,
 * 하루 평균 시간대 시청의 1.5배 이상인 시간 중 상위 3개.
 * 기록이 5일보다 적으면 없음.
 */
export function riskHours(data: AppData, now = new Date()): RiskInfo | null {
  const days = lastDates(RISK_WINDOW_DAYS + 1, now).slice(0, RISK_WINDOW_DAYS);
  const recorded = new Set(data.usageLogs.map((log) => log.date));
  const usedDays = days.filter((d) => recorded.has(d));
  if (usedDays.length < MIN_DAYS_FOR_RISK) return null;
  const totals = new Array<number>(24).fill(0);
  for (const day of usedDays) {
    hourlyUsage(data, day).forEach((v, h) => {
      totals[h] += v;
    });
  }
  const avg = totals.map((v) => v / usedDays.length);
  const active = avg.filter((v) => v > 0);
  if (active.length === 0) return null;
  const mean = active.reduce((s, v) => s + v, 0) / active.length;
  const hours = avg
    .map((v, h) => ({ v, h }))
    .filter(({ v }) => v >= 300 && v >= mean * 1.5)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(({ h }) => h)
    .sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const since = now.getTime() - RISK_WINDOW_DAYS * 86_400_000;
  const inRisk = data.interventions.filter(
    (log) => hours.includes(log.hour) && new Date(log.timestamp).getTime() >= since,
  );
  const extend = inRisk.filter((log) => log.outcome === "extend" || log.outcome === "overdraft").length;
  return {
    hours,
    avgSeconds: hours.reduce((s, h) => s + avg[h], 0) / hours.length,
    extendRate: inRisk.length === 0 ? 0 : extend / inRisk.length,
  };
}

/** "밤 11시", "저녁 9시", "오후 2시" 같은 말 */
export function hourLabel(hour: number): string {
  if (hour === 0) return "밤 12시";
  if (hour < 5) return `새벽 ${hour}시`;
  if (hour < 12) return `오전 ${hour}시`;
  if (hour === 12) return "낮 12시";
  if (hour < 18) return `오후 ${hour - 12}시`;
  if (hour < 21) return `저녁 ${hour - 12}시`;
  return `밤 ${hour - 12}시`;
}

/** 이번 주 월요일 날짜 (주간 제안을 한 주에 한 번만 보이려고) */
export function weekKey(now = new Date()): string {
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return todayKey(monday);
}

export type GoalSuggestion = {
  week: string;
  current: number;
  suggested: number;
  keptDays: number;
  /** true면 줄이기 제안, false면 최종 목표에 닿아 유지 */
  reduce: boolean;
};

/**
 * 주간 목표 제안. 지난주(월~일) 중 기록이 있는 날 가운데 목표 안에서 끝낸 날이 5일 이상이면
 * 목표를 2~5분 줄이자고 제안한다. 최종 목표(바닥 5분)에 닿으면 유지 단계로 본다.
 * 지난주를 못 지켰으면 제안하지 않는다 (실패 뒤에 더 조이지 않는다).
 */
export function goalSuggestion(data: AppData, now = new Date()): GoalSuggestion | null {
  const week = weekKey(now);
  const [y, m, d] = week.split("-").map(Number);
  const lastSunday = new Date(y, m - 1, d - 1);
  const lastWeek = lastDates(7, lastSunday);
  const recorded = new Set(data.usageLogs.map((log) => log.date));
  const goal = data.settings.level3Threshold;
  const keptDays = lastWeek.filter(
    (day) => recorded.has(day) && usageSecondsOn(data, day) <= goal * 60,
  ).length;
  if (keptDays < 5) return null;
  const floor = Math.max(5, Math.min(data.settings.finalGoal, goal));
  if (goal <= floor) return { week, current: goal, suggested: goal, keptDays, reduce: false };
  const step = goal >= 30 ? 5 : goal >= 15 ? 3 : 2;
  return { week, current: goal, suggested: Math.max(floor, goal - step), keptDays, reduce: true };
}
