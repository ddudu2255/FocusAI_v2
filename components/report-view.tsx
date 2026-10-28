"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import { isNativeAndroid } from "@/lib/guard";
import { goalMinutesOn, isReportDue, todayKey, usageSecondsOn } from "@/lib/logic";
import {
  bestMethod,
  hourLabel,
  METHOD_LABEL,
  methodResults,
  riskyHour,
  usualDays,
  usualDifferences,
  USUAL_MIN_DAYS,
  weakMethod,
} from "@/lib/review";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const minutes = (seconds: number) => Math.round(seconds / 60);

/** 리포트: 하루 끝에 읽고 닫는 해석. 오늘 숫자(홈)와 지난 기록(통계)은 다시 싣지 않는다. */
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
  const todayLogs = data.interventions.filter((log) => log.date === today);
  const watched = usage > 0 || todayLogs.length > 0;
  const overMinutes = Math.ceil((usage - goal * 60) / 60);

  const title = !watched
    ? "오늘은 쇼츠를 보지 않았어요"
    : overMinutes > 0
      ? `오늘은 목표를 ${overMinutes}분 넘었어요`
      : due
        ? "목표 안에서 하루를 마쳤어요"
        : "지금까지 목표 안이에요";

  const days = usualDays(data, date);
  const usual = days.length >= USUAL_MIN_DAYS ? days.reduce((sum, d) => sum + usageSecondsOn(data, d), 0) / days.length : null;
  const gap = usual === null ? 0 : minutes(usage) - minutes(usual);

  const results = methodResults(todayLogs);
  const best = bestMethod(results);
  const weak = weakMethod(results, best);
  const differences = usualDifferences(data, date);
  const risky = riskyHour(data, date);

  const notifyLine = !data.settings.notifyEnabled
    ? "리포트 알림이 꺼져 있어요"
    : native && permission !== "granted"
      ? "알림 권한이 없어 리포트 알림이 오지 않아요"
      : `매일 ${data.settings.notificationTime}에 리포트 알림이 와요`;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <header className="mb-1">
        <p className="text-[13px] text-muted-foreground">
          {date.getMonth() + 1}월 {date.getDate()}일 {WEEKDAYS[date.getDay()]}요일 · {due ? "오늘의 리포트" : "중간 집계"}
        </p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-bold tracking-tight text-balance">{title}</h1>
        {usual !== null && watched ? (
          <p className="mt-2 text-[15px] leading-relaxed">
            평소(최근 7일 평균 {minutes(usual)}분)
            {gap === 0 ? (
              "와 비슷하게 봤어요."
            ) : (
              <>
                보다{" "}
                <b className={gap < 0 ? "text-[var(--leaf-2)]" : "text-level-2"}>
                  {Math.abs(gap)}분 {gap < 0 ? "적게" : "많이"}
                </b>{" "}
                봤어요.
              </>
            )}
          </p>
        ) : null}
      </header>

      {best ? (
        <section aria-label="오늘 잘 통한 방법" className="rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-[15px] font-bold">오늘 잘 통한 방법</p>
          <div className="mt-3 flex items-center gap-3">
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
              <p className="text-[15px] font-bold">{METHOD_LABEL[best.type] ?? best.type}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {best.total}번 중 {best.stopped}번 바로 멈췄어요
              </p>
            </div>
          </div>
          {weak ? (
            <p className="mt-3 border-t border-border/70 pt-3 text-[13.5px] leading-relaxed text-muted-foreground">
              {METHOD_LABEL[weak.type] ?? weak.type} 뒤에는 계속 본 적이 많았어요. 앱이 다음부터 덜 꺼내요.
            </p>
          ) : null}
        </section>
      ) : null}

      {differences.length > 0 ? (
        <section aria-label="평소와 달랐던 점" className="overflow-hidden rounded-3xl bg-card py-1.5 ring-1 ring-foreground/10">
          <p className="px-4 pt-2.5 pb-1.5 text-[15px] font-bold">평소와 달랐던 점</p>
          {differences.map((item) => (
            <div key={item.text} className="flex justify-between gap-3 border-t border-border/70 px-4 py-3 text-sm">
              <span>{item.text}</span>
              <span className="text-muted-foreground tabular-nums">{item.detail}</span>
            </div>
          ))}
        </section>
      ) : null}

      {risky !== null ? (
        <section aria-label="내일 한 가지" className="rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-[15px] font-bold">내일 한 가지</p>
          <p className="mt-1 text-sm leading-relaxed">
            요즘 <b>{hourLabel(risky)}</b>에 길어지는 날이 많았어요. 그 시간에 앱이 조금 더 일찍 물어볼게요.
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
