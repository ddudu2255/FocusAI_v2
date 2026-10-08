/**
 * AI 개인화 (폰 안에서만 계산, 서버·유료 API 없음).
 *
 * 1. 방식·문구 고르기: 문맥(강도 × 시간대 × 평일/주말)별 톰슨 샘플링 밴딧.
 *    여기서는 지난 기록으로 각 팔(arm)의 Beta(α, β)를 계산해 정책표에 넣고,
 *    실제 뽑기는 개입 순간 서비스(GuardBandit.java)가 한다.
 * 2. 위험 시간대: 시간대별 평균 시청과 연장·초과 횟수로 "평소 오래 보는 시간"을 찾는다.
 * 3. 주간 목표 제안: 지난주 목표를 지킨 날이 5일 이상이면 2~5분 줄이자고 제안 (최종 목표에서 멈춤).
 *
 * 학습 개선(v0.9.1, 설정 banditV2, 정책 버전 ai-2). 끄면 v0.9.0(ai-1)과 같은 계산.
 *   - 칸 사이 공유: 기록이 적은 칸은 비슷한 칸의 경험으로 시작한다 (한 사람 안의 계층 사전분포).
 *   - 최근 가중치: 오래된 기록일수록 무게가 작다 (반감기 7일).
 *   - 세밀한 보상: 개입 뒤 30분 동안 실제로 더 본 시간으로 점수를 매긴다.
 *   - 평일/주말 구분: 칸을 나누되, 빈 주말 칸은 평일 같은 시간대에서 가장 많이 빌려 온다.
 *   - 질림 반영: 최근에 나온 방식은 잠깐 덜 고른다 (서비스가 뽑을 때 적용, 정책표의 habituation).
 *
 * 원칙: 강도 단계는 규칙 그대로. AI는 방식·문구·세부 수치·제안만 바꾼다. 잠금은 사람이 확정.
 */
import { hourlyUsage, lastDates, todayKey, usageSecondsOn } from "./logic.ts";
import type { AppData, InterventionLog, UsageLog } from "./types.ts";

/** 밴딧이 보는 기록 기간 */
export const BANDIT_WINDOW_DAYS = 30;
/**
 * 칸 사이 공유: 다른 칸 경험을 최대 이만큼의 기록 무게로 빌려 온다.
 * 4면 자기 칸 기록이 몇 개만 쌓여도 자기 기록 쪽으로 기운다 (빈 칸만 많이 돕는다).
 */
export const BANDIT_SHARE_K = 4;
/** 최근 가중치: 이 날수가 지난 기록은 무게가 절반 (2배 지나면 4분의 1). */
export const BANDIT_HALF_LIFE_DAYS = 7;
/**
 * 빌려 올 때 칸이 얼마나 비슷한지. 다른 점마다 곱한다.
 * 평일↔주말만 다르면 0.8 (가장 비슷), 시간대가 다르면 0.5, 강도가 다르면 0.5.
 */
export const SIMILARITY = { day: 0.8, slot: 0.5, band: 0.5 } as const;
/** 세밀한 보상: 개입 뒤 이 시간 동안 본 쇼츠를 센다. */
export const REWARD_WINDOW_MINUTES = 30;
/** 세밀한 보상: 개입 뒤 이만큼 이상 봤으면 0점. 3분 약속을 지키면 0.8점. */
export const REWARD_WATCH_CAP_MINUTES = 15;
/**
 * 질림 반영 (서비스가 뽑을 때): 방금 나온 방식은 뽑은 값이 strength만큼 줄고,
 * recoveryHours마다 그 감소가 절반씩 회복된다.
 */
export const HABITUATION = { strength: 0.3, recoveryHours: 6 } as const;
/** 방식 밴딧의 강도: 가벼움 1, 중간 2. 강함 단계는 방식을 고르지 않는다. */
const METHOD_BANDS = [1, 2];
/** 위험 시간대·평균을 계산할 기간 */
export const RISK_WINDOW_DAYS = 14;
/** 위험 시간대를 찾으려면 이만큼의 날 기록이 있어야 한다 */
export const MIN_DAYS_FOR_RISK = 5;

export type TimeSlot = "morning" | "day" | "evening" | "night";
export type DayType = "weekday" | "weekend";

const SLOTS: TimeSlot[] = ["morning", "day", "evening", "night"];
const DAY_TYPES: DayType[] = ["weekday", "weekend"];

