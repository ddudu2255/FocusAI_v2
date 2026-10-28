"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import { reportLine } from "@/lib/compare";
import { isNativeAndroid } from "@/lib/guard";
import { formatClock, formatTime, goalMinutesOn, isReportDue, statsForDate, todayKey, usageSecondsOn } from "@/lib/logic";
import {
  bestMethod,
  dayParts,
  hourLabel,
  longestWatch,
  METHOD_LABEL,
  methodResults,
  opensOn,
  riskyHour,
  usualByNow,
  usualDifferences,
  weakMethod,
  weekSeries,
  weekSummary,
} from "@/lib/review";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const minutes = (seconds: number) => Math.round(seconds / 60);

/** 리포트: 하루를 한눈에 정리한다. 사용 시간 → 언제 봤는지 → 어떻게 멈췄는지 → 내일 한 가지. */
export function ReportView() {
  const { data, permission, markReportSeen } = useStore();
  const now = useNow(5000);
  const native = isNativeAndroid();
  const due = data ? isReportDue(data.settings.notificationTime, new Date(now)) : false;

  // 리포트 시각이 지난 뒤 이 화면을 열면 오늘 리포트를 본 것으로 표시한다.
  useEffect(() => {
    if (due) markReportSeen();
  }, [due, markReportSeen]);

  if (!data) return null;

  const date = new Date(now);
  const today = todayKey(date);
  const usage = usageSecondsOn(data, today);
  const goal = goalMinutesOn(data, today);
  const stats = statsForDate(data, today);
  const todayLogs = data.interventions.filter((log) => log.date === today);
  const watched = usage > 0 || todayLogs.length > 0;
  const overMinutes = Math.ceil((usage - goal * 60) / 60);
  const over = overMinutes > 0;

  const title = !watched
    ? "오늘은 쇼츠를 보지 않았어요"
    : over
      ? `오늘은 목표를 ${overMinutes}분 넘었어요`
      : due
        ? "목표 안에서 하루를 마쳤어요"
        : "지금까지 목표 안이에요";

  const usual = usualByNow(data, date);
  const gap = usual === null ? 0 : minutes(usage) - minutes(usual);
  const yesterday = new Date(date);
  yesterday.setDate(date.getDate() - 1);
  const yesterdaySeconds = usageSecondsOn(data, todayKey(yesterday));
  const week = weekSummary(weekSeries(data, date));

  const parts = dayParts(data, today);
  const partMax = Math.max(...parts.map((p) => p.seconds), 1);
  const longest = longestWatch(data, today);
  const opens = opensOn(data, today);

  const results = methodResults(todayLogs);
  const best = bestMethod(results);
  const weak = weakMethod(results, best);
  const differences = usualDifferences(data, date);
  const risky = riskyHour(data, date);
  const others = reportLine(data.compare, data);

  const notifyLine = !data.settings.notifyEnabled
    ? "리포트 알림이 꺼져 있어요"
    : native && permission !== "granted"
      ? "알림 권한이 없어 리포트 알림이 오지 않아요"
      : `매일 ${data.settings.notificationTime}에 리포트 알림이 와요`;

  const fill = Math.min(100, (usage / Math.max(goal * 60, 1)) * 100);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <header className="mb-1">
        <p className="text-[13px] text-muted-foreground">
          {date.getMonth() + 1}월 {date.getDate()}일 {WEEKDAYS[date.getDay()]}요일 ·{" "}
          {due ? "오늘의 리포트" : `${formatTime(date.toISOString())}까지 중간 집계`}
        </p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-bold tracking-tight text-balance">{title}</h1>
      </header>

      <section aria-label="사용 시간" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
        <p className="text-[13px] font-bold text-muted-foreground">{due ? "오늘 본 시간" : "지금까지 본 시간"}</p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <p className="tabular-nums">
            <span className={cn("text-[44px] leading-none font-bold tracking-tight", over && "text-level-2")}>
              {minutes(usage)}
            </span>
            <span className="ml-1 text-lg font-bold">분</span>
            <span className="ml-1.5 text-[15px] text-muted-foreground">/ 목표 {goal}분</span>
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums",
              over
                ? "bg-[color-mix(in_srgb,var(--color-level-2)_15%,transparent)] text-level-2"
                : "bg-[color-mix(in_srgb,var(--leaf-1)_16%,transparent)] text-[var(--leaf-2)]",
            )}
          >
            {over ? `${overMinutes}분 넘음` : `${Math.max(0, goal - minutes(usage))}분 남음`}
          </span>
        </div>
        <div className="mt-3.5 h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn("h-full rounded-full", over ? "bg-level-2" : "bg-[var(--leaf-1)]")}
            style={{ width: `${Math.max(fill, usage > 0 ? 3 : 0)}%` }}
          />
        </div>
        <dl className="mt-4 grid grid-cols-3 divide-x divide-border/70 text-center">
          <Compare
            label={due ? "평소" : "평소 이 시각"}
            value={usual === null ? "–" : `${minutes(usual)}분`}
            note={
              usual === null || !watched ? null : gap === 0 ? (
                "비슷해요"
              ) : (
                <span className={gap < 0 ? "text-[var(--leaf-2)]" : "text-level-2"}>
                  {Math.abs(gap)}분 {gap < 0 ? "적게" : "많이"}
                </span>
              )
            }
          />
          <Compare label="어제" value={`${minutes(yesterdaySeconds)}분`} />
          <Compare label="이번 주 지킨 날" value={`${week.kept} / ${week.counted}`} />
        </dl>
      </section>

      {watched ? (
        <section aria-label="언제 봤나요" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <p className="text-[15px] font-bold">언제 봤나요</p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {parts.map((part) => {
              const top = part.seconds > 0 && part.seconds === partMax;
              return (
                <li key={part.label} className="grid grid-cols-[68px_minmax(0,1fr)_44px] items-center gap-2.5">
                  <span className="text-[13px] leading-tight">
                    <span className={cn(top && "font-bold")}>{part.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{part.range}</span>
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", top ? "bg-primary" : "bg-primary/45")}
                      style={{ width: `${part.seconds > 0 ? Math.max(4, (part.seconds / partMax) * 100) : 0}%` }}
                    />
                  </span>
                  <span className={cn("text-right text-[13px] tabular-nums", top ? "font-bold" : "text-muted-foreground")}>
                    {minutes(part.seconds)}분
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Tile label="연 횟수" value={`${opens}번`} />
            <Tile
              label="가장 길게 본 한 번"
              value={longest ? `${minutes(longest.seconds)}분` : "–"}
              note={longest ? `${formatTime(longest.startTime)}부터` : null}
            />
          </div>
        </section>
      ) : null}

      {stats.interventionCount > 0 ? (
        <section aria-label="어떻게 멈췄나요" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <p className="text-[15px] font-bold">어떻게 멈췄나요</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Tile label="스스로 멈춤" value={`${stats.selfStopCount}번`} note={`개입 ${stats.interventionCount}번 중`} good />
            <Tile label="약속 지킴" value={`${stats.keptCount}번`} note={`연장 ${stats.extendCount}번`} />
            <Tile
              label="쉰 시간"
              value={stats.restSeconds >= 60 ? formatClock(stats.restSeconds) : "없음"}
              note={stats.blockCount > 0 ? `잠금 ${stats.blockCount}번` : null}
            />
          </div>
          {stats.topReason ? (
            <p className="mt-3 text-[13.5px] text-muted-foreground">
              가장 많이 고른 이유 · <b className="text-foreground">{stats.topReason}</b>
            </p>
          ) : null}
          {best ? (
            <div className="mt-4 flex items-center gap-3 border-t border-border/70 pt-4">
              <span className="flex size-11 flex-none items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--leaf-1)_16%,transparent)]">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--leaf-2)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12h4l2-5 4 10 2-5h6" />
                </svg>
              </span>
              <div>
                <p className="text-[12px] text-muted-foreground">오늘 잘 통한 방법</p>
                <p className="text-[15px] font-bold">{METHOD_LABEL[best.type] ?? best.type}</p>
                <p className="text-[13px] text-muted-foreground">
                  {best.total}번 중 {best.stopped}번 바로 멈췄어요
                </p>
              </div>
            </div>
          ) : null}
          {weak ? (
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
              {METHOD_LABEL[weak.type] ?? weak.type} 뒤에는 계속 본 적이 많았어요.
              {data.settings.aiEnabled ? " 앱이 다음부터 덜 꺼내요." : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {differences.length > 0 ? (
        <section aria-label="평소와 달랐던 점" className="overflow-hidden rounded-3xl bg-card py-1.5 ring-1 ring-foreground/10">
          <p className="px-5 pt-2.5 pb-1.5 text-[15px] font-bold">평소와 달랐던 점</p>
          {differences.map((item) => (
            <div key={item.text} className="flex justify-between gap-3 border-t border-border/70 px-5 py-3 text-sm">
              <span>{item.text}</span>
              <span className="text-muted-foreground tabular-nums">{item.detail}</span>
            </div>
          ))}
        </section>
      ) : null}

      {others ? <p className="mx-1 text-[13.5px] text-muted-foreground">{others}</p> : null}

      {risky !== null ? (
        <section aria-label="내일 한 가지" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <p className="text-[15px] font-bold">내일 한 가지</p>
          <p className="mt-1 text-sm leading-relaxed">
            요즘 <b>{hourLabel(risky)}</b>에 길어지는 날이 많았어요. 그 시간에는 &ldquo;몇 분 볼래요?&rdquo;에서 3분을 골라 보세요.
          </p>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/stats"
          className="flex h-[46px] items-center justify-center rounded-2xl bg-card text-sm font-bold ring-1 ring-foreground/15 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          하루 흐름 보기
        </Link>
        <Link
          href="/"
          className="flex h-[46px] items-center justify-center rounded-2xl bg-card text-sm font-bold ring-1 ring-foreground/15 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          나무 보기
        </Link>
      </div>

      <p className="mx-1 mt-0.5 text-[12.5px] text-muted-foreground">
        {notifyLine} ·{" "}
        <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
          알림 설정
        </Link>
      </p>
    </div>
  );
}

function Compare({ label, value, note = null }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="px-1">
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-bold tabular-nums">{value}</dd>
      {note ? <dd className="text-[11.5px] font-bold tabular-nums">{note}</dd> : null}
    </div>
  );
}

function Tile({ label, value, note = null, good = false }: { label: string; value: string; note?: string | null; good?: boolean }) {
  return (
    <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-[17px] font-bold tabular-nums", good && "text-[var(--leaf-2)]")}>{value}</p>
      {note ? <p className="text-[11.5px] text-muted-foreground tabular-nums">{note}</p> : null}
    </div>
  );
}
