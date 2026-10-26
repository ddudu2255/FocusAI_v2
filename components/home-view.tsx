"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GoalSuggestionCard } from "@/components/goal-suggestion";
import { useStore } from "@/components/store";
import { TreeView } from "@/components/tree-view";
import { useNow } from "@/components/use-now";
import { HanbakjaGuard } from "@/lib/guard";
import {
  blockRemainingSeconds,
  formatClock,
  getMonthProgress,
  goalMinutesOn,
  isBlocked,
  pastMonthProgress,
  todayKey,
  usageSecondsOn,
  type DayState,
} from "@/lib/logic";
import { homeLine } from "@/lib/compare";
import { ladder, stageForMonth, stageHint, STAGES } from "@/lib/tree";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 개입 스위치 상태 (설정의 GuardPanel과 같은 방식). 확인 전에는 null. */
function useBlockerEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let stopped = false;
    async function read() {
      try {
        const status = await HanbakjaGuard.getStatus();
        if (!stopped) setEnabled(status.blockerEnabled);
      } catch {
        if (!stopped) setEnabled(true);
      }
    }
    void read();
    const id = window.setInterval(() => void read(), 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return enabled;
}

const DAY_CLASS: Record<DayState, string> = {
  kept: "bg-[var(--leaf-1)]",
  missed: "bg-muted-foreground/35",
  future: "bg-muted",
  before: "border border-dashed border-muted-foreground/30",
};

