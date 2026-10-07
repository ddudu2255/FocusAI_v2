import type {
  AppData,
  Band,
  DailyStats,
  InterventionInput,
  InterventionLog,
  InterventionType,
  Level,
  LockAttempt,
  NativeBatch,
  SessionTarget,
  Settings,
  UsageLog,
} from "./types.ts";

export const REASONS: { id: string; hint: string }[] = [
  { id: "심심해서", hint: "특별한 목적 없이 시간을 보내려고" },
  { id: "습관적으로", hint: "별다른 생각 없이 반복해서" },
  { id: "잠깐 보려고", hint: "짧은 시간만 이용하려고" },
  { id: "스트레스 해소를 위해", hint: "기분 전환이나 휴식을 위해" },
  { id: "특별한 이유 없이", hint: "명확한 실행 목적이 없어서" },
  { id: "기타", hint: "위 항목에 해당하지 않는 경우" },
];

export type Alternative = {
  id: string;
  label: string;
  seconds: number;
  guide: string;
};

export const ALTERNATIVES: Alternative[] = [
  {
    id: "water",
    label: "물 마시기",
    seconds: 20,
    guide: "자리에서 일어나 물 한 잔을 마시고 오세요.",
  },
  {
    id: "stretch",
    label: "간단한 스트레칭",
    seconds: 30,
    guide: "어깨를 천천히 돌리고, 목을 좌우로 기울여 보세요.",
  },
  {
    id: "read",
    label: "5분 독서",
    seconds: 60,
    guide:
      "손에 잡히는 글에서 한 단락만 읽으세요. 브라우저 안내 시간은 1분입니다.",
  },
  {
    id: "walk",
    label: "잠시 걷기",
    seconds: 45,
    guide: "방 안이라도 열 걸음만 걸어 보세요.",
  },
  {
    id: "eyes",
    label: "눈 쉬기",
    seconds: 20,
    guide: "화면에서 눈을 떼고, 멀리 있는 한 점을 바라보세요.",
  },
  {
    id: "breath",
    label: "호흡하기",
    seconds: 30,
    guide: "넷을 들이쉬고, 넷을 멈추고, 여섯을 내쉬세요.",
  },
];

const REASON_ALT: Record<string, string> = {
  심심해서: "잠시 걷기",
  습관적으로: "호흡하기",
  "잠깐 보려고": "눈 쉬기",
  "스트레스 해소를 위해": "간단한 스트레칭",
  "특별한 이유 없이": "물 마시기",
  기타: "호흡하기",
};

export const LEVEL_SUMMARY: Record<Level, string> = {
  1: "가벼움 · 이유와 시청 약속",
  2: "중간 · 멈추는 활동 하나 거치기",
  3: "강함 · 오늘 마무리 선택",
};

export const BAND_LABEL: Record<Band, string> = {
  1: "가벼움",
  2: "중간",
  3: "강함",
};

export const TARGET_LABEL: Record<SessionTarget, string> = {
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
  practice: "연습 피드",
};

export const OUTCOME_LABEL = {
  exit: "나가기",
  watch: "시청함",
  "force-quit": "강제 종료",
  "timed-block": "시간 잠금",
  "blocked-retry": "차단 중 다시 열기",
  kept: "약속 지킴",
  extend: "약속 연장",
  "day-end": "오늘은 끝",
  overdraft: "목표 초과 3분",
  "budget-out": "목표 소진",
  interrupted: "중단",
} as const;

/** 스스로 멈춘 결과. 리포트 첫 줄 "스스로 멈춘 횟수"에 센다. */
export const SELF_STOP_OUTCOMES = ["exit", "kept", "day-end", "timed-block", "force-quit"] as const;

/** 시청으로 이어진 결과. 30분 재진입 판정에서 뺀다. */
const WATCH_OUTCOMES = ["watch", "extend", "overdraft", "budget-out", "interrupted"];

export const BLOCK_MINUTES = [10, 20, 30, 60] as const;

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatKoreanDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const week = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
  return `${y}년 ${m}월 ${d}일 (${week})`;
}

