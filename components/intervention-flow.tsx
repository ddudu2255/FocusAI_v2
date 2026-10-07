"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Droplets,
  Eye,
  Footprints,
  PersonStanding,
  Wind,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  ALTERNATIVES,
  BLOCK_MINUTES,
  formatClock,
  LEVEL_SUMMARY,
  minutesUntilDayEnd,
  recommendAlternative,
  REASONS,
  type Alternative,
} from "@/lib/logic";
import type { InterventionInput, Level } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS = {
  "물 마시기": Droplets,
  "간단한 스트레칭": PersonStanding,
  "5분 독서": BookOpen,
  "잠시 걷기": Footprints,
  "눈 쉬기": Eye,
  "호흡하기": Wind,
};

type Step =
  | "reason"
  | "wait"
  | "ready"
  | "alternative"
  | "doing"
  | "reenter"
  | "warning"
  | "confirm-block";

export function InterventionFlow({
  level,
  usageSeconds,
  onFinish,
  sourceLabel = null,
  dayEndHour = 6,
}: {
  level: Level;
  usageSeconds: number;
  onFinish: (input: InterventionInput) => void;
  sourceLabel?: string | null;
  dayEndHour?: number;
}) {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [alternative, setAlternative] = useState<Alternative | null>(null);
  const [completed, setCompleted] = useState(false);
  const [left, setLeft] = useState(5);
  const [actionLeft, setActionLeft] = useState(0);
  const [blockMinutes, setBlockMinutes] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const locked = useRef(false);

  const pauseDone = step === "wait" && left <= 0;
  const actionDone = completed || (step === "doing" && actionLeft <= 0);
  const shownStep =
    pauseDone ? "ready" : step === "doing" && actionLeft <= 0 ? "reenter" : step;

  useEffect(() => {
    headingRef.current?.focus();
  }, [shownStep]);

  useEffect(() => {
    if (step !== "wait" || left <= 0) return;
    const id = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [step, left]);

  useEffect(() => {
    if (step !== "doing" || actionLeft <= 0) return;
    const id = window.setTimeout(() => setActionLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [step, actionLeft]);

  function finish(
    partial: Omit<
      InterventionInput,
      | "level"
      | "reason"
      | "reasonNote"
      | "usageSeconds"
      | "alternativeAction"
      | "alternativeCompleted"
    > & {
      alternativeAction?: string | null;
      alternativeCompleted?: boolean;
    },
  ) {
    if (locked.current || !reason) return;
    locked.current = true;
    onFinish({
      level,
      reason,
      reasonNote: note.trim(),
      alternativeAction: partial.alternativeAction ?? null,
      alternativeCompleted: partial.alternativeCompleted ?? false,
      reEntered: partial.reEntered,
      blocked: partial.blocked,
      blockDuration: partial.blockDuration,
      usageSeconds,
      outcome: partial.outcome,
    });
  }

  function exitNow() {
    if (locked.current) return;
    locked.current = true;
    onFinish({
      level,
      reason: reason ?? "선택하지 않음",
      reasonNote: note.trim(),
      alternativeAction: alternative?.label ?? null,
      alternativeCompleted: false,
      reEntered: false,
      blocked: false,
      blockDuration: 0,
      usageSeconds,
      outcome: "exit",
    });
  }

  const levelTone =
    level === 1 ? "text-level-1" : level === 2 ? "text-level-2" : "text-level-3";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-6 md:justify-center md:px-0">
      <p className={cn("text-sm font-medium", levelTone)}>{LEVEL_SUMMARY[level]}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        오늘 누적 {formatClock(usageSeconds)}
        {sourceLabel ? ` · ${sourceLabel}` : ""}
      </p>

      {step === "reason" ? (
        <section className="mt-6 flex flex-1 flex-col">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {sourceLabel?.includes("Reels")
              ? "왜 릴스를 실행하셨나요?"
              : "왜 쇼츠를 실행하셨나요?"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            이유를 고르기 전에는 피드가 열리지 않습니다. 나가기는 선택 없이도
            됩니다.
            {sourceLabel
              ? " 나가기, 강제 종료, 시간 차단을 고르면 그 화면을 닫고 ShortsAI로 돌아갑니다."
              : ""}
          </p>
          <div className="mt-5 space-y-2" role="listbox" aria-label="실행 이유">
            {REASONS.map((item) => {
              const selected = reason === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setReason(item.id)}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3 text-left",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-secondary",
                  )}
                >
                  <span className="block text-sm font-medium">{item.id}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                </button>
              );
            })}
          </div>
          {reason === "기타" ? (
            <Textarea
              className="mt-3 min-h-20"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="이유를 짧게 적어도 됩니다."
              maxLength={80}
              aria-label="기타 이유"
            />
          ) : null}
          <div className="mt-5 flex flex-col gap-2">
            <Button
              type="button"
              className="h-12 text-base"
              disabled={!reason}
              onClick={() => {
                if (!reason) return;
                if (level === 1) {
                  setLeft(5);
                  setStep("wait");
                } else if (level === 2) {
                  setAlternative(recommendAlternative(reason));
                  setStep("alternative");
                } else {
                  setStep("warning");
                }
              }}
            >
              {level === 1 ? "5초 쉬러 가기" : level === 2 ? "대체행동 보기" : "경고 보기"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={exitNow}>
              나가기
            </Button>
          </div>
        </section>
      ) : null}

      {step === "wait" || step === "ready" || pauseDone ? (
        <section className="mt-8 flex flex-1 flex-col">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {shownStep === "wait" ? "한 박자만 쉬어 보세요." : "이제 볼 수 있습니다."}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">고른 이유 · {reason}</p>
          <p
            className="my-10 text-center text-7xl font-semibold tabular-nums"
            aria-live="polite"
          >
            {shownStep === "wait" ? left : 0}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            {shownStep === "wait"
              ? "5초가 지나기 전에는 피드가 열리지 않습니다."
              : "그래도 볼지, 여기서 끝낼지 고르세요."}
          </p>
          <div className="mt-auto flex flex-col gap-2 pt-8">
            {shownStep === "ready" ? (
              <Button
                type="button"
                className="h-12 text-base"
                onClick={() =>
                  finish({
                    reEntered: true,
                    blocked: false,
                    blockDuration: 0,
                    outcome: "watch",
                  })
                }
              >
                쇼츠 보기
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="h-11" onClick={exitNow}>
              나가기
            </Button>
            <button
              type="button"
              className="h-10 text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setStep("reason")}
            >
              이유 다시 고르기
            </button>
          </div>
        </section>
      ) : null}

      {step === "alternative" && alternative ? (
        <section className="mt-6 flex flex-1 flex-col">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            보기 전에 하나만 해볼까요.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {reason}에 맞춰 {alternative.label}을 추천합니다. 다른 행동을 골라도 됩니다.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {ALTERNATIVES.map((item) => {
              const Icon = ICONS[item.label as keyof typeof ICONS];
              const selected = alternative.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAlternative(item)}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-left",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card",
                  )}
                  aria-pressed={selected}
                >
                  <Icon className="size-4" />
                  <span className="mt-2 block text-sm font-medium">{item.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    안내 {item.seconds}초
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Button
              type="button"
              className="h-12"
              onClick={() => {
                setCompleted(false);
                setActionLeft(alternative.seconds);
                setStep("doing");
              }}
            >
              지금 해볼게요
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setCompleted(true);
                setStep("reenter");
              }}
            >
              이미 했어요
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={() => {
                setCompleted(false);
                setStep("reenter");
              }}
            >
              건너뛸게요
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={exitNow}>
              나가기
            </Button>
          </div>
        </section>
      ) : null}

      {step === "doing" && alternative && !actionDone ? (
        <section className="mt-8 flex flex-1 flex-col">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {alternative.label}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{alternative.guide}</p>
          <p className="my-8 text-center text-6xl font-semibold tabular-nums" aria-live="polite">
            {actionLeft}
          </p>
          <Progress
            value={
              alternative.seconds === 0
                ? 100
                : ((alternative.seconds - actionLeft) / alternative.seconds) * 100
            }
            aria-label="대체행동 진행"
          >
            <ProgressLabel>안내 시간</ProgressLabel>
          </Progress>
          <div className="mt-auto flex flex-col gap-2 pt-8">
            <Button
              type="button"
              className="h-12"
              onClick={() => {
                setCompleted(true);
                setStep("reenter");
              }}
            >
              완료했어요
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={exitNow}>
              나가기
            </Button>
          </div>
        </section>
      ) : null}

      {shownStep === "reenter" ? (
        <section className="mt-8 flex flex-1 flex-col">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {actionDone ? "대체행동을 마쳤습니다." : "대체행동을 건너뛰었습니다."}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {alternative?.label ?? "대체행동"} 이후에도 쇼츠를 볼지 골라 주세요. 이
            선택이 통계의 재실행 여부로 남습니다.
          </p>
          <div className="mt-auto flex flex-col gap-2 pt-8">
            <Button
              type="button"
              className="h-12 text-base"
              onClick={() =>
                finish({
                  alternativeAction: alternative?.label ?? null,
                  alternativeCompleted: actionDone,
                  reEntered: true,
                  blocked: false,
                  blockDuration: 0,
                  outcome: "watch",
                })
              }
            >
              볼래요
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() =>
                finish({
                  alternativeAction: alternative?.label ?? null,
                  alternativeCompleted: actionDone,
                  reEntered: false,
                  blocked: false,
                  blockDuration: 0,
                  outcome: "exit",
                })
              }
            >
              오늘은 여기까지
            </Button>
          </div>
        </section>
      ) : null}

      {step === "warning" ? (
        <section className="mt-6 flex flex-1 flex-col rounded-3xl bg-[oklch(0.22_0.02_45)] px-5 py-6 text-[oklch(0.96_0.012_85)]">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            오늘은 여기까지 해볼까요?
          </h1>
          <p className="mt-3 text-sm leading-6 text-[oklch(0.8_0.02_80)]">
            오늘 벌써 {formatClock(usageSeconds)} 봤어요. 한 개만 더 보려다 30분이 지나기
            쉬워요. 지금 멈추거나, 잠시 쇼츠를 잠가 둘 수 있어요.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              type="button"
              className="h-12 bg-background text-foreground hover:bg-background/90"
              onClick={() =>
                finish({
                  alternativeAction: null,
                  reEntered: false,
                  blocked: true,
                  blockDuration: minutesUntilDayEnd(dayEndHour),
                  outcome: "day-end",
                })
              }
            >
              오늘은 끝 · 내일 {dayEndHour}시까지
            </Button>
            <div className="grid grid-cols-2 gap-2">
              {BLOCK_MINUTES.map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  variant="outline"
                  className="h-11 border-white/20 bg-transparent text-[oklch(0.96_0.012_85)] hover:bg-white/10"
                  onClick={() => {
                    setBlockMinutes(minutes);
                    setStep("confirm-block");
                  }}
                >
                  {minutes === 60 ? "1시간" : `${minutes}분`} 차단
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-11 text-[oklch(0.9_0.01_85)] hover:bg-white/10"
              onClick={exitNow}
            >
              지금은 나가기
            </Button>
          </div>
        </section>
      ) : null}

      {step === "confirm-block" && blockMinutes ? (
        <section className="mt-8 flex flex-1 flex-col">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {blockMinutes === 60 ? "1시간" : `${blockMinutes}분`} 동안 막을까요?
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            이 시간이 끝나기 전에는 쇼츠 피드가 열리지 않습니다. 차단 시간은 실제
            분입니다.
          </p>
          <div className="mt-auto flex flex-col gap-2 pt-8">
            <Button
              type="button"
              className="h-12"
              onClick={() =>
                finish({
                  alternativeAction: null,
                  reEntered: false,
                  blocked: true,
                  blockDuration: blockMinutes,
                  outcome: "timed-block",
                })
              }
            >
              {blockMinutes === 60 ? "1시간" : `${blockMinutes}분`} 동안 막기
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setStep("warning")}
            >
              다시 고르기
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
