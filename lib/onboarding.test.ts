import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLUSTERS } from "./clusters.ts";
import { applyOnboarding, DAILY_CHOICES, nearestCluster, needsOnboarding, skipOnboarding } from "./onboarding.ts";
import { goalMinutesOn, todayKey } from "./logic.ts";
import { buildPolicy } from "./policy.ts";
import { learn, modelState, riskScore } from "./risk.ts";
import { START_MODEL } from "./risk-model.ts";
import { defaultData, readSettings } from "./storage.ts";

describe("onboarding", () => {
  it("picks the nearest type the same way as the server function", () => {
    // 서버 시험(scripts/server/test_supabase_sql.py)에서 sai_onboarding(150, 'night') = C_stress
    assert.equal(nearestCluster(150, "night").id, "C_stress");
    assert.equal(nearestCluster(15, "evening").id, "E_trying");
    assert.deepEqual(DAILY_CHOICES.map((c) => c.minutes), [15, 45, 90, 150]);
  });

  it("asks only on a fresh install, never again after an answer or a skip", () => {
    const fresh = defaultData();
    assert.equal(needsOnboarding(fresh), true);
    assert.equal(needsOnboarding(skipOnboarding(fresh)), false);
    // 예전 버전에서 쓰던 설정(이 칸이 없음)은 이미 쓰던 사람이라 묻지 않는다
    assert.equal(readSettings({ level3Threshold: 20 }).onboardingDone, true);
  });

  it("starts with that type's goal and model, and learning pulls toward it", () => {
    const cluster = CLUSTERS.find((c) => c.id === "A_night")!;
    const next = applyOnboarding(defaultData(), cluster, cluster.suggestedGoal);
    assert.equal(next.settings.level3Threshold, cluster.suggestedGoal);
    assert.equal(next.settings.cluster, "A_night");
    assert.equal(next.settings.onboardingDone, true);
    // 오늘부터 바로 그 목표 (목표를 올리면 내일부터라는 규칙은 새 설치에는 쓰지 않는다)
    assert.equal(goalMinutesOn(next, todayKey()), cluster.suggestedGoal);
    const state = modelState(next);
    assert.deepEqual(state.weights, [...cluster.model.weights]);
    assert.equal(buildPolicy(next.settings, next).ai.model?.bias, cluster.model.bias);
    // 학습은 시작 모델이 아니라 이 유형 쪽으로 당긴다 (반대로 배워도 이 유형 근처에 머문다)
    const raw = [...START_MODEL.checks[0].raw];
    let s = state;
    for (let i = 0; i < 5; i++) s = learn(s, raw, false, "t");
    assert.deepEqual(s.start?.weights, [...cluster.model.weights]);
    assert.ok(riskScore(s, raw) < riskScore(state, raw));
  });

  it("keeps the user's own goal if they change it", () => {
    const cluster = CLUSTERS[0];
    assert.equal(applyOnboarding(defaultData(), cluster, 25).settings.level3Threshold, 25);
    assert.equal(applyOnboarding(defaultData(), cluster, 0).settings.level3Threshold, cluster.suggestedGoal);
  });
});
