import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_TAG, fetchCompare, goalBucket, homeLine, keptDaysLastWeek, outOfTen, readCompare, reportLine, sheetCompare } from "./compare.ts";
import { buildPolicy } from "./policy.ts";
import { defaultData } from "./storage.ts";
import type { AppData, UsageLog } from "./types.ts";

const at = (month: number, day: number, hour: number) => new Date(2026, month - 1, day, hour);
function session(day: number, minutes: number): UsageLog {
  const start = at(10, day, 21);
  return {
    usageId: `s${day}`, date: `2026-10-${String(day).padStart(2, "0")}`, startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60_000).toISOString(), duration: minutes * 60, clipCount: 1,
    target: "youtube", source: "native",
  };
}

const response = (demo: boolean) => ({
  demo,
  byHour: Array.from({ length: 24 }, (_, h) => (h === 23 ? { users: 40, opens: 300, shortRate: 0.62, exitRate: 0.08 } : null)),
  byGoal: { "≤30": { users: 25, avgKeptDays: 4 }, "31-45": null },
});

describe("compare stats", () => {
  it("reads the server answer and turns rates into 'N out of 10'", () => {
    const stats = readCompare(response(false));
    assert.ok(stats);
    assert.equal(stats.byHour[23]?.shortRate, 0.62);
    assert.equal(stats.byHour[0], null);
    assert.equal(outOfTen(0.62), 6);
    assert.equal(outOfTen(0.04), null);
    const sheet = sheetCompare(stats);
    assert.equal(sheet?.short[23], 6);
    assert.equal(sheet?.exit[23], 1);
    assert.equal(sheet?.short[0], null);
    assert.equal(readCompare({ byHour: [] }), null);
  });

  it("writes the home and report lines, tagging demo data", () => {
    // 목표 20분(≤30 묶음). 14~20일 중 15·17일만 넘김 → 지난주(14~20일) 5일 지킴
    const data: AppData = { ...defaultData(), usageLogs: [13, 14, 15, 16, 17, 18, 19, 20].map((d) => session(d, d === 15 || d === 17 ? 30 : 10)) };
    const now = at(10, 21, 12);
    assert.equal(keptDaysLastWeek(data, now), 5);
    assert.equal(homeLine(readCompare(response(false)), data, now), "목표가 비슷한 사람들은 지난주 7일 중 평균 4일을 지켰어요. 나는 5일이에요.");
    assert.equal(homeLine(readCompare(response(true)), data, now), `목표가 비슷한 사람들은 지난주 7일 중 평균 4일을 지켰어요. 나는 5일이에요.${DEMO_TAG}`);
    assert.equal(reportLine(readCompare(response(false)), data), "비슷한 목표의 사람들 : 지난주 평균 4일 지킴");
    // 그 목표 묶음에 사람이 모자라면 아무것도 안 띄운다
    const g40 = { ...data, settings: { ...data.settings, level3Threshold: 40 } };
    assert.equal(homeLine(readCompare(response(false)), g40, now), null);
    assert.equal(homeLine(null, data, now), null);
    assert.equal(goalBucket(61), "61+");
  });

  it("ships the per-hour figures to the service", () => {
    const data = { ...defaultData(), compare: readCompare(response(true)) };
    const policy = buildPolicy(data.settings, data);
    assert.equal(policy.compare?.demo, true);
    assert.equal(policy.compare?.short[23], 6);
    assert.equal(buildPolicy(defaultData().settings, defaultData()).compare, null);
  });

  it("asks the server without the install id and survives failures", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const ok = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, headers: init?.headers ?? {}, body: init?.body ?? "" });
      return { ok: true, status: 200, json: async () => response(true) };
    };
    const config = { url: "https://example.supabase.co", anonKey: "k" };
    const stats = await fetchCompare(config, true, ok);
    assert.equal(stats?.demo, true);
    assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/sai_compare");
    assert.equal(calls[0].body, '{"p_demo":true}');
    assert.equal(calls[0].headers["x-install-id"], undefined);
    const down = async () => {
      throw new Error("offline");
    };
    assert.equal(await fetchCompare(config, false, down), null);
  });
});
