import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFlush,
  blockUntilFromMinutes,
  buildIntervention,
  convertNativeBatch,
  finalizeSession,
  hourlyUsage,
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
import { buildPolicy, cardsForService, parseCardImport } from "./policy.ts";
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
      interestTopic: "",
      wakeTime: "07:00",
      aiEnabled: true,
      strictMode: false,
      goalWeekAnswered: "",
    });
    assert.equal(settings.level1Threshold, 15);
    assert.equal(settings.level3Threshold, 30);
    assert.equal(levelForUsage(14 * 60, settings), 1);
    assert.equal(levelForUsage(15 * 60, settings), 2);
    assert.equal(levelForUsage(30 * 60, settings), 3);
  });

  it("reads old saved settings with defaults for the new fields", () => {
    const settings = readSettings({ level1Threshold: 10, level2Threshold: 20, level3Threshold: 20, notificationTime: "21:00" });
    assert.equal(settings.level3Threshold, 20);
    assert.equal(settings.finalGoal, 10);
    assert.equal(settings.dayEndHour, 6);
    assert.equal(settings.interestTopic, "");
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
