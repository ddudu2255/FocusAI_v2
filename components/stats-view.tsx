"use client";

import { useState, type ReactNode } from "react";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import {
  BAND_LABEL,
  formatClock,
  formatTime,
  hourlyUsage,
  reasonLabel,
  secondsOnDate,
  statsForDate,
  TARGET_LABEL,
  todayKey,
} from "@/lib/logic";
import {
  dayTimeline,
  hourLabel,
  METHOD_LABEL,
  peakHour,
  RESULT_CHIP,
  weekSeries,
  weekSummary,
} from "@/lib/review";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dayParts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { month: m, day: d, weekday: new Date(y, m - 1, d).getDay() };
}

function longDate(date: string) {
  const p = dayParts(date);
  return `${p.month}월 ${p.day}일 ${WEEKDAYS[p.weekday]}요일`;
}

const minutes = (seconds: number) => Math.round(seconds / 60);

/** 통계: 지난 기록을 찾아보는 화면. 오늘의 실시간 숫자는 홈이 맡는다. */
export function StatsView() {
  const { data } = useStore();
  const now = useNow(5000);
  const today = todayKey(new Date(now));
  const [selected, setSelected] = useState(today);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!data) return null;

  const week = weekSeries(data, new Date(now));
  const summary = weekSummary(week);
  const active = week.some((d) => d.date === selected) ? selected : today;
  const todayGoal = week[week.length - 1].goalMinutes;
  const scale = Math.max(todayGoal * 60, ...week.map((d) => d.seconds), 60) * 1.15;
  const goalPct = ((todayGoal * 60) / scale) * 100;
  const first = dayParts(week[0].date);
  const last = dayParts(week[week.length - 1].date);

  const stats = statsForDate(data, active);
  const activeGoal = week.find((d) => d.date === active)?.goalMinutes ?? todayGoal;
  const timeline = dayTimeline(data, active);
  const peak = peakHour(hourlyUsage(data, active));
  const interventions = data.interventions
    .filter((log) => log.date === active)
    .slice()
    .reverse();
  // 자정을 넘긴 세션은 걸친 두 날짜에 모두 보인다. 시간은 그 날짜 몫만 표시한다.
  const sessions = data.usageLogs
    .map((log) => ({ log, seconds: secondsOnDate(log, active) }))
    .filter((item) => item.seconds > 0 || item.log.date === active)
    .reverse();
  const locks = data.lockAttempts.filter((item) => item.date === active).reverse();
  const empty = interventions.length === 0 && sessions.length === 0 && locks.length === 0;
  const targets = new Map<string, number>();
  sessions.forEach(({ log }) => targets.set(TARGET_LABEL[log.target], (targets.get(TARGET_LABEL[log.target]) ?? 0) + 1));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <header className="mb-1">
        <p className="text-[13px] text-muted-foreground">
          {first.month}월 {first.day}일 – {last.month}월 {last.day}일
        </p>
        <h1 className="mt-0.5 text-[27px] font-bold tracking-tight">통계</h1>
      </header>

      <section aria-label="최근 7일 사용 시간" className="rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[15px] font-bold">
            하루 평균 <span className="text-[22px] tabular-nums">{minutes(summary.avgSeconds)}분</span>
          </p>
          <p className="text-[13px] text-muted-foreground">
            목표 지킨 날{" "}
            <b className="text-[var(--leaf-2)] tabular-nums">
              {summary.kept} / {summary.counted}
            </b>
          </p>
        </div>
        <div className="relative mt-4 h-[150px]">
          <div
            className="absolute inset-x-0 border-t-[1.5px] border-dashed border-muted-foreground/40"
            style={{ bottom: `calc(${goalPct}% * 0.82)` }}
          />
          <span
            className="absolute right-0 bg-card pl-1 text-[11px] text-muted-foreground"
            style={{ bottom: `calc(${goalPct}% * 0.82 + 3px)` }}
          >
            목표 {todayGoal}분
          </span>
          <div className="grid h-full grid-cols-7 items-end gap-1.5">
            {week.map((day) => {
              const on = day.date === active;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => {
                    setSelected(day.date);
                    setOpenId(null);
                  }}
                  aria-pressed={on}
                  aria-label={`${longDate(day.date)} ${minutes(day.seconds)}분`}
                  className="flex h-full flex-col items-center justify-end gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "text-[11px] tabular-nums",
                      day.state === "over" ? "font-bold text-level-2" : "text-muted-foreground",
                      on && "font-bold text-foreground",
                    )}
                  >
                    {day.state === "before" ? "" : minutes(day.seconds)}
                  </span>
                  <span
                    className={cn(
                      "w-[22px] rounded-lg",
                      day.state === "before" ? "bg-muted" : day.state === "over" ? "bg-level-2" : "bg-[var(--leaf-1)]",
                      on && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-card",
                    )}
                    style={{ height: `${Math.max(4, (day.seconds / scale) * 82)}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5 text-center text-xs text-muted-foreground">
          {week.map((day) => (
            <span key={day.date} className={cn(day.date === active && "font-bold text-foreground")}>
              {day.date === today ? "오늘" : WEEKDAYS[dayParts(day.date).weekday]}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-[var(--leaf-1)]" />
            지킨 날
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-level-2" />
            넘은 날
          </span>
          <span>막대를 누르면 그날을 봐요</span>
        </div>
      </section>

      <div className="mx-0.5 mt-1.5">
        <h2 className="text-lg font-bold">{longDate(active)}</h2>
        {empty ? null : (
          <p className="mt-0.5 text-[13.5px] text-muted-foreground tabular-nums">
            {minutes(stats.usageSeconds)}분 사용 · 목표 {activeGoal}분 · 개입 {stats.interventionCount}회 · 스스로 멈춤{" "}
            {stats.selfStopCount}번
          </p>
        )}
      </div>

      {empty ? (
        <p className="rounded-3xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
          이 날은 쇼츠를 보지 않았어요.
        </p>
      ) : (
        <>
          <section aria-label="하루 흐름" className="rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="text-[15px] font-bold">하루 흐름</p>
            {peak !== null ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">{hourLabel(peak)}에 가장 많이 봤어요</p>
            ) : null}
            <div className="relative mt-4 h-[30px] rounded-lg bg-muted">
              {timeline.sessions.map((s) => (
                <span
                  key={s.id}
                  className="absolute inset-y-0 rounded bg-primary"
                  style={{ left: `${s.left}%`, width: `${s.width}%` }}
                />
              ))}
            </div>
            <div className="relative mt-1.5 h-3.5">
              {timeline.marks.map((m) => (
                <span
                  key={m.id}
                  className={cn(
                    "absolute -ml-1 size-2 rounded-full",
                    m.stopped ? "bg-[var(--leaf-2)]" : "bg-muted-foreground/70",
                  )}
                  style={{ left: `${m.left}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>0시</span>
              <span>6시</span>
              <span>12시</span>
              <span>18시</span>
              <span>24시</span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-primary" />
                시청
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[var(--leaf-2)]" />
                개입 후 멈춤
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-muted-foreground/70" />
                계속 봄
              </span>
            </div>
          </section>

          {interventions.length > 0 ? (
            <section aria-label="개입 기록" className="overflow-hidden rounded-3xl bg-card py-1.5 ring-1 ring-foreground/10">
              <p className="px-4 pt-2.5 pb-1.5 text-[15px] font-bold">개입 기록</p>
              <ul>
                {interventions.map((log) => {
                  const open = openId === log.interventionId;
                  const chip = RESULT_CHIP[log.outcome] ?? { label: log.outcome, good: false };
                  return (
                    <li key={log.interventionId} className={cn("border-t border-border/70", open && "bg-muted/50")}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : log.interventionId)}
                        className="grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">{formatTime(log.timestamp)}</span>
                        <span className={cn("truncate text-[14.5px]", open && "font-bold")}>
                          {METHOD_LABEL[log.interventionType] ?? log.interventionType}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-bold",
                            chip.good
                              ? "bg-[color-mix(in_srgb,var(--leaf-1)_16%,transparent)] text-[var(--leaf-2)]"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {chip.label}
                        </span>
                      </button>
                      {open ? (
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 pr-4 pb-3 pl-[88px] text-[13px]">
                          <Field label="연 이유" value={reasonLabel(log)} />
                          <Field label="그때까지 본 시간" value={`${minutes(log.usageSeconds)}분`} />
                          <Field
                            label="30분 안에 다시 열기"
                            value={
                              !chip.good
                                ? "해당 없음"
                                : log.reenteredWithin30 === null
                                  ? "확인 중"
                                  : log.reenteredWithin30
                                    ? "다시 열었음"
                                    : "열지 않음"
                            }
                          />
                          <Field label="강도" value={BAND_LABEL[log.level]} />
                        </dl>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-label="자세히" className="overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10">
            <Group title="약속" summary={`지킴 ${stats.keptCount} · 연장 ${stats.extendCount}`}>
              <Row label="약속 지킴" value={`${stats.keptCount}번`} />
              <Row label="약속 연장" value={`${stats.extendCount}번`} />
              <Row label="목표 초과" value={`${stats.overdraftCount}번`} />
              <Row label="오늘은 끝" value={stats.dayEndCount > 0 ? "스스로 마무리" : "없음"} />
            </Group>
            <Group title="시간 잠금" summary={`${stats.blockCount}회 · 쉰 시간 ${formatClock(stats.restSeconds)}`}>
              <Row label="시간 잠금" value={`${stats.blockCount}회`} />
              <Row label="쉰 시간" value={formatClock(stats.restSeconds)} />
              <Row label="잠금 중 시도" value={`${stats.lockAttemptCount}회`} />
              {locks.map((item) => (
                <Row key={item.id} label={formatTime(item.createdAt)} value={`남은 잠금 ${formatClock(item.remainingSec)}`} />
              ))}
            </Group>
            <Group title="공부 카드" summary={`${stats.cardsSolved}문제 · 정답 ${stats.cardsCorrect}`}>
              <Row label="푼 문제" value={`${stats.cardsSolved}개`} />
              <Row label="정답" value={`${stats.cardsCorrect}개`} />
            </Group>
            <Group
              title="시청 기록"
              summary={[`${sessions.length}번`, ...[...targets].map(([name, count]) => `${name} ${count}`)].join(" · ")}
            >
              {sessions.map(({ log, seconds }) => (
                <Row
                  key={log.usageId}
                  label={`${formatTime(log.startTime)} – ${formatTime(log.endTime)} · ${TARGET_LABEL[log.target]}`}
                  value={`${formatClock(seconds)}${Math.round(seconds) < Math.round(log.duration) ? " (자정 넘김)" : ""}`}
                />
              ))}
            </Group>
          </section>
        </>
      )}
    </div>
  );
}

function Group({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="group border-t border-border/70 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="text-[14.5px]">{title}</span>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {summary} <span className="inline-block transition-transform group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
