import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFlush,
  blockUntilFromMinutes,
  buildIntervention,
  convertNativeBatch,
  finalizeSession,
  getMonthProgress,
  goalMinutesOn,
  GOAL_SINCE_START,
  hourlyUsage,
  nextGoalLog,
  pastMonthProgress,
  insightLine,
  lockStreak,
  isBlocked,
  isReportDue,
  levelForUsage,
  minutesUntilDayEnd,
  restSecondsOn,
  usageStats,
  reportLines,
  secondsOnDate,
  settleReentry,
  statsForDate,
  usageSecondsOn,
  validateSettings,
  webSecondsOn,
} from "./logic.ts";
import { buildPolicy, CARD_PROMPT, cardsForService, explanationLooksWrong, parseCardImport } from "./policy.ts";
import {
  defaultData,
  defaultSettings,
  normalizeData,
  readIntervention,
  readSettings,
  settingsFromGoal,
} from "./storage.ts";
import type { AppData, InterventionLog, UsageLog } from "./types.ts";

const settings = defaultSettings();

describe("level", () => {
  it("follows the 10 and 20 minute bands", () => {
    assert.equal(levelForUsage(0, settings), 1);
    assert.equal(levelForUsage(9.9 * 60, settings), 1);
    assert.equal(levelForUsage(10 * 60, settings), 2);
    assert.equal(levelForUsage(19.9 * 60, settings), 2);
    assert.equal(levelForUsage(20 * 60, settings), 3);
  });
});

describe("settings", () => {
  it("rejects a final goal above the daily goal and a bad day-end hour", () => {
    assert.ok(validateSettings({ goal: 20, finalGoal: 30, dayEndHour: 6, notificationTime: "21:00" }));
    assert.ok(validateSettings({ goal: 20, finalGoal: 10, dayEndHour: 13, notificationTime: "21:00" }));
    assert.ok(validateSettings({ goal: 0, finalGoal: 0, dayEndHour: 6, notificationTime: "21:00" }));
  });

  it("accepts a clock with seconds", () => {
    assert.equal(
      validateSettings({ goal: 20, finalGoal: 10, dayEndHour: 6, notificationTime: "09:30:00" }),
      null,
    );
  });

  it("derives the medium band start from the goal", () => {
    const settings = settingsFromGoal(30, {
      notificationTime: "21:00",
      notifyEnabled: true,
      finalGoal: 15,
      dayEndHour: 6,
      wakeTime: "07:00",
      aiEnabled: true,
      strictMode: false,
      banditV2: true,
      studyMode: false,
      goalWeekAnswered: "",
      usageSyncEnabled: false,
      usageSyncAsked: false,
      onboardingDone: true,
      cluster: "",
      demoMode: false,
    });
    assert.equal(settings.level1Threshold, 15);
    assert.equal(settings.level3Threshold, 30);
    assert.equal(levelForUsage(14 * 60, settings), 1);
    assert.equal(levelForUsage(15 * 60, settings), 2);
    assert.equal(levelForUsage(30 * 60, settings), 3);
  });

  it("applies a new goal even when the full old settings are passed", () => {
    const old = { ...defaultSettings(), level1Threshold: 25, level2Threshold: 50, level3Threshold: 50 };
    const next = settingsFromGoal(45, { ...old, goalWeekAnswered: "2026-10-19" });
    assert.equal(next.level3Threshold, 45);
    assert.equal(next.level2Threshold, 45);
    assert.equal(next.level1Threshold, 23);
    assert.equal(next.goalWeekAnswered, "2026-10-19");
    assert.equal(next.aiEnabled, old.aiEnabled);
  });

  it("reads old saved settings with defaults for the new fields", () => {
    const settings = readSettings({ level1Threshold: 10, level2Threshold: 20, level3Threshold: 20, notificationTime: "21:00" });
    assert.equal(settings.level3Threshold, 20);
    assert.equal(settings.finalGoal, 10);
    assert.equal(settings.dayEndHour, 6);
  });
});

const local = (d: number, h: number, m = 0, s = 0) =>
  new Date(2026, 8, d, h, m, s).toISOString();

function practiceLog(partial: Partial<UsageLog> & Pick<UsageLog, "usageId">): UsageLog {
  return {
    date: "2026-09-27",
    startTime: local(27, 10),
    endTime: local(27, 10),
    duration: 0,
    clipCount: 1,
    target: "practice",
    source: "web",
    ...partial,
  };
}

