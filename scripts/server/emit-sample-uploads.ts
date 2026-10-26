import { writeFileSync } from "node:fs";
import { buildUploads } from "../../lib/sync.ts";
import { defaultData, readIntervention, readOpenLog } from "../../lib/storage.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const t = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
const open = readOpenLog({ id: id(50), createdAt: t(20, 22), features: [22, 0, 0.5, 3, 2, 0.2, 1e4, 0.3, 0.75, 0], score: 0.12, band: "medium", tighten: "full", modelVersion: "lr-1", label: true, durationSec: 900 })!;
const iv = readIntervention({ interventionId: id(10), timestamp: t(20, 22), level: 2, reason: "심심해서", outcome: "watch", stage: "entry", interventionType: "pause", commitMinutes: 3, riskBand: "medium", tighten: "full", openId: id(50) })!;
const data = { ...defaultData(),
  usageLogs: [{ usageId: id(1), date: "2026-10-20", startTime: t(20, 22), endTime: t(20, 23), duration: 900, clipCount: 1, target: "youtube" as const, source: "native" as const, openId: id(50) }],
  interventions: [iv],
  lockAttempts: [{ id: id(20), createdAt: t(20, 23), date: "2026-10-20", remainingSec: 300, target: "youtube" as const }],
  openLogs: [open] };
const ups = buildUploads(data, new Set(), id(999), 1, new Date(2026, 9, 21, 9));
writeFileSync(process.argv[2], JSON.stringify(ups));
