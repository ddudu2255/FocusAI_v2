import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BANDIT_SHARE_K,
  dayType,
  gradedReward,
  similarity,
  watchedSecondsBetween,
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
import type { AppData, InterventionLog, InterventionType, UsageLog } from "./types.ts";

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
  it("with learning v2 off, matches v0.9.0: Beta per band and slot, skipping unsettled rows", () => {
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
    const { methods, framings, samples } = banditTables(data, now, { v2: false });
    assert.equal(samples, 3);
    assert.deepEqual(methods["2:night"]?.breath, [2, 2]);
    assert.deepEqual(methods["2:night"]?.card, [1.5, 1.5]);
    assert.equal(methods["1:day"], undefined);
    assert.deepEqual(framings.night?.sleep, [2, 1]);
  });
});

/**
 * 밴딧 테스트용 기록. watched = 개입 뒤 바로 이어서 본 분 (0이면 바로 나감).
 * 기록끼리 30분 창이 겹치지 않게 시각을 띄워서 만든다.
 */
type Entry = { when: Date; band: 1 | 2; arm: InterventionType; watched: number; framing?: string };

function scenario(entries: Entry[], settings: Partial<AppData["settings"]> = {}): AppData {
  const base = defaultData();
  return {
    ...base,
    settings: { ...base.settings, ...settings },
    interventions: entries.map((e, i) =>
      row({
        interventionId: `i${i}`,
        timestamp: e.when.toISOString(),
        hour: e.when.getHours(),
        band: e.band,
        interventionType: e.arm,
        outcome: e.watched > 0 ? "watch" : "exit",
        reenteredWithin30: e.watched > 0 ? null : false,
        framing: e.framing ?? null,
      }),
    ),
    usageLogs: entries.filter((e) => e.watched > 0).map((e, i) => session(`u${i}`, e.when, e.watched)),
  };
}

const mean = ([a, b]: [number, number]) => a / (a + b);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
/** 2026년 10월 평일 / 주말 날짜 */
const WEEKDAYS = [1, 2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20];
const WEEKENDS = [3, 4, 10, 11, 17, 18];
/** 최근 가중치를 사실상 끈다 (계산만 보고 싶을 때) */
const FLAT = { v2: true, halfLifeDays: 1e9 } as const;