function intervention(partial: Partial<InterventionLog>): InterventionLog {
  const row = readIntervention({
    interventionId: "x",
    timestamp: local(27, 10),
    date: "2026-09-27",
    level: 1,
    reason: "습관적으로",
    reasonNote: "",
    alternativeAction: null,
    alternativeCompleted: false,
    reEntered: false,
    blocked: false,
    blockDuration: 0,
    usageSeconds: 0,
    outcome: "exit",
    ...partial,
  });
  assert.ok(row);
  return row;
}

describe("usage flush", () => {
  it("adds real seconds only while visible", () => {
    const start = 1_000;
    const data: AppData = {
      ...defaultData(),
      activeSession: {
        usageId: "u1",
        date: "2026-09-27",
        startTime: new Date(start).toISOString(),
        duration: 0,
        clipCount: 1,
        interventionId: "i1",
        levelAtStart: 1,
        lastTickAt: start,
      },
      usageLogs: [
        practiceLog({
          usageId: "u1",
          startTime: new Date(start).toISOString(),
          endTime: new Date(start).toISOString(),
        }),
      ],
    };
    const hidden = applyFlush(data, false, start + 500);
    assert.equal(hidden.activeSession?.duration, 0);
    const visible = applyFlush(hidden, true, start + 1500);
    assert.equal(visible.activeSession?.duration, 1);
    const done = finalizeSession(visible, start + 1500);
    assert.equal(done.activeSession, null);
    assert.equal(done.usageLogs[0]?.duration, 1);
  });
});

describe("block and report", () => {
  it("keeps a block for real minutes", () => {
    const now = Date.parse("2026-09-27T12:00:00");
    const until = blockUntilFromMinutes(10, now);
    assert.equal(Date.parse(until) - now, 600_000);
    assert.equal(isBlocked({ until, minutes: 10 }, now + 599_000), true);
    assert.equal(isBlocked({ until, minutes: 10 }, now + 601_000), false);
  });

  it("treats the report as due at the configured minute", () => {
    const morning = new Date(2026, 8, 27, 8, 0, 0);
    const evening = new Date(2026, 8, 27, 21, 0, 0);
    assert.equal(isReportDue("21:00", morning), false);
    assert.equal(isReportDue("21:00", evening), true);
  });
});

describe("stats", () => {
  it("counts clips, reasons, reentry, timed blocks and lock attempts", () => {
    const data = defaultData();
    data.usageLogs.push(
      practiceLog({
        usageId: "u",
        startTime: local(27, 10),
        endTime: local(27, 10, 2),
        duration: 120,
        clipCount: 4,
      }),
    );
    data.interventions.push(
      intervention({
        interventionId: "a",
        level: 2,
        alternativeAction: "호흡하기",
        alternativeCompleted: true,
        reEntered: true,
        usageSeconds: 60,
        outcome: "watch",
      }),
      intervention({ interventionId: "a2", reEntered: true, outcome: "watch" }),
      intervention({
        interventionId: "b",
        level: 3,
        reason: "심심해서",
        blocked: true,
        blockDuration: 10,
        outcome: "timed-block",
      }),
    );
    data.lockAttempts.push({
      id: "l1",
      createdAt: local(27, 10, 6),
      date: "2026-09-27",
      remainingSec: 300,
      target: "youtube",
    });
    const stats = statsForDate(data, "2026-09-27");
    assert.equal(stats.usageSeconds, 120);
    assert.equal(stats.clipCount, 4);
    assert.equal(stats.interventionCount, 3);
    assert.equal(stats.topReason, "습관적으로");
    assert.equal(stats.reentryCount, 1);
    assert.equal(stats.blockCount, 1);
    assert.equal(stats.lockAttemptCount, 1);
    const report = reportLines(stats).join("\n");
    assert.match(report, /^스스로 멈춘 횟수 : 1번/);
    assert.match(report, /잠금 중 시도 : 1회/);
  });
});

describe("midnight split", () => {
  it("splits a session that crosses midnight by the time on each date", () => {
    const log = practiceLog({
      usageId: "night",
      date: "2026-09-27",
      startTime: local(27, 23, 58),
      endTime: local(28, 0, 3),
      duration: 300,
      target: "youtube",
      source: "native",
    });
    assert.equal(Math.round(secondsOnDate(log, "2026-09-27")), 120);
    assert.equal(Math.round(secondsOnDate(log, "2026-09-28")), 180);
    assert.equal(secondsOnDate(log, "2026-09-29"), 0);
    const data = { ...defaultData(), usageLogs: [log] };
    assert.equal(Math.round(usageSecondsOn(data, "2026-09-28")), 180);
  });

  it("counts only web seconds for the service baseline", () => {
    const data = {
      ...defaultData(),
      usageLogs: [
        practiceLog({ usageId: "p", startTime: local(27, 9), endTime: local(27, 9, 1), duration: 60 }),
        practiceLog({
          usageId: "n",
          startTime: local(27, 9, 5),
          endTime: local(27, 9, 7),
          duration: 120,
          target: "youtube",
          source: "native",
        }),
      ],
    };
    assert.equal(Math.round(webSecondsOn(data, "2026-09-27")), 60);
    assert.equal(Math.round(usageSecondsOn(data, "2026-09-27")), 180);
  });
});