export function formatShortDate(dateKey: string, today = todayKey()): string {
  if (dateKey === today) return "오늘";
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0 && seconds === 0) return `${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

export function formatReportDuration(totalSeconds: number): string {
  return formatClock(totalSeconds);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 오늘 목표(분) 대비 사용 비율. */
export function goalRatio(seconds: number, settings: Settings): number {
  return seconds / (Math.max(1, settings.level3Threshold) * 60);
}

/** 강도: 목표의 50% 미만 가벼움, 100% 미만 중간, 이상 강함. 서비스의 GuardPolicy.band와 같다. */
export function levelForUsage(seconds: number, settings: Settings): Level {
  const ratio = goalRatio(seconds, settings);
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  return 3;
}

/**
 * 시트의 시간 체감 문구 종류 (S1). 사용자 확인을 거친 문구다. 바꿀 때는 먼저 상황별 표로 확인받는다.
 * android GuardCopy.insight()와 같은 문장, 같은 조건을 쓴다.
 */
export const FRAMINGS = [
  "guilt",
  "yesterday",
  "motivate",
  "weekly",
  "future",
  "average",
  "goal",
  "sleep",
] as const;

export type InsightFacts = {
  usage: number;
  goal: number;
  weekProjection: number;
  avg7: number;
  yesterdayByNow: number;
  sleepSeconds: number;
  sleepBasis: string;
};

/** 문장용 분 표시: "23분", "2시간 40분". */
export function minutesText(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours > 0 && rest > 0) return `${hours}시간 ${rest}분`;
  if (hours > 0) return `${hours}시간`;
  return `${total}분`;
}

/** 숫자가 없거나 의미가 없으면 null (그 문구는 건너뛴다). */
export function insightLine(kind: string, f: InsightFacts): string | null {
  if (f.usage < 60) return null;
  const remaining = Math.max(0, f.goal - f.usage);
  switch (kind) {
    case "guilt":
      return `오늘 쇼츠에 쓴 ${minutesText(f.usage)}, 다시 돌아오지 않아요.`;
    case "weekly":
      return f.weekProjection < 600
        ? null
        : `이 속도면 이번 주에 ${minutesText(f.weekProjection)}을 쇼츠에 써요.`;
    case "motivate":
      return remaining < 60
        ? null
        : `지금 멈추면 오늘 목표 안에서 끝낼 수 있어요. (${minutesText(remaining)} 남음)`;
    case "future":
      return `자기 전의 나는 오늘 이 ${minutesText(f.usage)}을 어떻게 생각할까요?`;
    case "yesterday":
      return f.yesterdayByNow < 0 || f.usage - f.yesterdayByNow < 60
        ? null
        : `어제 이 시간엔 ${minutesText(f.yesterdayByNow)}이었는데, 오늘은 벌써 ${minutesText(f.usage)}이에요.`;
    case "average":
      return f.avg7 <= 0 || f.usage - f.avg7 < 60
        ? null
        : `이번 주 평균보다 ${minutesText(f.usage - f.avg7)} 더 보고 있어요.`;
    case "goal":
      return f.usage >= f.goal ? null : `정한 ${minutesText(f.goal)} 중 ${minutesText(f.usage)}을 썼어요.`;
    case "sleep":
      return f.sleepSeconds < 600
        ? null
        : `지금 자면 ${minutesText(f.sleepSeconds)} 잘 수 있어요. 10분 더 보면 ${minutesText(f.sleepSeconds - 600)}이에요. (${f.sleepBasis})`;
    default:
      return null;
  }
}

/** 웹(홈 화면)에서 쓸 문구 재료. 서비스는 같은 값을 정책표 stats로 받아 직접 계산한다. */
export function insightFacts(data: AppData, now = new Date()): InsightFacts {
  const today = todayKey(now);
  const stats = usageStats(data, now);
  const usage = usageSecondsOn(data, today);
  const hour = now.getHours();
  let yesterdayByNow = -1;
  if (stats.yesterdayCumulative) {
    const before = hour === 0 ? 0 : stats.yesterdayCumulative[hour - 1];
    const end = stats.yesterdayCumulative[hour];
    yesterdayByNow = before + (end - before) * (now.getMinutes() / 60);
  }
  let sleepSeconds = -1;
  let sleepBasis = "";
  if (hour >= 22 || hour < 4) {
    const [wh, wm] = data.settings.wakeTime.split(":").map(Number);
    const wake = new Date(now);
    wake.setHours(wh, wm, 0, 0);
    if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
    sleepSeconds = (wake.getTime() - now.getTime()) / 1000;
    sleepBasis = `일어나는 시각 ${wh}:${String(wm).padStart(2, "0")} 기준`;
  }
  return {
    usage,
    goal: data.settings.level3Threshold * 60,
    weekProjection:
      stats.pastWeekSeconds < 0
        ? -1
        : ((stats.pastWeekSeconds + usage) / (stats.daysBeforeToday + 1)) * 7,
    avg7: stats.avg7Seconds,
    yesterdayByNow,
    sleepSeconds,
    sleepBasis,
  };
}

/**
 * 문구용 통계: 지난 7일 평균, 이번 주(월요일 시작) 오늘 전까지 합, 어제 시간대별 누적.
 * 기록이 없는 값은 -1 / null.
 */
export function usageStats(
  data: AppData,
  now = new Date(),
): {
  avg7Seconds: number;
  pastWeekSeconds: number;
  daysBeforeToday: number;
  yesterdayCumulative: number[] | null;
} {
  const days = lastDates(8, now).slice(0, 7); // 오늘 전 7일
  const firstRecord = data.usageLogs.reduce(
    (min, log) => (log.date < min ? log.date : min),
    todayKey(now),
  );
  const counted = days.filter((d) => d >= firstRecord);
  const avg7Seconds =
    counted.length === 0
      ? -1
      : counted.reduce((sum, d) => sum + usageSecondsOn(data, d), 0) / counted.length;
  const weekday = (now.getDay() + 6) % 7; // 월요일 = 0
  const weekDays = weekday === 0 ? [] : lastDates(weekday + 1, now).slice(0, weekday);
  const pastWeekSeconds =
    counted.length === 0 ? -1 : weekDays.reduce((sum, d) => sum + usageSecondsOn(data, d), 0);
  const yesterday = days[days.length - 1];
  const hours = hourlyUsage(data, yesterday);
  const hasYesterday = yesterday >= firstRecord && hours.some((v) => v > 0);
  let running = 0;
  const yesterdayCumulative = hasYesterday
    ? hours.map((v) => {
        running += v;
        return running;
      })
    : null;
  return { avg7Seconds, pastWeekSeconds, daysBeforeToday: weekday, yesterdayCumulative };
}

/** 시간 잠금으로 쉰 초 (그 날짜 몫, 지금까지 지난 만큼). "오늘은 끝"은 쉰 시간에 넣지 않는다. */
export function restSecondsOn(data: AppData, date: string, now = Date.now()): number {
  const [dayStart, dayEnd] = dayRange(date);
  return data.interventions
    .filter((log) => log.outcome === "timed-block" && log.blockDuration > 0)
    .reduce((sum, log) => {
      const start = new Date(log.timestamp).getTime();
      const end = Math.min(now, start + log.blockDuration * 60_000);
      const overlap = Math.min(end, dayEnd) - Math.max(start, dayStart);
      return overlap > 0 ? sum + overlap / 1000 : sum;
    }, 0);
}

/** 이 날까지 잠금이나 "오늘은 끝"을 고른 날이 연속된 수. 이 날에 없으면 전날부터 센다. */
export function lockStreak(data: AppData, date: string): number {
  const lockDays = new Set(
    data.interventions
      .filter((log) => log.outcome === "timed-block" || log.outcome === "day-end")
      .map((log) => log.date),
  );
  const [y, m, d] = date.split("-").map(Number);
  const cursor = new Date(y, m - 1, d);
  if (!lockDays.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (lockDays.has(todayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 오늘 시간대별(0~23시) 시청 초. 홈의 하루 막대에 쓴다. */
export function hourlyUsage(data: AppData, date: string): number[] {
  const hours = new Array<number>(24).fill(0);
  const [dayStart] = dayRange(date);
  for (const log of data.usageLogs) {
    const start = new Date(log.startTime).getTime();
    const end = new Date(log.endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const scale = log.duration / ((end - start) / 1000);
    for (let h = 0; h < 24; h += 1) {
      const from = dayStart + h * 3_600_000;
      const to = from + 3_600_000;
      const overlap = Math.min(end, to) - Math.max(start, from);
      if (overlap > 0) hours[h] += (overlap / 1000) * scale;
    }
  }
  return hours;
}

/** "오늘은 끝": 다음 {dayEndHour}시까지 남은 분. */
export function minutesUntilDayEnd(dayEndHour: number, now = new Date()): number {
  const end = new Date(now);
  end.setHours(dayEndHour, 0, 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return Math.ceil((end.getTime() - now.getTime()) / 60_000);
}

/** 로컬 날짜의 시작·끝 시각(ms). */
export function dayRange(date: string): [number, number] {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1).getTime();
  const end = new Date(y, (m || 1) - 1, (d || 1) + 1).getTime();
  return [start, end];
}

/**
 * 세션 중 그 날짜에 속한 초. 자정을 넘긴 세션은 걸친 시간 비율대로 나눈다.
 * 연습 피드처럼 duration이 벽시계 시간보다 짧으면 같은 비율로 줄인다.
 */
export function secondsOnDate(log: UsageLog, date: string): number {
  const start = new Date(log.startTime).getTime();
  const end = new Date(log.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return log.date === date ? log.duration : 0;
  }
  const [dayStart, dayEnd] = dayRange(date);
  const overlap = Math.min(end, dayEnd) - Math.max(start, dayStart);
  if (overlap <= 0) return 0;
  return log.duration * (overlap / (end - start));
}

export function usageSecondsOn(data: AppData, date: string): number {
  return data.usageLogs.reduce((sum, log) => sum + secondsOnDate(log, date), 0);
}

/** 웹이 직접 잰 초(연습 피드, 이관한 기록). 네이티브 세션은 서비스가 따로 센다. */
export function webSecondsOn(data: AppData, date: string): number {
  return data.usageLogs
    .filter((log) => log.source !== "native")
    .reduce((sum, log) => sum + secondsOnDate(log, date), 0);
}

export function nextLevelGap(
  seconds: number,
  settings: Settings,
): { label: string; remainSeconds: number } | null {
  const goal = settings.level3Threshold * 60;
  if (seconds < goal / 2) {
    return { label: "중간 강도까지", remainSeconds: goal / 2 - seconds };
  }
  if (seconds < goal) {
    return { label: "오늘 목표까지", remainSeconds: goal - seconds };
  }
  return null;
}

export function recommendAlternative(reason: string): Alternative {
  const label = REASON_ALT[reason] ?? "호흡하기";
  return ALTERNATIVES.find((item) => item.label === label) ?? ALTERNATIVES[5];
}

export function isBlocked(block: AppData["block"], now = Date.now()): boolean {
  if (!block.until) return false;
  return new Date(block.until).getTime() > now;
}

export function blockRemainingSeconds(
  block: AppData["block"],
  now = Date.now(),
): number {
  if (!block.until) return 0;
  return Math.max(0, (new Date(block.until).getTime() - now) / 1000);
}

export function blockUntilFromMinutes(minutes: number, now = Date.now()): string {
  const realMs = minutes * 60 * 1000;
  return new Date(now + realMs).toISOString();
}

export function isReportDue(
  notificationTime: string,
  now = new Date(),
): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(notificationTime);
  if (!match) return false;
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return now.getTime() >= target.getTime();
}

export function normalizeClock(value: string): string | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

export function validateSettings(input: {
  goal: number;
  finalGoal: number;
  dayEndHour: number;
  notificationTime: string;
  wakeTime?: string;
}): string | null {
  if (input.wakeTime !== undefined && !normalizeClock(input.wakeTime)) {
    return "일어나는 시각을 다시 확인해 주세요.";
  }
  if (!Number.isInteger(input.goal) || input.goal < 1 || input.goal > 360) {
    return "하루 목표는 1분에서 360분 사이의 정수여야 합니다.";
  }
  if (!Number.isInteger(input.finalGoal) || input.finalGoal < 1 || input.finalGoal > input.goal) {
    return "최종 목표는 1분 이상, 하루 목표 이하의 정수여야 합니다.";
  }
  if (!Number.isInteger(input.dayEndHour) || input.dayEndHour < 0 || input.dayEndHour > 12) {
    return "\"오늘은 끝\"이 풀리는 시각은 0시에서 12시 사이여야 합니다.";
  }
  if (!normalizeClock(input.notificationTime)) {
    return "알림 시각을 다시 확인해 주세요.";
  }
  return null;
}

export function lastDates(count: number, from = new Date()): string[] {
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(from);
    day.setDate(from.getDate() - i);
    dates.push(todayKey(day));
  }
  return dates;
}

export function statsForDate(data: AppData, date: string): DailyStats {
  const usage = data.usageLogs.filter((log) => log.date === date);
  const usageSeconds = usageSecondsOn(data, date);
  const interventions = data.interventions.filter((log) => log.date === date);
  const levelCounts: Record<Level, number> = { 1: 0, 2: 0, 3: 0 };
  const reasonCounts = new Map<string, { count: number; latest: number }>();

  interventions.forEach((log, index) => {
    levelCounts[log.level] += 1;
    if (!log.reason || log.reason === "선택하지 않음" || log.outcome === "blocked-retry") {
      return;
    }
    const prev = reasonCounts.get(log.reason) ?? { count: 0, latest: -1 };
    reasonCounts.set(log.reason, { count: prev.count + 1, latest: index });
  });

  let topReason: string | null = null;
  let best = { count: 0, latest: -1 };
  for (const [reason, info] of reasonCounts) {
    if (info.count > best.count || (info.count === best.count && info.latest > best.latest)) {
      best = info;
      topReason = reason;
    }
  }

  return {
    date,
    usageSeconds,
    clipCount: usage.reduce((sum, log) => sum + log.clipCount, 0),
    interventionCount: interventions.length,
    levelCounts,
    topReason,
    reentryCount: interventions.filter((log) => log.level === 2 && log.reEntered)
      .length,
    blockCount: interventions.filter((log) => log.outcome === "timed-block").length,
    forceQuitCount: interventions.filter((log) => log.outcome === "force-quit")
      .length,
    alternativeCompletedCount: interventions.filter((log) => log.alternativeCompleted)
      .length,
    lockAttemptCount: data.lockAttempts.filter((item) => item.date === date).length,
    selfStopCount: interventions.filter((log) =>
      (SELF_STOP_OUTCOMES as readonly string[]).includes(log.outcome),
    ).length,
    keptCount: interventions.filter((log) => log.outcome === "kept").length,
    dayEndCount: interventions.filter((log) => log.outcome === "day-end").length,
    overdraftCount: interventions.filter((log) => log.outcome === "overdraft").length,
    extendCount: interventions.filter((log) => log.outcome === "extend").length,
    cardsSolved: interventions.filter((log) => log.cardCorrect !== null).length,
    cardsCorrect: interventions.filter((log) => log.cardCorrect === true).length,
    restSeconds: restSecondsOn(data, date),
    lockStreak: lockStreak(data, date),
  };
}

/** 리포트 문장. 정해진 문장 틀에 숫자만 채운다 (사용자 글이나 생성 문장은 넣지 않는다). */
export function reportLines(stats: DailyStats): string[] {
  const lines = [
    `스스로 멈춘 횟수 : ${stats.selfStopCount}번`,
    `총 사용시간 : ${formatReportDuration(stats.usageSeconds)}`,
    `실행 횟수 : ${stats.clipCount}회`,
    `개입 횟수 : ${stats.interventionCount}회`,
    `약속 지킴 : ${stats.keptCount}번 · 연장 : ${stats.extendCount}번`,
    `가장 많이 선택한 이유 : ${stats.topReason ?? "없음"}`,
    `시간 잠금 : ${stats.blockCount}회`,
    `잠금 중 시도 : ${stats.lockAttemptCount}회`,
  ];
  if (stats.restSeconds >= 60) lines.push(`오늘 쉰 시간 : ${minutesText(stats.restSeconds)}`);
  if (stats.lockStreak > 1) lines.push(`잠금 연속 기록 : ${stats.lockStreak}일`);
  if (stats.dayEndCount > 0) lines.push("오늘은 스스로 마무리했어요");
  if (stats.overdraftCount > 0) lines.push(`목표 초과 : ${stats.overdraftCount}번`);
  if (stats.cardsSolved > 0) {
    lines.push(`쇼츠 대신 푼 문제 : ${stats.cardsSolved}개 (정답 ${stats.cardsCorrect}개)`);
  }
  return lines;
}

export function applyFlush(
  data: AppData,
  visible: boolean,
  now = Date.now(),
): AppData {
  const session = data.activeSession;
  if (!session) return data;
  const elapsedMs = Math.min(2000, Math.max(0, now - session.lastTickAt));
  const addSeconds = visible ? elapsedMs / 1000 : 0;
  const duration = session.duration + addSeconds;
  const activeSession = { ...session, duration, lastTickAt: now };
  const usageLogs = data.usageLogs.map((log) =>
    log.usageId === session.usageId
      ? {
          ...log,
          duration,
          clipCount: session.clipCount,
          endTime: new Date(now).toISOString(),
        }
      : log,
  );
  return { ...data, activeSession, usageLogs };
}

export function finalizeSession(data: AppData, now = Date.now()): AppData {
  if (!data.activeSession) return data;
  const session = data.activeSession;
  const hasLog = data.usageLogs.some((log) => log.usageId === session.usageId);
  const usageLogs = hasLog
    ? data.usageLogs.map((log) =>
        log.usageId === session.usageId
          ? {
              ...log,
              duration: session.duration,
              clipCount: session.clipCount,
              endTime: new Date(now).toISOString(),
            }
          : log,
      )
    : [
        ...data.usageLogs,
        {
          usageId: session.usageId,
          date: session.date,
          startTime: session.startTime,
          endTime: new Date(now).toISOString(),
          duration: session.duration,
          clipCount: session.clipCount,
          target: "practice" as const,
          source: "web" as const,
        },
      ];
  return { ...data, usageLogs, activeSession: null };
}

export function withClip(data: AppData): AppData {
  if (!data.activeSession) return data;
  const clipCount = data.activeSession.clipCount + 1;
  const activeSession = { ...data.activeSession, clipCount };
  const usageLogs = data.usageLogs.map((log) =>
    log.usageId === activeSession.usageId ? { ...log, clipCount } : log,
  );
  return { ...data, activeSession, usageLogs };
}

export function reasonLabel(log: Pick<InterventionLog, "reason" | "reasonNote">): string {
  if (log.reason === "기타" && log.reasonNote.trim()) {
    return `기타 · ${log.reasonNote.trim()}`;
  }
  return log.reason || "기록 없음";
}

const INTERVENTION_TYPE: Record<Level, InterventionType> = {
  1: "pause",
  2: "alternative",
  3: "warning",
};

const REENTRY_WINDOW_MS = 30 * 60 * 1000;

/** 화면에서 받은 개입 결과에 시각·요일·종류를 채운다. */
export function buildIntervention(
  input: InterventionInput,
  id: string,
  now = new Date(),
): InterventionLog {
  return {
    ...input,
    interventionId: id,
    timestamp: now.toISOString(),
    date: todayKey(now),
    hour: now.getHours(),
    weekday: now.getDay(),
    target: input.target ?? null,
    interventionType: INTERVENTION_TYPE[input.level],
    reenteredWithin30: null,
    feedback: null,
    band: input.level,
    stage: "web",
    framing: null,
    verification: null,
    reflection: null,
    afterLock: null,
    commitMinutes: 0,
    cardId: null,
    cardCorrect: null,
    extensionIndex: 0,
    policyVersion: null,
  };
}

const NATIVE_OUTCOME: Record<string, InterventionLog["outcome"]> = {
  watch: "watch",
  exit: "exit",
  kept: "kept",
  extend: "extend",
  day_end: "day-end",
  lock: "timed-block",
  overdraft: "overdraft",
  budget_out: "budget-out",
  replaced: "interrupted",
};

const SHEET_TYPES: InterventionLog["interventionType"][] = [
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

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function asTarget(value: unknown): SessionTarget | null {
  return value === "youtube" || value === "instagram" || value === "practice" ? value : null;
}

function asLevel(value: number): Level {
  return value === 2 ? 2 : value === 3 ? 3 : 1;
}

/** 네이티브가 넘긴 기록을 앱 데이터 형태로 바꾼다. 이미 있는 id는 건너뛴다. */
export function convertNativeBatch(
  data: AppData,
  batch: NativeBatch,
): {
  usageLogs: UsageLog[];
  interventions: InterventionLog[];
  lockAttempts: LockAttempt[];
  feedback: { refId: string; feedback: "helpful" | "not" }[];
} {
  const haveSession = new Set(data.usageLogs.map((log) => log.usageId));
  const haveIntervention = new Set(data.interventions.map((log) => log.interventionId));
  const haveLock = new Set(data.lockAttempts.map((item) => item.id));

  const usageLogs: UsageLog[] = (batch.sessions ?? [])
    .filter((row) => row.id && !haveSession.has(row.id) && row.endedAt > row.startedAt)
    .map((row) => ({
      usageId: row.id,
      date: todayKey(new Date(row.startedAt)),
      startTime: new Date(row.startedAt).toISOString(),
      endTime: new Date(row.endedAt).toISOString(),
      duration: Math.max(0, row.durationSec),
      clipCount: 1,
      target: asTarget(row.target) ?? "youtube",
      source: "native" as const,
    }));

  const feedback = (batch.interventions ?? [])
    .filter((row) => row.stage === "feedback" && row.refId)
    .map((row) => ({
      refId: row.refId as string,
      feedback: row.feedback === "helpful" ? ("helpful" as const) : ("not" as const),
    }));

  const interventions: InterventionLog[] = (batch.interventions ?? [])
    .filter((row) => row.id && row.stage !== "feedback" && !haveIntervention.has(row.id))
    .map((row) => {
      const at = new Date(row.createdAt);
      const level = asLevel(row.level);
      const outcome = NATIVE_OUTCOME[row.outcome] ?? "exit";
      const watching = WATCH_OUTCOMES.includes(outcome);
      const blockMinutes = Math.max(0, Math.round(row.blockMinutes ?? 0));
      const type = SHEET_TYPES.find((t) => t === row.interventionType) ?? INTERVENTION_TYPE[level];
      return {
        interventionId: row.id,
        timestamp: at.toISOString(),
        date: todayKey(at),
        level,
        reason: row.reason || "선택하지 않음",
        reasonNote: "",
        alternativeAction: row.alternativeAction ?? null,
        alternativeCompleted: row.verification === "self" || row.verification === "verified",
        reEntered: watching,
        blocked: outcome === "timed-block" || outcome === "day-end",
        blockDuration: blockMinutes,
        usageSeconds: Math.max(0, row.usageSeconds),
        outcome,
        hour: at.getHours(),
        weekday: at.getDay(),
        target: asTarget(row.target),
        interventionType: type,
        reenteredWithin30: null,
        feedback: null,
        band: row.band === 1 || row.band === 2 || row.band === 3 ? row.band : level,
        stage: textOrNull(row.stage),
        framing: textOrNull(row.framing),
        verification: textOrNull(row.verification),
        reflection: textOrNull(row.reflection),
        afterLock: textOrNull(row.afterLock),
        commitMinutes: Math.max(0, Math.round(row.commitMinutes ?? 0)),
        cardId: textOrNull(row.cardId),
        cardCorrect: typeof row.cardCorrect === "boolean" ? row.cardCorrect : null,
        extensionIndex: Math.max(0, Math.round(row.extensionIndex ?? 0)),
        policyVersion: textOrNull(row.policyVersion),
      };
    });

  const lockAttempts: LockAttempt[] = (batch.lockAttempts ?? [])
    .filter((row) => row.id && !haveLock.has(row.id))
    .map((row) => {
      const at = new Date(row.createdAt);
      return {
        id: row.id,
        createdAt: at.toISOString(),
        date: todayKey(at),
        remainingSec: Math.max(0, Math.round(row.remainingSec)),
        target: asTarget(row.target),
      };
    });

  return { usageLogs, interventions, lockAttempts, feedback };
}

/**
 * 나가기·종료·차단 뒤 30분이 지난 개입에 재진입 여부를 채운다.
 * 재진입 = 그 사이 새 시청 세션, 새 개입, 또는 잠금 중 시도가 있었는지.
 * 시청을 고른 개입은 대상이 아니라 null로 둔다.
 */
export function settleReentry(
  data: AppData,
  now = Date.now(),
): { data: AppData; changed: InterventionLog[] } {
  const changed: InterventionLog[] = [];
  // 새로 들어온 순간만 센다. 약속 시간 끝 시트는 같은 시청 안이라 뺀다.
  const starts = [
    ...data.usageLogs.filter((log) => log.target !== "practice").map((log) => log.startTime),
    ...data.interventions.filter((log) => log.stage !== "commit_end").map((log) => log.timestamp),
    ...data.lockAttempts.map((item) => item.createdAt),
  ]
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));

  const interventions = data.interventions.map((log) => {
    if (log.reenteredWithin30 !== null || WATCH_OUTCOMES.includes(log.outcome)) return log;
    const at = new Date(log.timestamp).getTime();
    if (!Number.isFinite(at) || now - at < REENTRY_WINDOW_MS) return log;
    const reentered = starts.some((ms) => ms > at && ms <= at + REENTRY_WINDOW_MS);
    const next = { ...log, reenteredWithin30: reentered };
    changed.push(next);
    return next;
  });
  if (changed.length === 0) return { data, changed };
  return { data: { ...data, interventions }, changed };
}
