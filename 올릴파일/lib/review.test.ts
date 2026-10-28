import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bestMethod,
  dayTimeline,
  hourLabel,
  methodResults,
  peakHour,
  riskyHour,
  usualDifferences,
  weakMethod,
  weekSeries,
  weekSummary,
} from "./review.ts";
import { defaultData } from "./storage.ts";
import type { AppData, InterventionLog, OpenLog, UsageLog } from "./types.ts";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const key = (day: number) => `2026-10-${String(day).padStart(2, "0")}`;

function session(id: string, day: number, hour: number, minutes: number): UsageLog {
  return {
    usageId: id,
    target: "youtube",
    source: "native",
    date: key(day),
    startTime: local(day, hour),
    endTime: local(day, hour, minutes),
    duration: minutes * 60,
    clipCount: 1,
    openId: null,
  };
}

function intervention(id: string, day: number, hour: number, type: string, outcome: string, extra: Partial<InterventionLog> = {}): InterventionLog {
  return {
    interventionId: id,
    timestamp: local(day, hour),
    date: key(day),
    level: 1,
    reason: "",
    reasonNote: "",
    alternativeAction: null,
    alternativeCompleted: false,
    reEntered: false,
    blocked: false,
    blockDuration: 0,
    usageSeconds: 0,
    outcome: outcome as InterventionLog["outcome"],
    hour,
    weekday: 0,
    target: "youtube",
    interventionType: type as InterventionLog["interventionType"],
    reenteredWithin30: null,
    feedback: null,
    band: null,
    stage: null,
    framing: null,
    verification: null,
    reflection: null,
    afterLock: null,
    commitMinutes: 0,
    cardId: null,
    cardCorrect: null,
    extensionIndex: 0,
    policyVersion: null,
    openId: null,
    riskScore: null,
    riskBand: null,
    tighten: null,
    tightenFollowed: null,
    ...extra,
  };
}

function withGoal(data: AppData, minutes: number): AppData {
  return { ...data, settings: { ...data.settings, level3Threshold: minutes } };
}

describe("review: week", () => {
  it("marks days over the goal and skips days before the first record", () => {
    const data = withGoal(
      { ...defaultData(), usageLogs: [session("a", 24, 20, 30), session("b", 25, 20, 50), session("c", 28, 9, 10)] },
      40,
    );
    const week = weekSeries(data, new Date(2026, 9, 28, 12));
    assert.deepEqual(
      week.map((d) => d.state),
      ["before", "before", "kept", "over", "kept", "kept", "kept"],
    );
    const sum = weekSummary(week);
    assert.equal(sum.counted, 5);
    assert.equal(sum.kept, 4);
    assert.equal(Math.round(sum.avgSeconds / 60), 18); // (30+50+0+0+10)/5
  });
});

describe("review: day", () => {
  it("places sessions and intervention marks on the day", () => {
    const data = {
      ...defaultData(),
      usageLogs: [session("a", 28, 12, 30)],
      interventions: [intervention("i", 28, 12, "breath", "exit"), intervention("j", 28, 18, "reflection", "watch")],
    };
    const t = dayTimeline(data, key(28));
    assert.equal(t.sessions.length, 1);
    assert.equal(Math.round(t.sessions[0].left), 50);
    assert.deepEqual(
      t.marks.map((m) => [Math.round(m.left), m.stopped]),
      [
        [50, true],
        [75, false],
      ],
    );
  });

  it("finds the peak hour and names it", () => {
    const hours = new Array<number>(24).fill(0);
    hours[21] = 600;
    hours[8] = 120;
    assert.equal(peakHour(hours), 21);
    assert.equal(peakHour(new Array<number>(24).fill(30)), null);
    assert.equal(hourLabel(21), "밤 9시");
    assert.equal(hourLabel(12), "낮 12시");
    assert.equal(hourLabel(8), "오전 8시");
    assert.equal(hourLabel(2), "새벽 2시");
  });
});

describe("review: report", () => {
  it("picks the method that worked and the one that did not", () => {
    const logs = [
      intervention("1", 28, 9, "breath", "exit"),
      intervention("2", 28, 10, "breath", "kept"),
      intervention("3", 28, 11, "reflection", "watch"),
      intervention("4", 28, 12, "reflection", "watch"),
      intervention("5", 28, 13, "reflection", "exit"),
      intervention("6", 28, 14, "pause", "blocked-retry"),
    ];
    const results = methodResults(logs);
    const best = bestMethod(results);
    assert.deepEqual(best, { type: "breath", total: 2, stopped: 2 });
    assert.deepEqual(weakMethod(results, best), { type: "reflection", total: 3, stopped: 1 });
    assert.equal(bestMethod(methodResults([intervention("x", 28, 9, "pause", "watch")])), null);
  });

  it("says nothing about usual days with fewer than 3 days of records", () => {
    const data = { ...defaultData(), usageLogs: [session("a", 27, 21, 20), session("b", 28, 21, 2)] };
    assert.deepEqual(usualDifferences(data, new Date(2026, 9, 28, 23)), []);
  });

  it("notices a shorter night and a self-chosen lock", () => {
    const data = {
      ...defaultData(),
      usageLogs: [
        session("a", 24, 21, 20),
        session("b", 25, 21, 20),
        session("c", 26, 21, 20),
        session("d", 27, 21, 20),
        session("e", 28, 21, 5),
      ],
      interventions: [intervention("l", 28, 22, "strong", "timed-block", { blockDuration: 30 })],
    };
    assert.deepEqual(
      usualDifferences(data, new Date(2026, 9, 28, 23, 30)).map((d) => d.text),
      ["밤 시청이 짧았어요", "잠금을 스스로 걸었어요"],
    );
  });

  it("finds the hour with the most high-risk opens in two weeks", () => {
    const open = (id: string, day: number, hour: number, band: OpenLog["band"]): OpenLog => ({
      id,
      createdAt: local(day, hour),
      date: key(day),
      target: "youtube",
      features: [],
      score: 0.8,
      band,
      tighten: null,
      keeping: false,
      modelVersion: "lr-1",
      label: null,
      durationSec: null,
    });
    const data = {
      ...defaultData(),
      openLogs: [open("1", 20, 21, "high"), open("2", 22, 21, "high"), open("3", 25, 21, "high"), open("4", 26, 9, "high"), open("5", 27, 9, "low")],
    };
    assert.equal(riskyHour(data, new Date(2026, 9, 28, 23)), 21);
    assert.equal(riskyHour({ ...data, openLogs: data.openLogs.slice(1) }, new Date(2026, 9, 28, 23)), null);
  });
});