describe("native batch", () => {
  it("converts service rows and skips ones already stored", () => {
    const startedAt = new Date(2026, 8, 27, 10, 0, 0).getTime();
    const batch = {
      sessions: [
        { id: "s1", target: "youtube", startedAt, endedAt: startedAt + 90_000, durationSec: 90 },
        { id: "bad", target: "youtube", startedAt, endedAt: startedAt, durationSec: 0 },
      ],
      interventions: [
        {
          id: "i1",
          createdAt: startedAt,
          target: "youtube",
          level: 2,
          reason: "심심해서",
          interventionType: "alternative",
          alternativeAction: "잠시 걷기",
          outcome: "exit",
          usageSeconds: 700,
        },
      ],
      lockAttempts: [{ id: "k1", createdAt: startedAt, remainingSec: 120.4, target: "youtube" }],
    };
    const first = convertNativeBatch(defaultData(), batch);
    assert.equal(first.usageLogs.length, 1);
    assert.equal(first.usageLogs[0]?.source, "native");
    assert.equal(first.usageLogs[0]?.date, "2026-09-27");
    assert.equal(first.interventions[0]?.hour, 10);
    assert.equal(first.interventions[0]?.interventionType, "alternative");
    assert.equal(first.interventions[0]?.outcome, "exit");
    assert.equal(first.lockAttempts[0]?.remainingSec, 120);

    const stored = {
      ...defaultData(),
      usageLogs: first.usageLogs,
      interventions: first.interventions,
      lockAttempts: first.lockAttempts,
    };
    const again = convertNativeBatch(stored, batch);
    assert.equal(again.usageLogs.length + again.interventions.length + again.lockAttempts.length, 0);
  });
});

describe("reentry within 30 minutes", () => {
  it("fills the flag only after 30 minutes and skips watch choices", () => {
    const left = intervention({ interventionId: "left", timestamp: local(27, 10), outcome: "exit" });
    const watched = intervention({ interventionId: "w", timestamp: local(27, 10), outcome: "watch" });
    const back = practiceLog({
      usageId: "back",
      startTime: local(27, 10, 20),
      endTime: local(27, 10, 21),
      duration: 60,
      target: "youtube",
      source: "native",
    });
    const data = { ...defaultData(), interventions: [left, watched], usageLogs: [back] };

    const early = settleReentry(data, new Date(2026, 8, 27, 10, 10).getTime());
    assert.equal(early.changed.length, 0);

    const later = settleReentry(data, new Date(2026, 8, 27, 10, 31).getTime());
    assert.equal(later.changed.length, 1);
    assert.equal(later.data.interventions[0]?.reenteredWithin30, true);
    assert.equal(later.data.interventions[1]?.reenteredWithin30, null);

    const quiet = settleReentry(
      { ...data, usageLogs: [] },
      new Date(2026, 8, 27, 11, 0).getTime(),
    );
    assert.equal(quiet.data.interventions[0]?.reenteredWithin30, false);
  });
});

describe("intervention record", () => {
  it("adds hour, weekday and type", () => {
    const row = buildIntervention(
      {
        level: 2,
        reason: "심심해서",
        reasonNote: "",
        alternativeAction: null,
        alternativeCompleted: false,
        reEntered: false,
        blocked: false,
        blockDuration: 0,
        usageSeconds: 0,
        outcome: "exit",
      },
      "id1",
      new Date(2026, 8, 27, 22, 15),
    );
    assert.equal(row.hour, 22);
    assert.equal(row.weekday, 0);
    assert.equal(row.interventionType, "alternative");
    assert.equal(row.reenteredWithin30, null);
  });
});

