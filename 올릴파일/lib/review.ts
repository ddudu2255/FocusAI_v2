import {
  dayRange,
  firstRecordDate,
  goalMinutesOn,
  hourlyUsage,
  lastDates,
  SELF_STOP_OUTCOMES,
  todayKey,
  usageSecondsOn,
} from "./logic.ts";
import type { AppData, InterventionLog } from "./types.ts";

/**
 * 통계·리포트 화면에 쓰는 계산 (v0.13).
 * 홈은 "지금", 통계는 "지난 기록", 리포트는 "하루 해석"을 보여 주고 같은 정보를 겹쳐 싣지 않는다.
 */

export type WeekDay = {
  date: string;
  seconds: number;
  goalMinutes: number;
  /** kept 목표 안, over 넘음, before 기록이 생기기 전 (세지 않음) */
  state: "kept" | "over" | "before";
};

export function weekSeries(data: AppData, now = new Date()): WeekDay[] {
  const first = firstRecordDate(data) ?? todayKey(now);
  return lastDates(7, now).map((date) => {
    const seconds = usageSecondsOn(data, date);
    const goalMinutes = goalMinutesOn(data, date);
    const state = date < first ? "before" : seconds > goalMinutes * 60 ? "over" : "kept";
    return { date, seconds, goalMinutes, state };
  });
}

/** 기록이 생긴 뒤의 날만 센 하루 평균(초)과 지킨 날 수. */
export function weekSummary(days: WeekDay[]): { avgSeconds: number; kept: number; counted: number } {
  const counted = days.filter((d) => d.state !== "before");
  const total = counted.reduce((sum, d) => sum + d.seconds, 0);
  return {
    avgSeconds: counted.length > 0 ? total / counted.length : 0,
    kept: counted.filter((d) => d.state === "kept").length,
    counted: counted.length,
  };
}

export const METHOD_LABEL: Record<string, string> = {
  pause: "5초 숨 고르기",
  framing: "시간 바꿔 말하기",
  breath: "호흡 따라 하기",
  alternative: "대체행동",
  reflection: "성찰 질문",
  card: "공부 카드",
  warning: "경고",
  commit_end: "약속 시간 끝",
  strong: "마무리 선택",
  locked: "잠금",
  pip: "나가기 후 작은 창으로 계속 봄",
};

/** 개입 기록 한 줄의 결과 표시. good = 스스로 멈춘 쪽. */
export const RESULT_CHIP: Record<string, { label: string; good: boolean }> = {
  exit: { label: "나감", good: true },
  kept: { label: "약속 지킴", good: true },
  "day-end": { label: "오늘은 끝", good: true },
  "timed-block": { label: "잠금", good: true },
  "force-quit": { label: "앱 닫음", good: true },
  watch: { label: "계속 봄", good: false },
  extend: { label: "연장", good: false },
  overdraft: { label: "목표 초과", good: false },
  "budget-out": { label: "목표 소진", good: false },
  interrupted: { label: "중단", good: false },
  "blocked-retry": { label: "잠금 중 열기", good: false },
};

const STOPPED = new Set<string>(SELF_STOP_OUTCOMES);

/** 개입 뒤 스스로 멈췄는지 (나가기, 약속 지킴, 오늘은 끝, 시간 잠금, 강제 종료). */
export function stoppedAfter(log: Pick<InterventionLog, "outcome">): boolean {
  return STOPPED.has(log.outcome);
}

export type Timeline = {
  /** 하루 0~100% 위치의 시청 구간 */
  sessions: { id: string; left: number; width: number }[];
  marks: { id: string; left: number; stopped: boolean }[];
};

export function dayTimeline(data: AppData, date: string): Timeline {
  const [start, end] = dayRange(date);
  const span = end - start;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));
  const sessions = data.usageLogs.flatMap((log) => {
    const from = new Date(log.startTime).getTime();
    const to = new Date(log.endTime).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= start || from >= end) return [];
    const left = pct(from);
    // 아주 짧은 시청도 보이게 최소 폭을 둔다.
    return [{ id: log.usageId, left, width: Math.max(0.8, pct(to) - left) }];
  });
  const marks = data.interventions
    .filter((log) => log.date === date)
    .map((log) => ({ id: log.interventionId, left: pct(new Date(log.timestamp).getTime()), stopped: stoppedAfter(log) }));
  return { sessions, marks };
}

/** 가장 많이 본 시(0~23). 1분 미만이면 null. */
export function peakHour(hours: number[]): number | null {
  let best = -1;
  hours.forEach((seconds, hour) => {
    if (seconds >= 60 && (best < 0 || seconds > hours[best])) best = hour;
  });
  return best < 0 ? null : best;
}

export function hourLabel(hour: number): string {
  if (hour < 6) return `새벽 ${hour}시`;
  if (hour < 12) return `오전 ${hour}시`;
  if (hour === 12) return "낮 12시";
  if (hour < 18) return `오후 ${hour - 12}시`;
  if (hour < 21) return `저녁 ${hour - 12}시`;
  return `밤 ${hour - 12}시`;
}

