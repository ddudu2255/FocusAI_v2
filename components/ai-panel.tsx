"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/components/store";
import {
  banditTables,
  hourLabel,
  MIN_DAYS_FOR_RISK,
  recordedDays,
  riskHours,
  type TimeSlot,
} from "@/lib/ai";

const SLOT_LABEL: Record<TimeSlot, string> = {
  morning: "아침",
  day: "낮",
  evening: "저녁",
  night: "밤",
};

const METHOD_LABEL: Record<string, string> = {
  pause: "5초 숨 고르기",
  framing: "시간 체감 문구",
  breath: "호흡 따라 하기",
  alternative: "대체행동",
  reflection: "성찰 질문",
  card: "공부 카드",
};

/**
 * 시간대별로 가장 잘 먹힌 방식 (기록 3번 이상인 것만).
 * 그 칸에서 직접 쌓인 기록만 본다 (다른 칸에서 빌려 온 값은 섞지 않는다).
 */
function bestBySlot(counts: Record<string, Record<string, [number, number]>>) {
  const bySlot = new Map<string, { arm: string; mean: number; n: number }>();
  for (const [context, arms] of Object.entries(counts)) {
    const slot = context.split(":")[1] ?? "";
    for (const [arm, [s, f]] of Object.entries(arms)) {
      const n = s + f;
      if (n < 3) continue;
      const mean = (s + 1) / (n + 2);
      const prev = bySlot.get(slot);
      if (!prev || mean > prev.mean) bySlot.set(slot, { arm, mean, n });
    }
  }
  return bySlot;
}

/**
 * 설정의 AI 패널. 켜기/끄기(AI 전후 비교용), 엄격 모드, 그리고 AI가 지금까지 배운 것을
 * 그대로 보여 준다 (설명 가능성: 왜 이렇게 개입하는지 사용자가 볼 수 있게).
 */
export function AiPanel() {
  const { data, saveSettings } = useStore();
  if (!data) return null;
  const settings = data.settings;
  const days = recordedDays(data);
  const risk = settings.aiEnabled ? riskHours(data) : null;
  const tables = settings.aiEnabled ? banditTables(data) : null;
  const best = tables ? bestBySlot(tables.ownMethods) : new Map();
  const feedbackCount = data.interventions.filter((log) => log.feedback !== null).length;

  return (
    <section className="space-y-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="ai-enabled" className="text-base font-medium">
            AI 개인화
          </Label>
          <p className="text-sm leading-6 text-muted-foreground">
            내 기록을 보고, 나에게 잘 맞는 개입 방식과 문구를 고르고, 평소 오래 보는 시간에는
            조금 더 짧게 잡습니다. 계산은 모두 이 폰 안에서 하고, 기록은 밖으로 보내지 않습니다.
            끄면 정해진 규칙대로 번갈아 보여 줍니다.
          </p>
        </div>
        <Switch
          id="ai-enabled"
          checked={settings.aiEnabled}
          aria-label="AI 개인화"
          onCheckedChange={(checked) => saveSettings({ ...settings, aiEnabled: Boolean(checked) })}
        />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="strict-mode" className="text-base font-medium">
            엄격 모드
          </Label>
          <p className="text-sm leading-6 text-muted-foreground">
            켜면 약속 시간을 늘리는 &quot;조금 더 볼래요&quot;와 목표를 넘긴 뒤 &quot;3분만 더&quot;가
            사라집니다. 스스로 정한 약속을 더 단단하게 지키고 싶을 때 켜세요.
          </p>
        </div>
        <Switch
          id="strict-mode"
          checked={settings.strictMode}
          aria-label="엄격 모드"
          onCheckedChange={(checked) => saveSettings({ ...settings, strictMode: Boolean(checked) })}
        />
      </div>

      {settings.aiEnabled ? (
        <div className="space-y-2 rounded-2xl bg-background px-4 py-3 text-sm leading-6 ring-1 ring-foreground/10">
          <p className="font-medium">AI가 지금까지 배운 것</p>
          <p className="text-muted-foreground">
            지난 2주 중 기록이 있는 날: {days}일
            {days < MIN_DAYS_FOR_RISK
              ? ` (평소 오래 보는 시간은 ${MIN_DAYS_FOR_RISK}일 이상 쌓이면 찾기 시작해요)`
              : ""}
          </p>
          <p>
            평소 오래 보는 시간:{" "}
            {risk ? risk.hours.map(hourLabel).join(", ") : "아직 찾지 못했어요"}
          </p>
          {(["morning", "day", "evening", "night"] as TimeSlot[]).map((slot) => {
            const top = best.get(slot);
            return (
              <p key={slot} className="text-muted-foreground">
                {SLOT_LABEL[slot]}: {top ? `${METHOD_LABEL[top.arm] ?? top.arm}이(가) 잘 맞았어요 (멈춘 비율 ${Math.round(top.mean * 100)}%)` : "아직 배우는 중이에요"}
              </p>
            );
          })}
          <p className="text-muted-foreground">
            처음 몇 주는 여러 방식을 골고루 보여 주며 배웁니다. 남겨 주신 &quot;도움 됐어요&quot; 답:{" "}
            {feedbackCount}개
          </p>
        </div>
      ) : null}
    </section>
  );
}