describe("storage", () => {
  it("rejects a broken document", () => {
    assert.equal(normalizeData({ usageLogs: "nope" }), null);
  });

  it("keeps good rows when one row is broken and fills new fields", () => {
    const data = normalizeData({
      usageLogs: [
        { usageId: "old", date: "2026-09-27", startTime: local(27, 9), endTime: local(27, 9, 1), duration: 60, clipCount: 2 },
        { usageId: 3 },
      ],
      interventions: [
        {
          interventionId: "i",
          timestamp: local(27, 9),
          date: "2026-09-27",
          level: 1,
          reason: "기타",
          reEntered: true,
          blocked: false,
        },
      ],
    });
    assert.ok(data);
    assert.equal(data.usageLogs.length, 1);
    assert.equal(data.usageLogs[0]?.target, "practice");
    assert.equal(data.interventions[0]?.outcome, "watch");
    assert.equal(data.interventions[0]?.interventionType, "pause");
    assert.deepEqual(data.lockAttempts, []);
  });
});

describe("v0.8.0 helpers", () => {
  it("builds the approved time lines and skips unknown numbers", () => {
    const facts = {
      usage: 23 * 60,
      goal: 30 * 60,
      weekProjection: -1,
      avg7: -1,
      yesterdayByNow: -1,
      sleepSeconds: -1,
      sleepBasis: "",
    };
    assert.equal(insightLine("guilt", facts), "오늘 쇼츠에 쓴 23분, 다시 돌아오지 않아요.");
    assert.equal(insightLine("motivate", facts), "지금 멈추면 오늘 목표 안에서 끝낼 수 있어요. (7분 남음)");
    assert.equal(insightLine("yesterday", facts), null);
    assert.equal(insightLine("sleep", facts), null);
    assert.equal(
      insightLine("yesterday", { ...facts, yesterdayByNow: 12 * 60 }),
      "어제 이 시간엔 12분이었는데, 오늘은 벌써 23분이에요.",
    );
    assert.equal(
      insightLine("average", { ...facts, avg7: 15 * 60 }),
      "이번 주 평균보다 8분 더 보고 있어요.",
    );
    assert.equal(insightLine("guilt", { ...facts, usage: 30 }), null);
  });

  it("computes stats for the lines from past days", () => {
    const now = new Date(2026, 8, 30, 21, 0); // 수요일
    const data = {
      ...defaultData(),
      usageLogs: [
        practiceLog({ usageId: "y", date: "2026-09-29", startTime: new Date(2026, 8, 29, 20, 0).toISOString(), endTime: new Date(2026, 8, 29, 20, 10).toISOString(), duration: 600 }),
        practiceLog({ usageId: "m", date: "2026-09-28", startTime: new Date(2026, 8, 28, 9, 0).toISOString(), endTime: new Date(2026, 8, 28, 9, 20).toISOString(), duration: 1200 }),
      ],
    };
    const stats = usageStats(data, now);
    assert.equal(stats.daysBeforeToday, 2); // 월, 화
    assert.equal(Math.round(stats.pastWeekSeconds), 1800);
    assert.equal(Math.round(stats.yesterdayCumulative?.[19] ?? -1), 0);
    assert.equal(Math.round(stats.yesterdayCumulative?.[20] ?? -1), 600);
    assert.equal(Math.round(stats.avg7Seconds), 900); // 기록이 시작된 9/28부터 2일 평균
  });

  it("splits usage into hours", () => {
    const data = {
      ...defaultData(),
      usageLogs: [
        practiceLog({ usageId: "h", startTime: local(27, 9, 50), endTime: local(27, 10, 10), duration: 1200 }),
      ],
    };
    const hours = hourlyUsage(data, "2026-09-27");
    assert.equal(Math.round(hours[9]), 600);
    assert.equal(Math.round(hours[10]), 600);
    assert.equal(hours[11], 0);
  });

  it("counts minutes until the next day-end hour", () => {
    assert.equal(minutesUntilDayEnd(6, new Date(2026, 8, 27, 23, 0)), 7 * 60);
    assert.equal(minutesUntilDayEnd(6, new Date(2026, 8, 28, 5, 30)), 30);
    assert.equal(minutesUntilDayEnd(6, new Date(2026, 8, 28, 6, 0)), 24 * 60);
  });

  it("maps sheet results from the service", () => {
    const at = new Date(2026, 8, 27, 22, 0).getTime();
    const base = {
      createdAt: at,
      target: "youtube",
      level: 2,
      reason: "습관적으로",
      interventionType: "breath",
      alternativeAction: null,
      usageSeconds: 700,
    };
    const { interventions } = convertNativeBatch(defaultData(), {
      sessions: [],
      lockAttempts: [],
      interventions: [
        { ...base, id: "a", outcome: "kept", stage: "commit_end", interventionType: "commit_end" },
        { ...base, id: "b", outcome: "day_end", blockMinutes: 480, band: 3, interventionType: "strong" },
        { ...base, id: "c", outcome: "lock", blockMinutes: 10, band: 3 },
        { ...base, id: "d", outcome: "watch", verification: "verified", commitMinutes: 5, framing: "book" },
        { ...base, id: "e", outcome: "extend", cardId: "k1", cardCorrect: true },
      ],
    });
    const by = (id: string) => interventions.find((row) => row.interventionId === id)!;
    assert.equal(by("a").outcome, "kept");
    assert.equal(by("a").interventionType, "commit_end");
    assert.equal(by("b").outcome, "day-end");
    assert.equal(by("b").blockDuration, 480);
    assert.equal(by("b").band, 3);
    assert.equal(by("c").outcome, "timed-block");
    assert.equal(by("d").interventionType, "breath");
    assert.equal(by("d").verification, "verified");
    assert.equal(by("d").commitMinutes, 5);
    assert.equal(by("d").alternativeCompleted, true);
    assert.equal(by("e").cardCorrect, true);

    const stats = statsForDate({ ...defaultData(), interventions }, "2026-09-27");
    assert.equal(stats.selfStopCount, 3); // kept, day-end, timed-block
    assert.equal(stats.keptCount, 1);
    assert.equal(stats.dayEndCount, 1);
    assert.equal(stats.extendCount, 1);
    assert.equal(stats.cardsSolved, 1);
    assert.match(reportLines(stats)[0] ?? "", /스스로 멈춘 횟수 : 3번/);
  });

  it("does not count an in-stay commitment sheet as re-entry", () => {
    const left = intervention({ interventionId: "left", timestamp: local(27, 10), outcome: "kept" });
    const sameStay = intervention({
      interventionId: "cs",
      timestamp: local(27, 10, 5),
      outcome: "kept",
      stage: "commit_end",
    } as Partial<InterventionLog>);
    const extended = intervention({ interventionId: "x", timestamp: local(27, 10), outcome: "extend" });
    const data = { ...defaultData(), interventions: [left, sameStay, extended] };
    const settled = settleReentry(data, new Date(2026, 8, 27, 11, 0).getTime());
    assert.equal(settled.data.interventions[0]?.reenteredWithin30, false);
    assert.equal(settled.data.interventions[2]?.reenteredWithin30, null);
  });
});