describe("bandit learning v2", () => {
  const now = at(10, 21, 12); // 수요일

  it("scores by what was watched in the 30 minutes after", () => {
    const t = at(10, 20, 20);
    const log = row({ interventionId: "g", timestamp: t.toISOString() });
    close(gradedReward(log, []), 1); // 바로 나감
    close(gradedReward(log, [session("a", t, 3)]), 0.8); // 3분 약속 지킴
    close(gradedReward(log, [session("a", t, 20)]), 0); // 15분 넘게 봄
    close(gradedReward(log, [session("a", at(10, 20, 20, 20), 6)]), 0.6); // 20분 뒤 다시 와서 6분
    close(gradedReward(log, [session("a", at(10, 20, 20, 25), 10)]), 1 - 5 / 15); // 창 안 5분만 셈
    close(gradedReward(log, [session("a", at(10, 20, 21, 0), 10)]), 1); // 30분 창 밖
    close(gradedReward({ ...log, feedback: "not" }, []), 0.5);
    close(
      gradedReward(log, [{ ...session("p", t, 10), target: "practice" }]),
      1,
    ); // 연습 기록은 세지 않음
    close(watchedSecondsBetween([session("a", t, 3)], t.getTime(), t.getTime() + 60_000), 60);
  });

  it("waits 30 minutes before scoring a record", () => {
    const data = scenario([{ when: at(10, 21, 11, 45), band: 2, arm: "breath", watched: 0 }]);
    assert.equal(banditTables(data, now, FLAT).samples, 0);
    assert.equal(banditTables(data, at(10, 21, 12, 16), FLAT).samples, 1);
  });

  it("1. with no records at all, every arm is Beta(1, 1) like before", () => {
    const { methods, framings } = banditTables(scenario([]), now, { v2: true });
    assert.deepEqual(methods, {});
    assert.deepEqual(framings, {});
  });

  it("2. an empty cell starts from what worked in other cells, capped at K", () => {
    const entries: Entry[] = [];
    for (const d of WEEKDAYS.slice(0, 10)) {
      entries.push({ when: at(10, d, 17), band: 2, arm: "breath", watched: 0 }); // 잘 됨
      entries.push({ when: at(10, d, 19), band: 2, arm: "card", watched: 20 }); // 안 됨
    }
    const { methods } = banditTables(scenario(entries), now, FLAT);
    const morning = methods["2:morning:weekday"];
    assert.ok(morning, "empty cell gets a starting value");
    assert.ok(mean(morning.breath) > 0.7);
    assert.ok(mean(morning.card) < 0.3);
    const [a, b] = morning.breath;
    close(a + b - 2, BANDIT_SHARE_K);
  });

  it("3. a cell with plenty of its own records follows its own records", () => {
    const entries: Entry[] = [];
    // 다른 칸(평일 밤): 호흡이 매번 성공
    for (const d of WEEKDAYS) entries.push({ when: at(10, d, 23), band: 2, arm: "breath", watched: 0 });
    // 이 칸(평일 저녁): 호흡은 20번 중 18번 실패, 대체행동은 20번 중 18번 성공
    for (let i = 0; i < 40; i += 1) {
      const when = at(10, WEEKDAYS[i % 14], 17 + Math.floor(i / 14));
      const breath = i < 20;
      const ok = breath ? i < 2 : i < 38;
      entries.push({ when, band: 2, arm: breath ? "breath" : "alternative", watched: ok ? 0 : 20 });
    }
    const { methods } = banditTables(scenario(entries), now, FLAT);
    const evening = methods["2:evening:weekday"];
    assert.ok(mean(evening.breath) < 0.3);
    assert.ok(mean(evening.alternative) > mean(evening.breath));
  });

  it("4. the cell's own records are not counted twice", () => {
    // 기록이 한 칸에만 있으면 빌려 올 다른 칸이 없으므로 자기 기록만 쓴 것과 같다.
    const entries: Entry[] = [
      { when: at(10, 19, 23), band: 2, arm: "breath", watched: 0 },
      { when: at(10, 20, 1), band: 2, arm: "breath", watched: 20 },
      { when: at(10, 20, 23), band: 2, arm: "breath", watched: 0 },
    ];
    const { methods, ownMethods } = banditTables(scenario(entries), now, FLAT);
    const [s, f] = ownMethods["2:night:weekday"].breath;
    close(s, 2);
    close(f, 1);
    const [a, b] = methods["2:night:weekday"].breath;
    close(a, 3);
    close(b, 2);
  });

  it("5. with learning v2 off (setting), tables equal the v0.9.0 calculation", () => {
    const data: AppData = {
      ...defaultData(),
      settings: { ...defaultData().settings, banditV2: false },
      interventions: [
        row({ interventionId: "y1", timestamp: at(10, 19, 23).toISOString(), hour: 23, band: 2, interventionType: "breath", outcome: "exit", reenteredWithin30: false, framing: "sleep" }),
        row({ interventionId: "y2", timestamp: at(10, 10, 8).toISOString(), hour: 8, band: 1, interventionType: "pause", outcome: "watch", framing: "goal" }),
        row({ interventionId: "y3", timestamp: at(10, 5, 14).toISOString(), hour: 14, band: 2, interventionType: "card", outcome: "kept", reenteredWithin30: false }),
      ],
    };
    const { methods, framings, v2 } = banditTables(data, now);
    assert.equal(v2, false);
    assert.deepEqual(methods, {
      "2:night": { breath: [2, 1] },
      "1:morning": { pause: [1, 2] },
      "2:day": { card: [2, 1] },
    });
    assert.deepEqual(framings, { night: { sleep: [2, 1] }, morning: { goal: [1, 2] } });
  });

  it("6. records outside the 30-day window are not borrowed either", () => {
    const data = scenario([{ when: at(9, 1, 23), band: 2, arm: "breath", watched: 0 }]);
    const { methods, ownMethods } = banditTables(data, now, { v2: true });
    assert.deepEqual(methods, {});
    assert.deepEqual(ownMethods, {});
  });

  it("an empty weekend cell leans on the same time slot on weekdays most", () => {
    const entries: Entry[] = [];
    for (const d of WEEKDAYS.slice(0, 8)) {
      entries.push({ when: at(10, d, 23), band: 2, arm: "breath", watched: 0 }); // 평일 밤: 잘 됨
      entries.push({ when: at(10, d, 8), band: 2, arm: "breath", watched: 20 }); // 평일 아침: 안 됨
    }
    const { methods } = banditTables(scenario(entries), now, FLAT);
    // 주말 밤은 평일 밤(0.8)을 평일 아침(0.4)보다 더 믿는다.
    assert.ok(mean(methods["2:night:weekend"].breath) > 0.5);
    assert.ok(mean(methods["2:morning:weekend"].breath) < 0.5);
    // 주말 기록이 쌓이면 주말 기록을 따른다.
    const weekendBad = [...entries];
    for (const d of WEEKENDS) {
      for (const h of [22, 23, 0]) {
        const day = h === 0 ? d + 1 : d;
        if (h === 0 && d % 7 === 4) continue; // 일요일 다음 0시는 평일이라 뺀다
        weekendBad.push({ when: at(10, day, h), band: 2, arm: "breath", watched: 20 });
      }
    }
    const after = banditTables(scenario(weekendBad), now, FLAT).methods;
    assert.ok(mean(after["2:night:weekend"].breath) < 0.3);
  });

  it("similarity: weekday↔weekend is closest, then time slot, then band", () => {
    assert.equal(similarity("2:night:weekday", "2:night:weekend"), 0.8);
    assert.equal(similarity("2:night:weekday", "2:morning:weekday"), 0.5);
    assert.equal(similarity("2:night:weekday", "1:night:weekday"), 0.5);
    assert.equal(similarity("2:night:weekday", "1:morning:weekend"), 0.5 * 0.5 * 0.8);
    assert.equal(similarity("night:weekday", "night:weekend"), 0.8);
    assert.equal(dayType(at(10, 10, 12)), "weekend");
    assert.equal(dayType(at(10, 12, 12)), "weekday");
  });

  it("weights recent records more (half every 7 days)", () => {
    const entries: Entry[] = [
      { when: at(10, 21, 11), band: 2, arm: "breath", watched: 0 }, // 1시간 전
      { when: at(10, 14, 12), band: 2, arm: "breath", watched: 0 }, // 7일 전
    ];
    const { ownMethods } = banditTables(scenario(entries), now, { v2: true });
    const [s, f] = ownMethods["2:day:weekday"].breath;
    close(s, Math.pow(0.5, 1 / 24 / 7) + 0.5);
    assert.equal(f, 0);
  });

  it("follows a changed habit faster than equal weights", () => {
    const entries: Entry[] = [];
    // 3주쯤 전: 호흡이 잘 됐다. 최근: 호흡이 안 된다.
    for (const d of [1, 2, 5, 6, 7, 8, 9]) entries.push({ when: at(10, d, 23), band: 2, arm: "breath", watched: 0 });
    for (const d of [19, 20]) {
      entries.push({ when: at(10, d, 22), band: 2, arm: "breath", watched: 20 });
      entries.push({ when: at(10, d, 23), band: 2, arm: "breath", watched: 20 });
    }
    const data = scenario(entries);
    const weighted = banditTables(data, now, { v2: true }).methods["2:night:weekday"].breath;
    const flat = banditTables(data, now, FLAT).methods["2:night:weekday"].breath;
    assert.ok(mean(weighted) < 0.5);
    assert.ok(mean(flat) > 0.5);
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
    assert.equal(on.version, "ai-2");
    assert.equal(buildPolicy({ ...data.settings, banditV2: false }, data).version, "ai-1");
    assert.deepEqual(on.ai.habituation, { strength: 0.3, recoveryHours: 6 });
    assert.equal(buildPolicy({ ...data.settings, banditV2: false }, data).ai.habituation.strength, 0);
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
