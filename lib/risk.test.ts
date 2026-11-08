import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIGHTEN_PRIOR, tightenTable } from "./ai.ts";
import { convertNativeBatch } from "./logic.ts";
import { buildPolicy } from "./policy.ts";
import {
  bandsFor,
  DEFAULT_KEPT7,
  keepingGoal,
  wasLimited,
  quantile,
  RELATIVE_BANDS,
  RAW_FEATURES,
  kept7,
  learn,
  modelState,
  needsRelearn,
  relearnOpenLogs,
  riskBand,
  riskScore,
  settleOpenLogs,
  startState,
  transform,
} from "./risk.ts";
import { START_MODEL } from "./risk-model.ts";
import { defaultData, readIntervention, readOpenLog, readRiskModel } from "./storage.ts";
import type { AppData, InterventionLog, OpenLog, UsageLog } from "./types.ts";

const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);

function session(id: string, start: Date, minutes: number, openId: string | null = null): UsageLog {
  return {
    openId,
    usageId: id,
    date: `2026-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
    duration: minutes * 60,
    clipCount: 1,
    target: "youtube",
    source: "native",
  };
}

function open(id: string, start: Date, features: number[] = [...START_MODEL.checks[0].raw]): OpenLog {
  const log = readOpenLog({
    id,
    createdAt: start.toISOString(),
    features,
    score: 0.1,
    band: "low",
    modelVersion: START_MODEL.version,
  });
  assert.ok(log);
  return log;
}

function row(partial: Partial<InterventionLog> & { interventionId: string; timestamp: string }): InterventionLog {
  const log = readIntervention({
    date: partial.timestamp.slice(0, 10),
    level: 2,
    reason: "습관적으로",
    outcome: "exit",
    stage: "entry",
    ...partial,
  });
  assert.ok(log);
  return { ...log, ...partial } as InterventionLog;
}

describe("risk model score", () => {
  it("gives the same probabilities as the Python export", () => {
    for (const check of START_MODEL.checks) {
      assert.equal(check.raw.length, RAW_FEATURES.length);
      assert.ok(Math.abs(riskScore(startState(), check.raw) - check.p) < 1e-6, `p=${check.p}`);
    }
  });

  it("treats an unknown reason as the average reason", () => {
    const x = transform([22, 0, 0.5, 3, 10, 0.2, 1e4, 0.5, 0.8, -1]);
    assert.deepEqual(x.slice(-5), START_MODEL.mean.slice(-5));
  });

  it("caps 'no record' minutes and ratios", () => {
    const capped = transform([22, 0, 9, 3, 1e4, 9, 1e4, 9, 0.8, 0]);
    const same = transform([22, 0, 3, 3, START_MODEL.cap, 3, START_MODEL.cap, 3, 0.8, 0]);
    assert.deepEqual(capped, same);
  });

  it("splits scores into bands at the start model's fixed 17% and 30%", () => {
    assert.deepEqual(START_MODEL.bands, [0.17, 0.3]);
    assert.equal(riskBand(0.16), "low");
    assert.equal(riskBand(0.17), "medium");
    assert.equal(riskBand(0.29), "medium");
    assert.equal(riskBand(0.3), "high");
  });

  it("rises after watching more of the goal", () => {
    const base = [21, 0, 0.1, 2, 60, 0.1, 1e4, 0.3, 0.75, 1];
    const later = [...base];
    later[2] = 1.2;
    assert.ok(riskScore(startState(), later) > riskScore(startState(), base));
  });
});

describe("learning on the phone", () => {
  it("moves the score toward the answer", () => {
    const raw = [...START_MODEL.checks[0].raw];
    const before = riskScore(startState(), raw);
    let up = startState();
    let down = startState();
    for (let i = 0; i < 20; i += 1) {
      up = learn(up, raw, true, "t");
      down = learn(down, raw, false, "t");
    }
    assert.ok(riskScore(up, raw) > before);
    assert.ok(riskScore(down, raw) < before);
    assert.equal(up.updates, 20);
  });

  it("falls back to the start model when the stored state does not fit", () => {
    assert.deepEqual(modelState({ riskModel: null }), startState());
    const wrong = readRiskModel({ version: "lr-0", weights: [1, 2], bias: 0 });
    assert.deepEqual(modelState({ riskModel: wrong }), startState());
    assert.equal(readRiskModel({ version: "lr-1", weights: ["x"], bias: 0 }), null);
  });

  it("labels an open from all the watching it led to, against half the day's goal", () => {
    const data: AppData = {
      ...defaultData(),
      openLogs: [open("o1", at(10, 20, 22)), open("o2", at(10, 20, 23)), open("o3", at(10, 20, 23, 30))],
      usageLogs: [
        // 목표 20분 → 절반 10분. o1: 7분 + 연장 5분 = 12분
        session("s1", at(10, 20, 22, 1), 7, "o1"),
        session("s1b", at(10, 20, 22, 8), 5, "o1"),
        session("s2", at(10, 20, 23, 1), 4, "o2"),
        session("free", at(10, 20, 21), 30, null),
      ],
    };
    const result = settleOpenLogs(data, at(10, 20, 23, 35).getTime());
    const byId = new Map(result.data.openLogs.map((o) => [o.id, o]));
    assert.equal(byId.get("o1")?.label, true);
    assert.equal(byId.get("o1")?.durationSec, 720);
    // 다음 열기(o3)가 있으니 o2는 끝났다: 4분 → 오래 안 봄
    assert.equal(byId.get("o2")?.label, false);
    // o3: 바로 나갔지만 아직 30분이 안 지났다
    assert.equal(byId.get("o3")?.label, null);
    assert.equal(result.modelChanged, true);
    assert.equal(result.data.riskModel?.updates, 2);
    // 다시 돌려도 이미 정한 정답은 고치지 않는다.
    assert.equal(settleOpenLogs(result.data, at(10, 20, 23, 35).getTime()).changed.length, 0);
  });

  it("closes the last open after 30 quiet minutes, unless something is playing", () => {
    const data: AppData = {
      ...defaultData(),
      openLogs: [open("o1", at(10, 20, 22))],
      usageLogs: [session("s1", at(10, 20, 22, 1), 3, "o1")],
    };
    // 마지막 시청이 22:04에 끝남
    assert.equal(settleOpenLogs(data, at(10, 20, 22, 30).getTime()).changed.length, 0);
    assert.equal(settleOpenLogs(data, at(10, 20, 22, 40).getTime(), true).changed.length, 0);
    const done = settleOpenLogs(data, at(10, 20, 22, 40).getTime());
    assert.equal(done.data.openLogs[0].label, false);
    assert.equal(done.data.openLogs[0].durationSec, 180);
  });

  it("uses the goal of that day", () => {
    const data: AppData = {
      ...defaultData(),
      goalLog: [{ from: "0000-01-01", minutes: 40 }],
      openLogs: [open("o1", at(10, 20, 22))],
      usageLogs: [session("s1", at(10, 20, 22), 12, "o1")],
    };
    assert.equal(settleOpenLogs(data, at(10, 20, 22, 20).getTime()).changed.length, 0);
    assert.equal(settleOpenLogs(data, at(10, 20, 23).getTime()).data.openLogs[0].label, false);
  });

  it("labels but does not learn from opens held to 3 minutes", () => {
    const limited = { ...open("o1", at(10, 20, 22)), band: "high" as const, tighten: "full" as const };
    const suggested = { ...open("o2", at(10, 20, 23)), band: "high" as const, tighten: "soft" as const };
    const data: AppData = {
      ...defaultData(),
      openLogs: [limited, suggested],
      usageLogs: [session("s1", at(10, 20, 22), 3, "o1"), session("s2", at(10, 20, 23), 12, "o2")],
    };
    const result = settleOpenLogs(data, at(10, 20, 23, 20).getTime());
    assert.deepEqual(result.data.openLogs.map((o) => o.label), [false, true]);
    // 추천만 붙은 o2에서만 배운다.
    assert.equal(result.data.riskModel?.updates, 1);
  });

  it("labels but does not learn from opens of another model version", () => {
    const data: AppData = {
      ...defaultData(),
      openLogs: [{ ...open("o1", at(10, 20, 22)), modelVersion: "lr-0" }],
      usageLogs: [session("s1", at(10, 20, 22), 12, "o1")],
    };
    const result = settleOpenLogs(data, at(10, 20, 22, 20).getTime());
    assert.equal(result.data.openLogs[0].label, true);
    assert.equal(result.modelChanged, false);
    assert.equal(result.data.riskModel, null);
  });
});

describe("label: watching from the open to 30 minutes after it (lr-2)", () => {
  it("counts quick reopens in the window, so cutting viewing into pieces still counts", () => {
    // 목표 20분 → 절반 10분. 3분씩 보고 금방 다시 연다: 열기 하나는 3분이지만 30분 안에 12분
    const data: AppData = {
      ...defaultData(),
      openLogs: [open("o1", at(10, 20, 22)), open("o2", at(10, 20, 22, 5)), open("o3", at(10, 20, 22, 10)), open("o4", at(10, 20, 22, 15))],
      usageLogs: [
        session("s1", at(10, 20, 22), 3, "o1"),
        session("s2", at(10, 20, 22, 5), 3, "o2"),
        session("s3", at(10, 20, 22, 10), 3, "o3"),
        session("s4", at(10, 20, 22, 15), 3, "o4"),
      ],
    };
    const result = settleOpenLogs(data, at(10, 20, 22, 20).getTime());
    const o1 = result.data.openLogs.find((o) => o.id === "o1");
    assert.equal(o1?.label, true);
    assert.equal(o1?.durationSec, 180); // 이 열기 자체에서 본 시간
  });

  it("waits until the window is over even when a later open exists", () => {
    const data: AppData = {
      ...defaultData(),
      openLogs: [open("o1", at(10, 20, 22)), open("o2", at(10, 20, 22, 10))],
      usageLogs: [session("s1", at(10, 20, 22), 2, "o1"), session("s2", at(10, 20, 22, 10), 2, "o2")],
    };
    // o1의 구간은 22:32까지. 그 전에는 다음 열기가 있어도 정하지 않는다.
    assert.equal(settleOpenLogs(data, at(10, 20, 22, 20).getTime()).changed.length, 0);
    const done = settleOpenLogs(data, at(10, 20, 22, 33).getTime());
    assert.equal(done.data.openLogs.find((o) => o.id === "o1")?.label, false);
  });

  it("does not learn when an open held to 3 minutes is inside the window", () => {
    const limited = { ...open("o2", at(10, 20, 22, 5)), band: "high" as const, tighten: "full" as const };
    const data: AppData = {
      ...defaultData(),
      openLogs: [open("o1", at(10, 20, 22)), limited],
      usageLogs: [session("s1", at(10, 20, 22), 2, "o1"), session("s2", at(10, 20, 22, 5), 3, "o2")],
    };
    const result = settleOpenLogs(data, at(10, 20, 23, 30).getTime());
    assert.deepEqual(result.data.openLogs.map((o) => o.label), [false, false]);
    assert.equal(result.modelChanged, false);
  });

  it("splits learning between opens that share a window", () => {
    const one: AppData = {
      ...defaultData(),
      openLogs: [open("o1", at(10, 20, 22))],
      usageLogs: [session("s1", at(10, 20, 22), 2, "o1")],
    };
    const two: AppData = {
      ...one,
      openLogs: [...one.openLogs, open("o2", at(10, 20, 22, 5))],
      usageLogs: [...one.usageLogs, session("s2", at(10, 20, 22, 5), 2, "o2")],
    };
    const alone = settleOpenLogs(one, at(10, 20, 23).getTime()).data.riskModel!;
    const shared = settleOpenLogs(two, at(10, 20, 23).getTime()).data.riskModel!;
    const start = startState();
    // o1 혼자면 한 번 배우고, o2와 구간을 나누면 o1은 절반만 배운다.
    const moveAlone = Math.abs(alone.bias - start.bias);
    const moveFirstShared = Math.abs(learn(start, open("x", at(10, 20, 22)).features, false, "", 0.5).bias - start.bias);
    assert.ok(moveFirstShared < moveAlone);
    assert.equal(shared.updates, 2);
  });
});

describe("relearning once after the model changes", () => {
  it("is needed only while an older model's state is stored", () => {
    assert.equal(needsRelearn({ riskModel: null, openLogs: [] }), false);
    assert.equal(needsRelearn({ riskModel: { ...startState(), version: "lr-1" }, openLogs: [] }), true);
    assert.equal(needsRelearn({ riskModel: startState(), openLogs: [] }), false);
    const old = { ...open("o1", at(10, 20, 22)), modelVersion: "lr-1", label: false };
    assert.equal(needsRelearn({ riskModel: null, openLogs: [old] }), true);
  });

  it("relabels old opens with the new label and learns them from the new start", () => {
    const old = (id: string, when: Date) => ({ ...open(id, when), modelVersion: "lr-1", label: false, durationSec: 180 });
    const data: AppData = {
      ...defaultData(),
      riskModel: { ...startState(), version: "lr-1", updates: 9 },
      openLogs: [old("o1", at(10, 20, 22)), old("o2", at(10, 20, 22, 5)), old("o3", at(10, 20, 22, 10)), old("o4", at(10, 20, 22, 15))],
      usageLogs: [
        session("s1", at(10, 20, 22), 3, "o1"),
        session("s2", at(10, 20, 22, 5), 3, "o2"),
        session("s3", at(10, 20, 22, 10), 3, "o3"),
        session("s4", at(10, 20, 22, 15), 3, "o4"),
      ],
    };
    const start = { weights: START_MODEL.weights.map((w) => w * 0.5), bias: -2 };
    const result = relearnOpenLogs(data, start, at(10, 20, 23, 30).getTime());
    assert.equal(result.data.riskModel?.version, START_MODEL.version);
    assert.equal(result.data.riskModel?.updates, 4);
    assert.deepEqual(result.data.riskModel?.start?.bias, -2);
    // 12분 / 목표 20분: o1(22:00~22:33 구간)은 새 정답으로 오래 봄
    assert.equal(result.data.openLogs[0].label, true);
    assert.ok(result.changed.some((o) => o.id === "o1"));
    assert.equal(needsRelearn(result.data), false);
  });
});

describe("relative bands after the model changes", () => {
  it("rescored opens from the older model with the current one instead of mixing scales", () => {
    const now = at(10, 28, 23);
    const older = Array.from({ length: 60 }, (_, i) => ({
      ...open(`o${i}`, new Date(now.getTime() - (i + 1) * 3_600_000)),
      modelVersion: "lr-1",
      score: 0.001, // 옛 모델의 낮은 점수
    }));
    const [medium] = bandsFor({ openLogs: older, riskModel: null }, now);
    // 옛 점수(0.1%)로 정했다면 바닥값 2%가 됐을 것. 지금 모델로 다시 낸 점수의 분위여야 한다.
    const rescored = riskScore(startState(), older[0].features);
    assert.ok(Math.abs(medium - Math.max(RELATIVE_BANDS.floor[0], rescored)) < 1e-9);
  });
});

describe("relative bands", () => {
  const now = at(10, 20, 12);
  const scored = (n: number, score: (i: number) => number, days = 3) =>
    Array.from({ length: n }, (_, i) => ({
      ...open(`o${i}`, new Date(now.getTime() - ((i % (days * 24)) + 1) * 3_600_000)),
      score: score(i),
    }));

  it("uses the fixed start bands until enough opens", () => {
    const data = { openLogs: scored(RELATIVE_BANDS.minHistory - 1, () => 0.5) };
    assert.deepEqual(bandsFor(data, now), [...START_MODEL.bands]);
  });

  it("takes this person's top 15% and 5% of recent scores", () => {
    // 0.00, 0.01, …, 0.99 → 85% 지점 0.8415, 95% 지점 0.9405
    const data = { openLogs: scored(100, (i) => i / 100) };
    const [medium, high] = bandsFor(data, now);
    assert.ok(Math.abs(medium - 0.8415) < 1e-9);
    assert.ok(Math.abs(high - 0.9405) < 1e-9);
  });

  it("never asks below the floor, so ordinary moments stay untouched", () => {
    const data = { openLogs: scored(200, (i) => 0.005 + (i % 10) / 1000) };
    assert.deepEqual(bandsFor(data, now), [...RELATIVE_BANDS.floor]);
  });

  it("ignores opens older than 14 days", () => {
    const old = scored(100, () => 0.9).map((o) => ({ ...o, createdAt: at(9, 1, 12).toISOString() }));
    assert.deepEqual(bandsFor({ openLogs: old }, now), [...START_MODEL.bands]);
  });

  it("matches numpy's quantile", () => {
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(quantile([5], 0.95), 5);
  });
});

describe("keeping the goal", () => {
  const now = at(10, 20, 12);
  // 목표 20분. 10월 13~19일이 오늘(20일) 전 7일.
  const days = (minutes: (day: number) => number, from = 13) =>
    Array.from({ length: 20 - from }, (_, i) => session(`d${from + i}`, at(10, from + i, 21), minutes(from + i)));

  it("is true when every one of the last 7 days stayed within the goal", () => {
    assert.equal(keepingGoal({ ...defaultData(), usageLogs: days(() => 18) }, now), true);
  });

  it("is false after a single missed day", () => {
    assert.equal(keepingGoal({ ...defaultData(), usageLogs: days((d) => (d === 17 ? 25 : 15)) }, now), false);
  });

  it("does not count today", () => {
    const usageLogs = [...days(() => 15), session("today", at(10, 20, 9), 40)];
    assert.equal(keepingGoal({ ...defaultData(), usageLogs }, now), true);
  });

  it("needs 7 days of records first", () => {
    assert.equal(keepingGoal({ ...defaultData(), usageLogs: days(() => 5, 15) }, now), false);
    assert.equal(keepingGoal(defaultData(), now), false);
  });

  it("uses each day's goal", () => {
    const data = { ...defaultData(), goalLog: [{ from: "0000-01-01", minutes: 30 }], usageLogs: days(() => 25) };
    assert.equal(keepingGoal(data, now), true);
  });

  it("is sent with the model, and a softened open is not a limited one", () => {
    const data = { ...defaultData(), usageLogs: days(() => 10) };
    assert.equal(buildPolicy(data.settings, data, now).ai.model?.keepingGoal, true);
    assert.equal(wasLimited({ band: "high", tighten: "full", keeping: false }), true);
    assert.equal(wasLimited({ band: "high", tighten: "full", keeping: true }), false);
  });
});

describe("kept7", () => {
  it("is the share of kept commitments in the 7 days before today", () => {
    const now = at(10, 20, 12);
    const end = (id: string, when: Date, outcome: InterventionLog["outcome"]) =>
      row({ interventionId: id, timestamp: when.toISOString(), stage: "commit_end", outcome });
    const data = {
      interventions: [
        end("a", at(10, 14, 21), "kept"),
        end("b", at(10, 15, 21), "kept"),
        end("c", at(10, 16, 21), "extend"),
        end("d", at(10, 19, 23), "kept"),
        end("today", at(10, 20, 9), "extend"),
        end("old", at(10, 12, 21), "extend"),
        row({ interventionId: "entry", timestamp: at(10, 18, 21).toISOString(), stage: "entry", outcome: "exit" }),
      ],
    };
    assert.equal(kept7(data, now), 3 / 4);
    assert.equal(kept7({ interventions: [] }, now), DEFAULT_KEPT7);
  });
});

describe("tighten bandit", () => {
  it("starts leaning toward the decided behaviour", () => {
    const table = tightenTable(defaultData(), at(10, 20, 12));
    assert.deepEqual(table.high.full, [...TIGHTEN_PRIOR.full]);
    assert.deepEqual(table.medium.soft, [...TIGHTEN_PRIOR.soft]);
  });

  it("learns from how much was watched afterwards", () => {
    const now = at(10, 20, 12);
    const t = at(10, 19, 22);
    const data: AppData = {
      ...defaultData(),
      interventions: [
        row({ interventionId: "x", timestamp: t.toISOString(), riskBand: "high", tighten: "soft" }),
        row({ interventionId: "y", timestamp: at(10, 19, 20).toISOString(), riskBand: "low", tighten: null }),
      ],
      // soft를 쓴 뒤 15분 넘게 봤다 → 보상 0
      usageLogs: [session("w", t, 20)],
    };
    const [a, b] = tightenTable(data, now).high.soft;
    assert.equal(a, TIGHTEN_PRIOR.soft[0]);
    assert.ok(b > TIGHTEN_PRIOR.soft[1]);
  });
});

describe("policy and native rows", () => {
  it("ships the model only when AI is on", () => {
    const data = defaultData();
    const on = buildPolicy(data.settings, data);
    assert.equal(on.ai.model?.version, START_MODEL.version);
    assert.equal(on.ai.model?.kept7, DEFAULT_KEPT7);
    assert.deepEqual(on.ai.model?.bands, [0.17, 0.3]);
    assert.deepEqual(on.ai.risk, { commitMax: 3, overdraftWaitSec: 10 });
    assert.ok(on.ai.tighten.high);
    const off = buildPolicy({ ...data.settings, aiEnabled: false }, data);
    assert.equal(off.ai.model, null);
    assert.deepEqual(off.ai.tighten, {});
  });

  it("ships the weights learned on the phone", () => {
    const data = { ...defaultData(), riskModel: { ...startState(), bias: -1, updates: 3 } };
    assert.equal(buildPolicy(data.settings, data).ai.model?.bias, -1);
  });

  it("reads open rows and risk fields from the service", () => {
    const result = convertNativeBatch(defaultData(), {
      sessions: [
        { id: "w1", target: "youtube", startedAt: at(10, 20, 22, 1).getTime(), endedAt: at(10, 20, 22, 4).getTime(), durationSec: 180, openId: "o1" },
        { id: "w2", target: "youtube", startedAt: at(10, 20, 21).getTime(), endedAt: at(10, 20, 21, 2).getTime(), durationSec: 120 },
      ],
      lockAttempts: [],
      openLogs: [
        { id: "o1", createdAt: at(10, 20, 22).getTime(), target: "youtube", features: [...START_MODEL.checks[0].raw], score: 0.45, band: "high", tighten: "full", keeping: true, modelVersion: "lr-1" },
        { id: "bad", createdAt: at(10, 20, 22).getTime(), target: "youtube", features: [Number.NaN], score: 0.1, band: "low", modelVersion: "lr-1" },
        { id: "bad2", createdAt: at(10, 20, 22).getTime(), target: "youtube", features: [], score: 0.1, band: "extreme", modelVersion: "lr-1" },
      ],
      interventions: [
        { id: "i1", createdAt: at(10, 20, 22).getTime(), target: "youtube", level: 2, reason: "심심해서", interventionType: "pause", alternativeAction: null, outcome: "watch", usageSeconds: 600, stage: "entry", commitMinutes: 3, openId: "o1", riskScore: 0.45, riskBand: "high", tighten: "full" },
        { id: "i2", createdAt: at(10, 20, 22).getTime(), target: "youtube", level: 2, reason: "심심해서", interventionType: "pause", alternativeAction: null, outcome: "watch", usageSeconds: 600, stage: "entry", commitMinutes: 10, riskBand: "medium", tighten: "full" },
        { id: "i3", createdAt: at(10, 20, 22).getTime(), target: "youtube", level: 1, reason: "심심해서", interventionType: "pause", alternativeAction: null, outcome: "exit", usageSeconds: 60, stage: "entry" },
      ],
    });
    assert.deepEqual(result.openLogs.map((o) => o.id), ["o1"]);
    assert.deepEqual(result.usageLogs.map((u) => u.openId), ["o1", null]);
    assert.equal(result.openLogs[0].label, null);
    assert.equal(result.openLogs[0].tighten, "full");
    assert.equal(result.openLogs[0].keeping, true);
    assert.equal(result.openLogs[0].date, "2026-10-20");
    const [i1, i2, i3] = result.interventions;
    assert.equal(i1.openId, "o1");
    assert.equal(i1.riskBand, "high");
    assert.equal(i1.tightenFollowed, true);
    assert.equal(i2.tightenFollowed, false);
    assert.equal(i3.riskBand, null);
    assert.equal(i3.tighten, null);
    assert.equal(i3.tightenFollowed, null);
  });
});