describe("policy and cards", () => {
  it("builds the rule policy from settings", () => {
    const policy = buildPolicy({ ...defaultSettings(), level3Threshold: 30, dayEndHour: 7 });
    assert.equal(policy.goalMinutes, 30);
    assert.equal(policy.dayEndHour, 7);
    assert.deepEqual(policy.commitOptions, [3, 5, 10]);
    assert.ok(policy.methods.medium.includes("card"));
  });

  it("imports pasted cards and skips broken ones", () => {
    let n = 0;
    const text = `여기 문제예요:
\`\`\`json
[{"question":"1+1은?","options":["1","2","3","4"],"answer":2},
 {"question":"","options":["a","b"],"answer":1},
 {"question":"수도는?","options":["서울","부산"],"answer":3}]
\`\`\``;
    const result = parseCardImport(text, new Date(2026, 8, 27), () => `c${++n}`);
    assert.equal(result.cards.length, 1);
    assert.equal(result.skipped, 2);
    assert.equal(result.cards[0]?.answer, 1);
    assert.equal(result.cards[0]?.source, "import");
    assert.ok(parseCardImport("그냥 글").error);
  });

  it("sends the least-shown cards to the service", () => {
    const card = (id: string, shown: number) => ({
      id,
      question: id,
      options: ["a", "b"],
      answer: 0,
      createdAt: "2026-09-27T00:00:00.000Z",
      source: "manual" as const,
      shown,
      correct: 0,
      explanation: "",
    });
    const data = { ...defaultData(), cards: [card("seen", 5), card("new", 0)] };
    assert.deepEqual(cardsForService(data, 1).map((c) => c.id), ["new"]);
  });
});

