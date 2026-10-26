"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/components/store";
import { cn } from "@/lib/utils";
import {
  DAILY_CHOICES,
  nearestCluster,
  needsOnboarding,
  ONBOARDING_COPY,
  SLOT_CHOICES,
  type Slot,
} from "@/lib/onboarding";

/** 처음 설치할 때 한 번: 질문 3개로 비슷한 유형을 골라 그 시작값으로 시작한다 (서버로 보내지 않음). */
export function Onboarding() {
  const { ready, data, finishOnboarding } = useStore();
  const [daily, setDaily] = useState<number | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [goalText, setGoalText] = useState<string | null>(null);

  if (!ready || !data || !needsOnboarding(data)) return null;
  const cluster = daily !== null && slot !== null ? nearestCluster(daily, slot) : null;
  const goal = goalText === null ? (cluster?.suggestedGoal ?? data.settings.level3Threshold) : Number(goalText);
  const goalOk = Number.isInteger(goal) && goal >= 1 && goal <= 360;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-md space-y-5 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="space-y-1">
          <h2 id="onboarding-title" className="text-xl font-semibold tracking-tight">
            {ONBOARDING_COPY.title}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">{ONBOARDING_COPY.body}</p>
        </div>

        <Choices
          title={ONBOARDING_COPY.daily}
          options={DAILY_CHOICES.map((c) => ({ label: c.label, value: c.minutes }))}
          value={daily}
          onChange={setDaily}
        />
        <Choices
          title={ONBOARDING_COPY.slot}
          options={SLOT_CHOICES.map((c) => ({ label: c.label, value: c.slot }))}
          value={slot}
          onChange={setSlot}
        />

        {cluster ? (
          <div className="space-y-2">
            <label htmlFor="onboarding-goal" className="text-sm font-medium">
              {ONBOARDING_COPY.goal(cluster.suggestedGoal)}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="onboarding-goal"
                inputMode="numeric"
                className="h-11 w-28"
                value={goalText ?? String(cluster.suggestedGoal)}
                onChange={(e) => setGoalText(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <span className="text-sm text-muted-foreground">분</span>
            </div>
            <p className="rounded-2xl bg-secondary px-3 py-2 text-sm leading-6">{ONBOARDING_COPY.result(cluster.name)}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            className="h-11"
            disabled={!cluster || !goalOk}
            onClick={() => cluster && finishOnboarding(cluster, goal)}
          >
            {ONBOARDING_COPY.start}
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => finishOnboarding(null, 0)}>
            {ONBOARDING_COPY.skip}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Choices<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { label: string; value: T }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={title}>
      <p className="text-sm font-medium">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-11 rounded-xl px-3 text-sm ring-1 ring-foreground/10 transition-colors",
              value === option.value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-secondary",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
