import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  banditTables,
  goalSuggestion,
  hourLabel,
  reward,
  riskHours,
  timeSlot,
  weekKey,
} from "./ai.ts";
import { convertNativeBatch } from "./logic.ts";
import { buildPolicy } from "./policy.ts";
import { defaultData, readIntervention } from "./storage.ts";
import type { AppData, InterventionLog, UsageLog } from "./types.ts";

const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);
const key = (month: number, day: number) =>
  `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function session(id: string, start: Date, minutes: number): UsageLog {
  return {
    usageId: id,
    date: key(start.getMonth() + 1, start.getDate()),
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
    duration: minutes * 60,
    clipCount: 1,
    target: "youtube",
    source: "native",
  };
}

function row(partial: Partial<InterventionLog> & { interventionId: string; timestamp: string }): InterventionLog {
  const log = readIntervention({
    date: partial.timestamp.slice(0, 10),
    level: 2,
    reason: "습관적으로",
    reEntered: false,
    blocked: false,
    outcome: "exit",
    stage: "entry",
    ...partial,
  });
  assert.ok(log);
  return { ...log, ...partial } as InterventionLog;
}

describe("ai basics", () => {
  it("maps hours to slots and labels", () => {
    assert.equal(timeSlot(6), "morning");
    assert.equal(timeSlot(13), "day");
    assert.equal(timeSlot(20), "evening");
    assert.equal(timeSlot(23), "night");
    assert.equal(timeSlot(2), "night");
    assert.equal(hourLabel(23), "밤 11시");
    assert.equal(hourLabel(21), "밤 9시");
    assert.equal(hourLabel(19), "저녁 7시");
    assert.equal(hourLabel(14), "오후 2시");
    assert.equal(hourLabel(9), "오전 9시");
    assert.equal(hourLabel(0), "밤 12시");
  });

  it("scores stopping, re-entry and feedback", () => {
    const base = row({ interventionId: "r", timestamp: at(10, 1, 22).toISOString() });
    assert.equal(reward({ ...base, outcome: "exit", reenteredWithin30: false }), 1);
    assert.equal(reward({ ...base, outcome: "kept", reenteredWithin30: true }), 0.5);
    assert.equal(reward({ ...base, outcome: "watch" }), 0);
    assert.equal(reward({ ...base, outcome: "exit", reenteredWithin30: false, feedback: "not" }), 0.5);
  });
});

describe("bandit tables", () => {
  it("builds Beta posteriors per band and time slot, skipping unsettled rows", () => {
    const now = at(10, 6, 12);
    const data: AppData = {
      ...defaultData(),
      interventions: [
        row({ interventionId: "a", timestamp: at(10, 5, 23).toISOString(), hour: 23, band: 2, interventionType: "breath", outcome: "exit", reenteredWithin30: false, framing: "sleep" }),
        row({ interventionId: "b", timestamp: at(10, 5, 23, 30).toISOString(), hour: 23, band: 2, interventionType: "breath", outcome: "watch" }),
        row({ interventionId: "c", timestamp: at(10, 5, 23, 40).toISOString(), hour: 23, band: 2, interventionType: "card", outcome: "kept", reenteredWithin30: true }),
        // not settled yet (re-entry unknown): skipped
        row({ interventionId: "d", timestamp: at(10, 6, 11, 50).toISOString(), hour: 11, band: 1, interventionType: "pause", outcome: "exit", reenteredWithin30: null }),
        // older than 30 days: skipped
        row({ interventionId: "e", timestamp: at(8, 1, 23).toISOString(), hour: 23, band: 2, interventionType: "card", outcome: "exit", reenteredWithin30: false }),
      ],
    };
    const { methods, framings, samples } = banditTables(data, now);
    assert.equal(samples, 3);
    assert.deepEqual(methods["2:night"]?.breath, [2, 2]);
    assert.deepEqual(methods["2:night"]?.card, [1.5, 1.5]);
    assert.equal(methods["1:day"], undefined);
    assert.deepEqual(framings.night?.sleep, [2, 1]);
  });
});

describe("risk hours", () => {
  it("needs five recorded days, then finds the long-watch hours", () => {
    const now = at(10, 10, 12);
    const few = { ...defaultData(), usageLogs: [1, 2, 3].map((d) => session(`s${d}`, at(10, d, 23), 20)) };
    assert.equal(riskHours(few, now), null);

    const logs: UsageLog[] = [];
    for (let d = 1; d <= 7; d += 1) {
      logs.push(session(`n${d}`, at(10, d, 23), 25)); // 밤 11시에 25분
      logs.push(session(`m${d}`, at(10, d, 8), 2)); // 아침 8시에 2분
    }
    const data = { ...defaultData(), usageLogs: logs };
    const risk = riskHours(data, now);
    assert.ok(risk);
    assert.deepEqual(risk.hours, [23]);
    assert.ok(risk.avgSeconds > 20 * 60);
  });
});

describe("weekly goal suggestion", () => {
  const monday = at(10, 12, 9); // 2026-10-12 월요일
  const lastWeek = [5, 6, 7, 8, 9, 10, 11];

  it("suggests a smaller goal after five kept days, down to the final goal", () => {
    const data = {
      ...defaultData(),
      usageLogs: lastWeek.map((d) => session(`w${d}`, at(10, d, 20), 15)),
    };
    const s = goalSuggestion(data, monday);
    assert.ok(s);
    assert.equal(s.week, weekKey(monday));
    assert.equal(s.keptDays, 7);
    assert.equal(s.current, 20);
    assert.equal(s.suggested, 17);
    assert.equal(s.reduce, true);

    const atFloor = { ...data, settings: { ...data.settings, level3Threshold: 10, finalGoal: 10 } };
    const kept = { ...atFloor, usageLogs: lastWeek.map((d) => session(`f${d}`, at(10, d, 20), 8)) };
    const hold = goalSuggestion(kept, monday);
    assert.equal(hold?.reduce, false);
  });

  it("does not tighten after a missed week", () => {
    const data = {
      ...defaultData(),
      usageLogs: lastWeek.map((d, i) => session(`x${d}`, at(10, d, 20), i < 3 ? 15 : 40)),
    };
    assert.equal(goalSuggestion(data, monday), null);
  });
});

describe("policy and feedback", () => {
  it("switches the policy between rules and AI", () => {
    const data = defaultData();
    const on = buildPolicy(data.settings, data);
    assert.equal(on.version, "ai-1");
    assert.equal(on.ai.enabled, true);
    const off = buildPolicy({ ...data.settings, aiEnabled: false }, data);
    assert.equal(off.version, "rule-2");
    assert.equal(off.ai.enabled, false);
    assert.equal(buildPolicy({ ...data.settings, strictMode: true }, data).ai.strict, true);
  });

  it("turns feedback rows into answers for the intervention", () => {
    const result = convertNativeBatch(defaultData(), {
      sessions: [],
      lockAttempts: [],
      interventions: [
        { id: "f1", createdAt: at(10, 6, 22).getTime(), target: "youtube", level: 2, reason: "선택하지 않음", interventionType: "feedback", alternativeAction: null, outcome: "feedback", usageSeconds: 0, stage: "feedback", refId: "row-1", feedback: "helpful" },
      ],
    });
    assert.equal(result.interventions.length, 0);
    assert.deepEqual(result.feedback, [{ refId: "row-1", feedback: "helpful" }]);
  });
});