describe("v0.9.2 study cards", () => {
  const studyCard = (id: string, question: string) => ({
    id,
    question,
    options: ["a", "b"],
    answer: 0,
    createdAt: "2026-10-13T00:00:00.000Z",
    source: "import" as const,
    shown: 0,
    correct: 0,
    explanation: "",
  });

  it("skips cards with empty, junk or repeated options", () => {
    let n = 0;
    const text = `[
  {"question":"인플레이션이란?","options":["물가 상승","물가 하락","환율","금리"],"answer":1},
  {"question":"보기가 겹치는 문제","options":["물가 상승","물가  상승!","환율","금리"],"answer":1},
  {"question":"내용 없는 보기 문제","options":["보기1","보기2","보기3","보기4"],"answer":1},
  {"question":"점만 있는 보기 문제","options":["...","물가","환율","금리"],"answer":2},
  {"question":"짧","options":["a","b"],"answer":1}
]`;
    const result = parseCardImport(text, new Date(2026, 9, 13), () => `c${++n}`);
    assert.equal(result.cards.length, 1);
    assert.equal(result.skipped, 4);
  });

  it("does not import the same question twice", () => {
    let n = 0;
    const text = `[
  {"question":"인플레이션이란?","options":["물가 상승","물가 하락"],"answer":1},
  {"question":"인플레이션이란 ?","options":["물가 상승","물가 하락"],"answer":1},
  {"question":"기회비용이란?","options":["포기한 것의 가치","낸 돈"],"answer":1}
]`;
    const existing = [studyCard("old", "기회비용이란?")];
    const result = parseCardImport(text, new Date(2026, 9, 13), () => `c${++n}`, existing);
    assert.equal(result.cards.length, 1);
    assert.equal(result.duplicates, 2);
  });

  it("marks cards whose explanation points at another option", () => {
    let n = 0;
    const text = `[
  {"question":"서유럽 밀 가격은 몇 배?","options":["2배","2.6배","3.3배","4배"],"answer":4,"explanation":"자료에 따르면 2.6배 올랐어요."},
  {"question":"영국 밀 가격은 몇 배?","options":["2배","2.6배","3.3배","4배"],"answer":2,"explanation":"영국은 2.6배, 서유럽은 4배였어요."},
  {"question":"인플레이션이란?","options":["물가 상승","물가 하락"],"answer":1,"explanation":"물가가 전반적으로 계속 오르는 상태예요."}
]`;
    const result = parseCardImport(text, new Date(2026, 9, 13), () => `c${++n}`);
    assert.equal(result.cards.length, 3);
    assert.deepEqual(result.suspectIds, ["c1"]);
    assert.equal(explanationLooksWrong({ options: ["A", "B"], answer: 0, explanation: "" }), false);
  });

  it("passes study mode to the service and keeps the usual activities as fallback", () => {
    const base = defaultData();
    const withCards = { ...base, cards: [studyCard("k", "문제 하나")] };
    const on = buildPolicy({ ...base.settings, studyMode: true }, withCards);
    assert.equal(on.studyMode, true);
    assert.ok(on.methods.medium.includes("breath"));
    assert.equal(buildPolicy(base.settings, withCards).studyMode, false);
  });

  it("asks the AI for concept questions, a range, and a self-check", () => {
    assert.ok(CARD_PROMPT.includes("범위:"));
    assert.ok(CARD_PROMPT.includes("개념을 이해했는지"));
    assert.ok(CARD_PROMPT.includes("다시 확인하고"));
  });

  it("reads card reports from the sheet without making intervention rows", () => {
    const result = convertNativeBatch(defaultData(), {
      sessions: [],
      lockAttempts: [],
      interventions: [
        { id: "r1", createdAt: new Date(2026, 9, 13, 21).getTime(), target: "youtube", level: 2, reason: "선택하지 않음", interventionType: "card", alternativeAction: null, outcome: "card_report", usageSeconds: 0, stage: "card_report", cardId: "bad-card" },
      ],
    });
    assert.deepEqual(result.reports, ["bad-card"]);
    assert.equal(result.interventions.length, 0);
  });
});

