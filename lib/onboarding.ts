/**
 * 처음 설치할 때 질문 3개 (사용자 확인 2026-10-26, docs/server/DESIGN.md 6장).
 * 평소 하루 사용과 주로 보는 시간대로 가장 비슷한 유형(lib/clusters.ts)을 폰 안에서 고른다.
 * 서버로는 아무것도 보내지 않는다. 고른 유형의 시작 모델과 추천 목표로 시작한다.
 * 계산은 supabase/shortsai_v1.sql의 sai_onboarding과 같다.
 */
import { CLUSTERS } from "./clusters.ts";
import { GOAL_SINCE_START } from "./logic.ts";
import { startState } from "./risk.ts";
import { settingsFromGoal } from "./storage.ts";
import type { AppData } from "./types.ts";

export type Slot = "morning" | "day" | "evening" | "night";
export type Cluster = (typeof CLUSTERS)[number];

/** 질문 1 보기와 그 가운데 값(분). */
export const DAILY_CHOICES = [
  { label: "30분 미만", minutes: 15 },
  { label: "30분~1시간", minutes: 45 },
  { label: "1~2시간", minutes: 90 },
  { label: "2시간 넘게", minutes: 150 },
] as const;

export const SLOT_CHOICES: { label: string; slot: Slot }[] = [
  { label: "아침", slot: "morning" },
  { label: "낮", slot: "day" },
  { label: "저녁", slot: "evening" },
  { label: "밤", slot: "night" },
];

export const ONBOARDING_COPY = {
  title: "나에게 맞게 시작할게요",
  body: "세 가지만 알려 주세요. 비슷한 사람들의 기록으로 첫날부터 맞춰 드려요.",
  daily: "평소 하루에 쇼츠·릴스를 얼마나 보나요?",
  slot: "주로 언제 보나요?",
  goal: (suggested: number) => `하루 목표는 몇 분으로 할까요? (추천 ${suggested}분, 바꿀 수 있어요)`,
  result: (name: string) => `${name}과 비슷해요. 이 유형에 맞춰 시작할게요.`,
  start: "시작하기",
  skip: "건너뛰기",
};

/** 가장 비슷한 유형: 하루 사용 차이(시간 단위)² + (1 − 그 시간대 비율)²이 가장 작은 것. */
export function nearestCluster(dailyMinutes: number, slot: Slot): Cluster {
  let best: Cluster = CLUSTERS[0];
  let bestDistance = Infinity;
  for (const c of CLUSTERS) {
    const distance = ((dailyMinutes - c.centroid.minutes) / 60) ** 2 + (1 - c.centroid[slot]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = c;
    }
  }
  return best;
}

/** 처음 질문을 보여 줄지: 아직 안 했고, 기록이 하나도 없을 때 (새로 설치). */
export function needsOnboarding(data: AppData): boolean {
  return !data.settings.onboardingDone && data.usageLogs.length === 0 && data.interventions.length === 0;
}

/**
 * 답을 반영한 새 상태: 목표, 고른 유형, 그 유형의 시작 모델 (폰 학습은 이 가중치 쪽으로 당긴다).
 * goal이 범위를 벗어나면 유형의 추천 목표를 쓴다.
 */
export function applyOnboarding(data: AppData, cluster: Cluster, goal: number): AppData {
  const minutes = Number.isInteger(goal) && goal >= 1 && goal <= 360 ? goal : cluster.suggestedGoal;
  const settings = settingsFromGoal(minutes, {
    ...data.settings,
    finalGoal: Math.min(data.settings.finalGoal, minutes),
    onboardingDone: true,
    cluster: cluster.id,
  });
  // 기록이 없는 새 설치라 "목표를 올리면 내일부터" 규칙을 쓰지 않고, 고른 목표를 처음부터 쓴다.
  const goalLog = [{ from: GOAL_SINCE_START, minutes }];
  const start = { weights: [...cluster.model.weights], bias: cluster.model.bias };
  const riskModel = { ...startState(), weights: [...start.weights], bias: start.bias, start };
  return { ...data, settings, goalLog, riskModel };
}

/** 건너뛰기: 지금처럼 기본값으로 시작한다. */
export function skipOnboarding(data: AppData): AppData {
  return { ...data, settings: { ...data.settings, onboardingDone: true } };
}
