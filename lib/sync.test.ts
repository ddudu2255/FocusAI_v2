import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildUploads, deleteServerRows, flush, schemaVersion, type Upload } from "./sync.ts";
import { defaultData, readIntervention, readOpenLog } from "./storage.ts";
import type { AppData, InterventionLog, UsageLog } from "./types.ts";

const at = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const INSTALL = id(999);
const config = { url: "https://example.supabase.co", anonKey: "sb_publishable_test" };

function session(n: number, start: Date, minutes: number, openId: string | null = null): UsageLog {
  return {
    usageId: id(n),
    date: `2026-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
    duration: minutes * 60,
    clipCount: 1,
    target: "youtube",
    source: "native",
    openId,
  };
}

function intervention(n: number, partial: Partial<InterventionLog> = {}): InterventionLog {
  const log = readIntervention({
    interventionId: id(n),
    timestamp: at(10, 20, 22).toISOString(),
    level: 2,
    reason: "심심해서",
    outcome: "watch",
    stage: "entry",
    interventionType: "pause",
    commitMinutes: 3,
    ...partial,
  });
  assert.ok(log);
  return { ...log, ...partial } as InterventionLog;
}

function data(): AppData {
  const open = readOpenLog({
    id: id(50), createdAt: at(10, 20, 22).toISOString(), features: [22, 0, 0.5, 3, 2, 0.2, 1e4, 0.3, 0.75, 0],
    score: 0.12, band: "medium", tighten: "full", modelVersion: "lr-1", label: true, durationSec: 900,
  });
  const pending = readOpenLog({
    id: id(51), createdAt: at(10, 20, 23).toISOString(), features: [23, 0, 0.6, 4, 2, 0.2, 1e4, 0.3, 0.75, 0],
    score: 0.1, band: "low", modelVersion: "lr-1",
  });
  assert.ok(open && pending);
  return {
    ...defaultData(),
    usageLogs: [session(1, at(10, 18, 21), 10), session(2, at(10, 20, 22), 15, id(50))],
    interventions: [
      intervention(10),
      intervention(11, { outcome: "exit", reenteredWithin30: null }), // 30분 판정 전 → 아직 안 보냄
      intervention(12, { outcome: "kept", reenteredWithin30: false, reason: "기타", reasonNote: "비밀 메모" }),
    ],
    lockAttempts: [{ id: id(20), createdAt: at(10, 20, 23).toISOString(), date: "2026-10-20", remainingSec: 300, target: "youtube" }],
    openLogs: [open, pending],
  };
}

/** SQL 파일에서 표의 칸 이름을 꺼낸다 (앱이 보내는 칸과 맞는지 확인용). */
function columns(sql: string, table: string): string[] {
  const body = sql.slice(sql.indexOf(`create table if not exists public.${table} (`));
  const inside = body.slice(body.indexOf("(") + 1, body.indexOf("\n);"));
  return inside
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name && !name.startsWith("primary") && !name.startsWith("constraint"));
}

/** 팀원 hanbakja focusai 브랜치 supabase/schema.sql의 칸 (바꾸지 않는 표). */
const TEAMMATE = {
  sessions: ["event_id", "install_id", "target", "source", "started_at", "ended_at", "duration_sec", "clip_count"],
  interventions: ["event_id", "install_id", "created_at", "weekday", "intensity", "stage", "method", "commit_minutes",
    "card_correct", "outcome", "reentered_within_30min", "policy_version"],
  lock_attempts: ["event_id", "install_id", "created_at", "remaining_sec"],
};

describe("what is uploaded", () => {
  const now = at(10, 21, 9);

  it("before our SQL: only the teammate's three tables", () => {
    const tables = new Set(buildUploads(data(), new Set(), INSTALL, 0, now).map((u) => u.table));
    assert.deepEqual([...tables].sort(), ["interventions", "lock_attempts", "sessions"]);
  });

  it("after our SQL: also open logs, links, details and daily summaries", () => {
    const ups = buildUploads(data(), new Set(), INSTALL, 1, now);
    const count = (t: string) => ups.filter((u) => u.table === t).length;
    assert.equal(count("sessions"), 2);
    assert.equal(count("sai_session_links"), 2);
    assert.equal(count("interventions"), 2); // 30분 판정 전인 줄은 빠짐
    assert.equal(count("sai_intervention_details"), 2);
    assert.equal(count("lock_attempts"), 1);
    assert.equal(count("sai_opens"), 1); // 정답이 안 붙은 열기는 빠짐
    // 하루 요약: 기록이 처음 생긴 18일부터 어제(20일)까지, 오늘(21일)은 빠짐
    assert.deepEqual(ups.filter((u) => u.table === "sai_daily").map((u) => u.row.day), ["2026-10-18", "2026-10-19", "2026-10-20"]);
  });

  it("matches the column names of every table exactly", () => {
    const sql = readFileSync(new URL("../supabase/shortsai_v1.sql", import.meta.url), "utf8");
    const ups = buildUploads(data(), new Set(), INSTALL, 1, now);
    for (const table of new Set(ups.map((u) => u.table))) {
      const expected = table in TEAMMATE ? TEAMMATE[table as keyof typeof TEAMMATE] : columns(sql, table);
      for (const u of ups.filter((x) => x.table === table)) {
        assert.deepEqual(Object.keys(u.row).sort(), [...expected].sort(), table);
      }
    }
  });

  it("never sends free text, and sends the reason only as a number", () => {
    const ups = buildUploads(data(), new Set(), INSTALL, 1, now);
    const text = JSON.stringify(ups);
    assert.ok(!text.includes("비밀 메모"));
    assert.ok(!text.includes("심심해서") && !text.includes("기타"));
    const details = ups.filter((u) => u.table === "sai_intervention_details").map((u) => u.row.reason);
    assert.deepEqual(details, [0, 5]);
  });

  it("skips rows already sent and the session still playing", () => {
    const d = { ...data(), activeSession: { usageId: id(2), date: "2026-10-20", startTime: "", duration: 0, clipCount: 1, interventionId: "", levelAtStart: 1 as const, lastTickAt: 0 } };
    const sent = new Set([`sessions:${id(1)}`, `lock_attempts:${id(20)}`]);
    const ups = buildUploads(d, sent, INSTALL, 0, now);
    assert.equal(ups.filter((u) => u.table === "sessions").length, 0);
    assert.equal(ups.filter((u) => u.table === "lock_attempts").length, 0);
    assert.ok(ups.every((u) => u.row.install_id === INSTALL));
  });
});

type Call = { url: string; body: string; headers: Record<string, string> };
function fakeFetch(answer: (call: Call) => number | { status: number; json: unknown }) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    const call = { url, body: init?.body ?? "", headers: init?.headers ?? {} };
    calls.push(call);
    const a = answer(call);
    const status = typeof a === "number" ? a : a.status;
    if (status === 0) throw new Error("offline");
    return { ok: status >= 200 && status < 300, status, json: async () => (typeof a === "number" ? null : a.json) };
  };
  return { impl, calls };
}

describe("sending", () => {
  const ups: Upload[] = [
    { table: "sessions", key: "sessions:a", row: { event_id: "a" } },
    { table: "sessions", key: "sessions:b", row: { event_id: "b" } },
    { table: "lock_attempts", key: "lock_attempts:c", row: { event_id: "c" } },
  ];

  it("sends each table in one batch with the install id header", async () => {
    const f = fakeFetch(() => 201);
    const done = await flush(ups, config, INSTALL, f.impl);
    assert.deepEqual(done, ["sessions:a", "sessions:b", "lock_attempts:c"]);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].url, "https://example.supabase.co/rest/v1/sessions");
    assert.equal(f.calls[0].headers["x-install-id"], INSTALL);
    assert.equal(f.calls[0].headers.Prefer, "return=minimal");
  });

  it("on 409 retries one by one so new rows are not lost", async () => {
    const f = fakeFetch((c) => (JSON.parse(c.body).length > 1 ? 409 : c.body.includes('"a"') ? 409 : 201));
    const done = await flush(ups.slice(0, 2), config, INSTALL, f.impl);
    assert.deepEqual(done.sort(), ["sessions:a", "sessions:b"]);
  });

  it("keeps rows for next time when offline or refused", async () => {
    assert.deepEqual(await flush(ups, config, INSTALL, fakeFetch(() => 0).impl), []);
    assert.deepEqual(await flush(ups, config, INSTALL, fakeFetch((c) => (c.url.endsWith("sessions") ? 400 : 201)).impl), ["lock_attempts:c"]);
  });

  it("does nothing without a server or a valid install id", async () => {
    const f = fakeFetch(() => 201);
    assert.deepEqual(await flush(ups, { url: "", anonKey: "" }, INSTALL, f.impl), []);
    assert.deepEqual(await flush(ups, config, "not-a-uuid", f.impl), []);
    assert.equal(f.calls.length, 0);
  });

  it("finds out whether our SQL has been run", async () => {
    assert.equal(await schemaVersion(config, INSTALL, fakeFetch(() => ({ status: 200, json: 1 })).impl), 1);
    assert.equal(await schemaVersion(config, INSTALL, fakeFetch(() => 404).impl), 0);
    assert.equal(await schemaVersion(config, INSTALL, fakeFetch(() => 0).impl), null);
  });

  it("deletes with our function when it exists, the teammate's otherwise", async () => {
    const f = fakeFetch(() => 204);
    assert.equal(await deleteServerRows(config, INSTALL, 1, f.impl), true);
    assert.equal(await deleteServerRows(config, INSTALL, 0, f.impl), true);
    assert.deepEqual(f.calls.map((c) => c.url.split("/").pop()), ["sai_delete_own", "delete_own_usage"]);
  });
});