describe("v0.8.1", () => {
  it("reads loose ChatGPT output with explanations", () => {
    let n = 0;
    const text = `[
  {“question”: “3-way handshake 첫 단계는?”, "options": ["SYN", "ACK", "FIN", "RST"], "answer": "1번", "explanation": "연결 요청은 SYN으로 시작해요.",},
  {"question": "포트 80은?", "options": ["SSH", "HTTP"], "answer": "HTTP"},
]`;
    const result = parseCardImport(text, new Date(2026, 8, 27), () => `c${++n}`);
    assert.equal(result.error, null);
    assert.equal(result.cards.length, 2);
    assert.equal(result.cards[0]?.answer, 0);
    assert.equal(result.cards[0]?.explanation, "연결 요청은 SYN으로 시작해요.");
    assert.equal(result.cards[1]?.answer, 1);
  });

  it("counts rest from timed locks only, up to now", () => {
    const lock = intervention({
      interventionId: "l",
      timestamp: local(27, 10),
      outcome: "timed-block",
      blockDuration: 30,
    });
    const end = intervention({
      interventionId: "e",
      timestamp: local(27, 23),
      date: "2026-09-27",
      outcome: "day-end",
      blockDuration: 420,
    });
    const data = { ...defaultData(), interventions: [lock, end] };
    assert.equal(Math.round(restSecondsOn(data, "2026-09-27", new Date(2026, 8, 27, 10, 10).getTime())), 600);
    assert.equal(Math.round(restSecondsOn(data, "2026-09-27", new Date(2026, 8, 28).getTime())), 1800);
  });

  it("counts a lock streak back from the day", () => {
    const on = (day: number, outcome: InterventionLog["outcome"]) =>
      intervention({ interventionId: `s${day}`, timestamp: local(day, 12), date: `2026-09-${day}`, outcome });
    const data = {
      ...defaultData(),
      interventions: [on(24, "timed-block"), on(25, "day-end"), on(26, "timed-block"), on(22, "timed-block")],
    };
    assert.equal(lockStreak(data, "2026-09-26"), 3);
    assert.equal(lockStreak(data, "2026-09-27"), 3); // 오늘 아직 없으면 어제부터
    assert.equal(lockStreak(data, "2026-09-23"), 1);
  });
});

describe("month of the tree", () => {
  // 2026년 10월 = 31일, 11월 = 30일, 2026년 2월 = 28일
  const watch = (id: string, month: number, day: number, minutes: number): UsageLog => ({
    usageId: id,
    date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startTime: new Date(2026, month - 1, day, 21, 0).toISOString(),
    endTime: new Date(2026, month - 1, day, 21, minutes).toISOString(),
    duration: minutes * 60,
    clipCount: 1,
    target: "youtube",
    source: "native",
  });

  it("counts kept, missed and future days; days without records are kept", () => {
    const data = {
      ...defaultData(), // 목표 20분
      usageLogs: [watch("a", 10, 1, 10), watch("b", 10, 2, 25), watch("c", 10, 4, 20)],
    };
    const p = getMonthProgress(data, new Date(2026, 9, 5, 12));
    assert.equal(p.monthDays, 31);
    assert.equal(p.countedDays, 31);
    assert.deepEqual(p.dayStates.slice(0, 6), ["kept", "missed", "kept", "kept", "kept", "future"]);
    assert.equal(p.keptDays, 4); // 1일, 3일(기록 없음), 4일(딱 20분), 5일(오늘, 아직 0분)
    assert.equal(p.missedDays, 1);
    assert.equal(p.elapsedDays, 5);
    assert.equal(p.hasRecords, true);
  });

  it("today turns missed once it goes over the goal", () => {
    const data = { ...defaultData(), usageLogs: [watch("a", 10, 1, 5), watch("t", 10, 5, 21)] };
    const p = getMonthProgress(data, new Date(2026, 9, 5, 23));
    assert.equal(p.dayStates[4], "missed");
  });

  it("days before the first record are not counted", () => {
    const data = { ...defaultData(), usageLogs: [watch("a", 10, 15, 5)] };
    const p = getMonthProgress(data, new Date(2026, 9, 20));
    assert.equal(p.beforeDays, 14);
    assert.equal(p.countedDays, 17);
    assert.equal(p.dayStates[13], "before");
    assert.equal(p.dayStates[14], "kept");
    assert.equal(p.elapsedDays, 6);
    // 기록이 전혀 없으면 오늘만 센다
    const fresh = getMonthProgress(defaultData(), new Date(2026, 9, 20));
    assert.equal(fresh.beforeDays, 19);
    assert.equal(fresh.keptDays, 1);
    assert.equal(fresh.hasRecords, false);
  });

  it("keeps month boundaries: a session over midnight counts on both dates", () => {
    const late: UsageLog = {
      ...watch("n", 10, 31, 0),
      startTime: new Date(2026, 9, 31, 23, 50).toISOString(),
      endTime: new Date(2026, 10, 1, 0, 30).toISOString(),
      duration: 40 * 60,
    };
    const data = { ...defaultData(), usageLogs: [watch("a", 10, 1, 1), late] };
    const oct = getMonthProgress(data, new Date(2026, 9, 31, 23, 59));
    assert.equal(oct.dayStates[30], "kept"); // 10분
    const nov = getMonthProgress(data, new Date(2026, 10, 1, 9));
    assert.equal(nov.monthDays, 30);
    assert.equal(nov.dayStates[0], "missed"); // 30분
    assert.equal(nov.dayStates.length, 30);
    const feb = getMonthProgress({ ...defaultData(), usageLogs: [watch("f", 2, 1, 1)] }, new Date(2026, 1, 28));
    assert.equal(feb.monthDays, 28);
    assert.equal(feb.keptDays, 28);
  });

  it("past months: last three, judged at their last day", () => {
    const data = { ...defaultData(), usageLogs: [watch("j", 7, 10, 5), watch("s", 9, 3, 50)] };
    const past = pastMonthProgress(data, new Date(2026, 9, 21));
    assert.deepEqual(past.map((p) => p.month), [7, 8, 9]);
    assert.equal(past[0].beforeDays, 9);
    assert.equal(past[1].hasRecords, false); // 8월은 기록 없음 → 화면에서 씨앗
    assert.equal(past[2].elapsedDays, 30);
    assert.equal(past[2].missedDays, 1);
  });
});