export function HomeView() {
  const router = useRouter();
  const { data } = useStore();
  const now = useNow();
  const blocker = useBlockerEnabled();
  const today = todayKey(new Date(now));

  // 달 계산은 기록이나 날짜가 바뀔 때만 다시 한다 (1초마다 다시 그리는 동안 매번 하지 않게).
  const month = useMemo(() => (data ? getMonthProgress(data, new Date(now)) : null), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const past = useMemo(() => (data ? pastMonthProgress(data, new Date(now)) : []), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !month) return null;

  const date = new Date(now);
  const dateLine = `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
  const goal = goalMinutesOn(data, today);
  const usage = usageSecondsOn(data, today);
  const over = usage > goal * 60;
  const leftMinutes = Math.max(1, Math.ceil((goal * 60 - usage) / 60));
  const blocked = isBlocked(data.block, now);
  const compareLine = homeLine(data.compare, data, date);

  const stage = stageForMonth(month.keptDays, month.countedDays, month.elapsedDays);
  const left = month.countedDays - month.elapsedDays;
  const hint = stageHint(month.keptDays, month.countedDays, month.elapsedDays);
  const steps = ladder(month.countedDays > 0 ? month.countedDays : month.monthDays);

  const todayLogs = data.interventions.filter((log) => log.date === today);
  const exits = todayLogs.filter((log) => log.outcome === "exit").length;
  const commitEnds = todayLogs.filter((log) => log.stage === "commit_end");
  const kept = commitEnds.filter((log) => log.outcome === "kept").length;
  const reopened = todayLogs.filter((log) => log.reenteredWithin30 === true).length;

  const forest = past.map((p) => ({
    label: `${p.month}월`,
    stage: p.hasRecords ? stageForMonth(p.keptDays, p.countedDays, p.elapsedDays) : 0,
  }));
  const grown = forest.filter((m) => m.stage >= 1).length;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <header className="mb-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">{dateLine}</p>
          <h1 className={cn("mt-0.5 text-[27px] font-bold tracking-tight text-balance", over && "text-level-2")}>
            {over ? "오늘 목표를 넘었어요" : `오늘 ${leftMinutes}분 남았어요`}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className={cn(
            "mt-1 shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-semibold",
            blocker === false
              ? "bg-muted text-muted-foreground"
              : "bg-[color-mix(in_srgb,var(--leaf-1)_14%,transparent)] text-[var(--leaf-2)]",
            blocker === null && "opacity-0",
          )}
        >
          {blocker === false ? "개입 꺼짐" : "개입 켜짐"}
        </button>
      </header>

      {blocked ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive tabular-nums" role="status">
          쇼츠 쉬는 중 · 남은 시간 {formatClock(blockRemainingSeconds(data.block, now))}
        </p>
      ) : null}

      <GoalSuggestionCard />

      <section className="overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10">
        <div className="relative bg-gradient-to-b from-[var(--sky-2)] to-[var(--sky-1)]">
          <TreeView stage={stage} title={`이번 달 나무: ${STAGES[stage].name}`} className="block h-auto w-full" />
          <span className="absolute top-3 left-3 rounded-full bg-card/70 px-3 py-1 text-[13px] font-bold backdrop-blur-md">
            {STAGES[stage].name}
          </span>
        </div>
        <div className="px-4 pt-3.5">
          <p className="mb-3 text-[15px]">{hint}</p>
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
            {month.dayStates.map((state, i) => (
              <span key={i} className={cn("aspect-square rounded-[3px]", DAY_CLASS[state])} />
            ))}
          </div>
          <div className="flex justify-between gap-2.5 pt-2.5 pb-3.5 text-xs text-muted-foreground">
            <span>
              지킨 날 <b className="font-semibold text-foreground tabular-nums">{month.keptDays}일</b>
              {month.missedDays > 0 ? (
                <>
                  {" · 놓친 날 "}
                  <b className="font-semibold text-foreground tabular-nums">{month.missedDays}일</b>
                </>
              ) : null}
            </span>
            <span>
              {left > 0 ? (
                <>
                  남은 날 <b className="font-semibold text-foreground tabular-nums">{left}일</b>
                </>
              ) : (
                "이번 달 끝"
              )}
            </span>
          </div>
        </div>
        <details className="group border-t border-border/70">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            단계 기준 보기 <span className="inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="pb-2">
            {steps.map((step) => (
              <li
                key={step.index}
                className={cn(
                  "grid grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2",
                  stage === step.index && "bg-[color-mix(in_srgb,var(--leaf-1)_10%,transparent)]",
                )}
              >
                <span className={cn("size-[9px] rounded-full", stage >= step.index ? "bg-[var(--leaf-1)]" : "bg-muted")} />
                <span className={cn("text-[14.5px]", stage === step.index && "font-bold")}>{step.name}</span>
                <span className="text-[12.5px] text-muted-foreground tabular-nums">{step.cond}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex items-end justify-between gap-2.5">
          <div>
            <p className="mb-0.5 text-[13px] font-semibold text-muted-foreground">오늘 사용</p>
            <p className="text-[34px] leading-none font-bold tracking-tight tabular-nums">
              {Math.floor(usage / 60)}
              <small className="ml-0.5 text-[17px] font-semibold text-muted-foreground">분</small>
            </p>
          </div>
          <p className="mb-0.5 text-[13px] text-muted-foreground">목표 {goal}분</p>
        </div>
        <span className="mt-3 block h-2.5 overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full rounded-full transition-[width] duration-500", over ? "bg-level-2" : "bg-primary")}
            style={{ width: `${Math.min(100, (usage / (goal * 60)) * 100)}%` }}
          />
        </span>
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          <Tile value={`${exits}`} unit="회" label="바로 나감" />
          <Tile value={`${kept}`} unit={`/${commitEnds.length}`} label="약속 지킴" />
          <Tile value={`${reopened}`} unit="회" label="다시 열기" />
        </div>
        {compareLine ? <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{compareLine}</p> : null}
      </section>

      <section className="rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
          <p className="text-[13px] font-semibold text-muted-foreground">지난 달의 숲</p>
          <span className="text-[12.5px] text-muted-foreground">나무 {grown}그루</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {forest.map((m) => (
            <div key={m.label} className="overflow-hidden rounded-xl bg-gradient-to-b from-[var(--sky-2)] to-[var(--sky-1)] text-center">
              <TreeView stage={m.stage} sway={false} title={`${m.label} ${STAGES[m.stage].name}`} className="block h-auto w-full" />
              <span className="block bg-muted px-0.5 pt-1 pb-1.5 text-[11.5px] text-muted-foreground">
                {m.label} <b className="font-semibold text-foreground">{STAGES[m.stage].name}</b>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Tile({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="rounded-xl bg-muted px-2 py-2.5 text-center">
      <b className="block text-xl font-bold tracking-tight tabular-nums">
        {value}
        <i className="ml-px text-[13px] font-semibold not-italic text-muted-foreground">{unit}</i>
      </b>
      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{label}</span>
    </div>
  );
}
