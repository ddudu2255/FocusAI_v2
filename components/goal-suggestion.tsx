"use client";

import { Button } from "@/components/ui/button";
import { useStore } from "@/components/store";
import { goalSuggestion } from "@/lib/ai";
import { settingsFromGoal } from "@/lib/storage";

/**
 * AI 주간 목표 제안 (홈). 지난주 목표를 지킨 날이 5일 이상이면 2~5분 줄이자고 제안하고,
 * 최종 목표에 닿았으면 유지 단계라고 알린다. 한 주에 한 번, 사용자가 답하면 사라진다.
 * 문구는 사용자 확인 완료 (docs/HANDOFF.md).
 */
export function GoalSuggestionCard() {
  const { data, saveSettings } = useStore();
  if (!data || !data.settings.aiEnabled) return null;
  const suggestion = goalSuggestion(data);
  if (!suggestion || data.settings.goalWeekAnswered === suggestion.week) return null;
  const settings = data.settings;

  function answer(accept: boolean) {
    if (!suggestion) return;
    const next =
      accept && suggestion.reduce
        ? settingsFromGoal(suggestion.suggested, { ...settings, goalWeekAnswered: suggestion.week })
        : { ...settings, goalWeekAnswered: suggestion.week };
    saveSettings(next);
  }

  return (
    <section className="space-y-3 rounded-3xl bg-secondary px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">AI 이번 주 제안</p>
      {suggestion.reduce ? (
        <>
          <p className="text-base leading-7">
            지난주 {suggestion.keptDays}일 동안 목표 {suggestion.current}분을 지켰어요. 이번 주는{" "}
            <strong>{suggestion.suggested}분</strong>으로 줄여 볼까요?
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="h-11" onClick={() => answer(true)}>
              {suggestion.suggested}분으로 할게요
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={() => answer(false)}>
              이번 주는 그대로
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base leading-7">
            최종 목표 {suggestion.current}분에 닿았어요. 이제는 지키는 단계예요. 지난주{" "}
            {suggestion.keptDays}일을 지켰어요.
          </p>
          <Button type="button" className="h-11" onClick={() => answer(false)}>
            좋아요
          </Button>
        </>
      )}
    </section>
  );
}