describe("goal by date", () => {
  const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);
  const seen = (day: number, minutes: number): UsageLog => ({
    usageId: `u${day}-${minutes}`,
    date: `2026-10-${String(day).padStart(2, "0")}`,
    startTime: new Date(2026, 9, day, 9).toISOString(),
    endTime: new Date(2026, 9, day, 9, minutes).toISOString(),
    duration: minutes * 60,
    clipCount: 1,
    target: "youtube",
    source: "native",
  });
  const withGoal = (data: AppData, goal: number, now: Date): AppData => {
    const goalLog = nextGoalLog(data, goal, now) ?? data.goalLog;
    return { ...data, goalLog, settings: settingsFromGoal(goal, data.settings) };
  };

  it("uses the current goal when nothing was changed", () => {
    assert.equal(goalMinutesOn(defaultData(), "2026-10-01"), 20);
    assert.equal(nextGoalLog(defaultData(), 20), null);
  });

  it("a lowered goal does not change earlier days", () => {
    let data: AppData = { ...defaultData(), usageLogs: [seen(1, 47)] };
    data = withGoal(data, 50, at(1, 8)); // 1일 아침에 50분으로
    data = withGoal(data, 45, at(2)); // 2일에 45분으로
    assert.equal(goalMinutesOn(data, "2026-10-01"), 20); // 1일 아침 전 목표 20 vs 50 → 20
    assert.equal(goalMinutesOn(data, "2026-10-02"), 45);
    assert.equal(goalMinutesOn(data, "2026-10-03"), 45);
    assert.equal(data.goalLog[0].from, GOAL_SINCE_START);
  });

  it("raising the goal does not rescue today", () => {
    let data: AppData = { ...defaultData(), usageLogs: [seen(5, 30)] };
    data = withGoal(data, 60, at(5, 23));
    assert.equal(goalMinutesOn(data, "2026-10-05"), 20);
    assert.equal(goalMinutesOn(data, "2026-10-06"), 60);
    assert.equal(getMonthProgress(data, at(5, 23)).dayStates[4], "missed");
  });

  it("lowering below what was already watched starts tomorrow", () => {
    let data: AppData = { ...defaultData(), settings: settingsFromGoal(50, defaultData().settings) };
    data = { ...data, usageLogs: [seen(7, 47)] };
    data = withGoal(data, 45, at(7, 21)); // 47분 본 뒤
    assert.equal(goalMinutesOn(data, "2026-10-07"), 50);
    assert.equal(goalMinutesOn(data, "2026-10-08"), 45);
    assert.equal(getMonthProgress(data, at(7, 22)).dayStates[6], "kept");
    // 아직 적게 봤으면 오늘부터
    let early: AppData = { ...defaultData(), settings: settingsFromGoal(50, defaultData().settings) };
    early = { ...early, usageLogs: [seen(7, 8)] };
    early = withGoal(early, 45, at(7, 11));
    assert.equal(goalMinutesOn(early, "2026-10-07"), 45);
  });

  it("reads the goal log back and drops broken rows", () => {
    const data = normalizeData({
      usageLogs: [],
      interventions: [],
      goalLog: [{ from: "2026-10-01", minutes: 30 }, { from: "nope", minutes: 10 }, { from: "2026-10-02", minutes: 0 }],
    });
    assert.ok(data);
    assert.deepEqual(data.goalLog, [{ from: "2026-10-01", minutes: 30 }]);
    assert.deepEqual(normalizeData({ usageLogs: [], interventions: [] })?.goalLog, []);
  });
});