export type MethodResult = { type: string; total: number; stopped: number };

/** 개입 방식별로 몇 번 나왔고 몇 번 멈췄는지. 다시 열기 차단 기록은 뺀다. */
export function methodResults(logs: InterventionLog[]): MethodResult[] {
  const map = new Map<string, MethodResult>();
  for (const log of logs) {
    if (log.outcome === "blocked-retry") continue;
    const row = map.get(log.interventionType) ?? { type: log.interventionType, total: 0, stopped: 0 };
    row.total += 1;
    if (stoppedAfter(log)) row.stopped += 1;
    map.set(log.interventionType, row);
  }
  return [...map.values()];
}

/** 오늘 잘 통한 방법: 멈춘 비율이 가장 높은 방식 (같으면 더 많이 멈춘 쪽). */
export function bestMethod(results: MethodResult[]): MethodResult | null {
  const good = results.filter((r) => r.stopped > 0);
  good.sort((a, b) => b.stopped / b.total - a.stopped / a.total || b.stopped - a.stopped);
  return good[0] ?? null;
}

/** 덜 통한 방법: 2번 이상 나왔고 절반 넘게 계속 본 방식. */
export function weakMethod(results: MethodResult[], best: MethodResult | null): MethodResult | null {
  const weak = results.filter((r) => r.type !== best?.type && r.total >= 2 && r.stopped / r.total < 0.5);
  weak.sort((a, b) => a.stopped / a.total - b.stopped / b.total || b.total - a.total);
  return weak[0] ?? null;
}

/** 오늘 전 최근 7일 중 기록이 생긴 뒤의 날들. 3일 미만이면 평소를 말하지 않는다. */
export function usualDays(data: AppData, now = new Date()): string[] {
  const first = firstRecordDate(data);
  if (!first) return [];
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return lastDates(7, yesterday).filter((date) => date >= first);
}

export const USUAL_MIN_DAYS = 3;

export type Difference = { text: string; detail: string };

const minutes = (seconds: number) => Math.round(seconds / 60);

/** 리포트 "평소와 달랐던 점". 차이가 뚜렷할 때만, 최대 3줄. */
export function usualDifferences(data: AppData, now = new Date()): Difference[] {
  const days = usualDays(data, now);
  if (days.length < USUAL_MIN_DAYS) return [];
  const today = todayKey(now);
  const out: Difference[] = [];

  const night = (date: string) => hourlyUsage(data, date).slice(21).reduce((a, b) => a + b, 0);
  const nightToday = night(today);
  const nightUsual = days.reduce((sum, d) => sum + night(d), 0) / days.length;
  if (nightUsual >= 5 * 60 && nightToday <= nightUsual * 0.6) {
    out.push({ text: "밤 시청이 짧았어요", detail: `${minutes(nightToday)}분 (평소 ${minutes(nightUsual)}분)` });
  } else if (nightToday >= 5 * 60 && nightToday >= Math.max(nightUsual * 1.5, nightUsual + 5 * 60)) {
    out.push({ text: "밤 시청이 길었어요", detail: `${minutes(nightToday)}분 (평소 ${minutes(nightUsual)}분)` });
  }

  const reopen = (date: string) =>
    data.interventions.filter((log) => log.date === date && log.reenteredWithin30 === true).length;
  const reopenUsual = days.reduce((sum, d) => sum + reopen(d), 0) / days.length;
  const reopenToday = reopen(today);
  if (reopenUsual >= 1 && reopenToday <= reopenUsual / 2) {
    out.push({ text: "다시 열기가 줄었어요", detail: `${reopenToday}번 (평소 ${Math.round(reopenUsual)}번)` });
  }

  const blocks = data.interventions.filter((log) => log.date === today && log.outcome === "timed-block");
  if (blocks.length > 0) {
    const rest = blocks.reduce((sum, log) => sum + log.blockDuration, 0);
    out.push({ text: "잠금을 스스로 걸었어요", detail: `${rest}분 쉼` });
  }
  return out.slice(0, 3);
}

/** 최근 14일 동안 위험 높음으로 본 열기가 가장 많았던 시. 3번 미만이면 null. */
export function riskyHour(data: AppData, now = new Date()): number | null {
  const since = new Date(now);
  since.setDate(now.getDate() - 14);
  const counts = new Array<number>(24).fill(0);
  for (const open of data.openLogs) {
    const at = new Date(open.createdAt);
    if (open.band !== "high" || Number.isNaN(at.getTime()) || at < since) continue;
    counts[at.getHours()] += 1;
  }
  let best = -1;
  counts.forEach((count, hour) => {
    if (count >= 3 && (best < 0 || count > counts[best])) best = hour;
  });
  return best < 0 ? null : best;
}