/** 아침 5~11시, 낮 11~17시, 저녁 17~22시, 밤 22~5시 */
export function timeSlot(hour: number): TimeSlot {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** 토·일은 주말 (기기 로컬 날짜 기준, 서비스의 GuardPolicy.dayType과 같다). */
export function dayType(date: Date): DayType {
  const d = date.getDay();
  return d === 0 || d === 6 ? "weekend" : "weekday";
}

const STOP_OUTCOMES = new Set(["exit", "kept", "day-end", "timed-block", "force-quit"]);

/**
 * v0.9.0 보상: 스스로 멈췄으면 1, 그 뒤 30분 안에 다시 열었으면 0.5, 계속 봤으면 0.
 * "도움 안 됐어요" 피드백이 있으면 절반.
 */
export function reward(log: InterventionLog): number {
  let r = STOP_OUTCOMES.has(log.outcome) ? 1 : 0;
  if (r > 0 && log.reenteredWithin30 === true) r = 0.5;
  if (log.feedback === "not") r *= 0.5;
  return r;
}

/** [start, end) 구간에 겹치는 쇼츠 시청 초. 연습 기록은 뺀다. */
export function watchedSecondsBetween(sessions: UsageLog[], start: number, end: number): number {
  let total = 0;
  for (const s of sessions) {
    if (s.target === "practice") continue;
    const from = Math.max(start, new Date(s.startTime).getTime());
    const to = Math.min(end, new Date(s.endTime).getTime());
    if (to > from) total += (to - from) / 1000;
  }
  return total;
}

/**
 * 세밀한 보상 (v0.9.1): 개입 뒤 30분 동안 실제로 더 본 시간으로 매긴다.
 *   1 − (더 본 분 ÷ 15), 0~1. 바로 나가면 1, 3분 약속을 지키면 0.8, 15분 넘게 보면 0.
 * 다시 들어와 본 시간도 함께 세므로 "30분 안 재방문" 규칙을 자연스럽게 포함한다.
 * "도움 안 됐어요" 피드백이 있으면 절반.
 */
export function gradedReward(log: InterventionLog, sessions: UsageLog[]): number {
  const at = new Date(log.timestamp).getTime();
  const watched = watchedSecondsBetween(sessions, at, at + REWARD_WINDOW_MINUTES * 60_000);
  let r = Math.max(0, 1 - watched / (REWARD_WATCH_CAP_MINUTES * 60));
  if (log.feedback === "not") r *= 0.5;
  return r;
}

/** 칸 → 선택지 → [α, β]. 서비스로 넘기는 정책표 형식. */
export type BetaTable = Record<string, Record<string, [number, number]>>;
/** 칸 → 선택지 → [성공, 실패]. 그 칸에서 직접 쌓인 기록만 (최근 가중치 반영). */
export type CountTable = Record<string, Record<string, [number, number]>>;

function addCount(table: CountTable, context: string, arm: string, r: number, weight: number) {
  const row = (table[context] ??= {});
  const [s, f] = row[arm] ?? [0, 0];
  row[arm] = [s + weight * r, f + weight * (1 - r)];
}

/** 자기 기록만으로 만든 Beta(1 + 성공, 1 + 실패). v0.9.0 계산과 같다. */
function ownPosteriors(counts: CountTable): BetaTable {
  const out: BetaTable = {};
  for (const [context, arms] of Object.entries(counts)) {
    out[context] = {};
    for (const [arm, [s, f]] of Object.entries(arms)) out[context][arm] = [1 + s, 1 + f];
  }
  return out;
}

/**
 * 두 칸이 얼마나 비슷한지 (0~1). 칸 이름은 "강도:시간대:평일주말" 또는 "시간대:평일주말".
 * 앞쪽부터 맞춰 보므로 두 형식 모두 쓸 수 있다.
 */
export function similarity(a: string, b: string): number {
  const pa = a.split(":");
  const pb = b.split(":");
  const withBand = pa.length === 3;
  const [bandA, slotA, dayA] = withBand ? pa : ["", pa[0], pa[1]];
  const [bandB, slotB, dayB] = withBand ? pb : ["", pb[0], pb[1]];
  let w = 1;
  if (bandA !== bandB) w *= SIMILARITY.band;
  if (slotA !== slotB) w *= SIMILARITY.slot;
  if (dayA !== dayB) w *= SIMILARITY.day;
  return w;
}

/**
 * 칸 사이 공유 (한 사람 안의 계층 사전분포).
 * 칸 c, 선택지 a: 다른 칸들의 성공 S, 실패 F를 비슷한 정도로 곱해 더한다 (c 자신은 빼서 이중 계산 방지).
 *   n = S + F, p = (S + 1) / (n + 2), k = min(K, n)
 *   α = 1 + k·p + (c의 성공), β = 1 + k·(1 − p) + (c의 실패)
 * 다른 칸 기록이 없으면 k = 0이라 자기 기록만 쓴 것과 같다.
 */
function sharedPosteriors(counts: CountTable, contexts: string[], k: number): BetaTable {
  const arms = new Set<string>();
  for (const row of Object.values(counts)) for (const arm of Object.keys(row)) arms.add(arm);
  const out: BetaTable = {};
  const all = [...new Set([...contexts, ...Object.keys(counts)])];
  for (const context of all) {
    for (const arm of arms) {
      let otherS = 0;
      let otherF = 0;
      for (const [other, row] of Object.entries(counts)) {
        if (other === context || !row[arm]) continue;
        const w = similarity(context, other);
        otherS += w * row[arm][0];
        otherF += w * row[arm][1];
      }
      const [s, f] = counts[context]?.[arm] ?? [0, 0];
      const n = otherS + otherF;
      const p = (otherS + 1) / (n + 2);
      const borrow = Math.min(k, n);
      (out[context] ??= {})[arm] = [1 + borrow * p + s, 1 + borrow * (1 - p) + f];
    }
  }
  return out;
}

export type BanditOptions = {
  /** 학습 개선(공유, 최근 가중치, 세밀한 보상, 평일/주말). 기본은 설정(banditV2)을 따른다. */
  v2?: boolean;
  k?: number;
  halfLifeDays?: number;
};

/**
 * 지난 30일 시트 기록으로 Beta 사후분포를 만든다.
 * 학습 개선을 끄면 v0.9.0과 같다: 칸은 "강도:시간대"·"시간대", 사전분포 Beta(1, 1),
 * 모든 기록 같은 무게, 보상은 reward(), 기록 없는 팔은 표에 없음 (서비스가 Beta(1, 1)로 본다).
 * 켜면 칸은 "강도:시간대:평일주말"·"시간대:평일주말", 보상은 gradedReward(), 최근 가중치와 공유를 쓴다.
 * ownMethods, ownFramings는 그 칸에서 직접 쌓인 [성공, 실패]로, AI 패널 설명용이다.
 */
export function banditTables(
  data: AppData,
  now = new Date(),
  options: BanditOptions = {},
): {
  methods: BetaTable;
  framings: BetaTable;
  ownMethods: CountTable;
  ownFramings: CountTable;
  samples: number;
  v2: boolean;
} {
  const v2 = options.v2 ?? data.settings.banditV2 !== false;
  const k = options.k ?? BANDIT_SHARE_K;
  const halfLife = options.halfLifeDays ?? BANDIT_HALF_LIFE_DAYS;
  const nowMs = now.getTime();
  const since = nowMs - BANDIT_WINDOW_DAYS * 86_400_000;
  // 세밀한 보상에 쓸 시청 기록 (창 안의 것만)
  const sessions = v2
    ? data.usageLogs.filter((s) => new Date(s.endTime).getTime() >= since)
    : [];
  const ownMethods: CountTable = {};
  const ownFramings: CountTable = {};
  let samples = 0;
  for (const log of data.interventions) {
    if (log.stage !== "entry" && log.stage !== "commit_end") continue;
    const at = new Date(log.timestamp);
    const atMs = at.getTime();
    if (atMs < since || atMs > nowMs) continue;
    let r: number;
    if (v2) {
      // 개입 뒤 30분이 지나야 점수가 정해진다.
      if (nowMs - atMs < REWARD_WINDOW_MINUTES * 60_000) continue;
      r = gradedReward(log, sessions);
    } else {
      // 시청 결과가 아직 정해지지 않은 최근 30분 기록은 재진입 판정 전이라 뺀다.
      if (STOP_OUTCOMES.has(log.outcome) && log.reenteredWithin30 === null) continue;
      r = reward(log);
    }
    const weight = v2 ? Math.pow(0.5, (nowMs - atMs) / 86_400_000 / halfLife) : 1;
    const slot = timeSlot(log.hour);
    const band = log.band ?? log.level;
    const suffix = v2 ? `:${dayType(at)}` : "";
    if (log.interventionType && log.stage === "entry") {
      addCount(ownMethods, `${band}:${slot}${suffix}`, log.interventionType, r, weight);
      samples += 1;
    }
    if (log.framing) addCount(ownFramings, `${slot}${suffix}`, log.framing, r, weight);
  }
  if (!v2) {
    return {
      methods: ownPosteriors(ownMethods),
      framings: ownPosteriors(ownFramings),
      ownMethods,
      ownFramings,
      samples,
      v2,
    };
  }
  const framingContexts = SLOTS.flatMap((slot) => DAY_TYPES.map((day) => `${slot}:${day}`));
  const methodContexts = METHOD_BANDS.flatMap((band) => framingContexts.map((c) => `${band}:${c}`));
  return {
    methods: sharedPosteriors(ownMethods, methodContexts, k),
    framings: sharedPosteriors(ownFramings, framingContexts, k),
    ownMethods,
    ownFramings,
    samples,
    v2,
  };
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
