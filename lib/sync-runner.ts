import { isNativeAndroid } from "./guard.ts";
import { buildUploads, deleteServerRows, flush, isConfigured, schemaVersion } from "./sync.ts";
import { bakedSyncConfig } from "./sync-config.ts";
import type { AppData } from "./types.ts";

/** 서버에 우리 표가 있는지 다시 확인하는 간격 (팀원이 SQL을 실행하거나 되돌렸을 수 있다) */
const SCHEMA_RECHECK_MS = 6 * 3_600_000;

let chain: Promise<void> = Promise.resolve();

/** 한 번에 하나씩 (주기 실행과 지우기가 겹치지 않게). */
function serial(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function state() {
  const db = await import("./db.ts");
  const saved = await db.readSyncState();
  if (saved) return saved;
  const fresh = { installId: crypto.randomUUID(), pendingDelete: false, schema: 0, schemaCheckedAt: 0 };
  await db.writeSyncState(fresh);
  return fresh;
}

/**
 * 안드로이드에서 주기적으로 부른다. 지우기가 남아 있으면 먼저 하고, 동의했으면 안 보낸 줄을 보낸다.
 * 실패해도 앱 기록에는 영향이 없다 (다음에 다시).
 */
export function runSync(data: AppData | null): Promise<void> {
  return serial(async () => {
    if (!data || !isNativeAndroid()) return;
    const config = bakedSyncConfig();
    if (!isConfigured(config)) return;
    const db = await import("./db.ts");
    let s = await state();
    // 동의하지 않았고 지울 것도 없으면 서버에 아무 요청도 하지 않는다.
    if (!data.settings.usageSyncEnabled && !s.pendingDelete) return;
    if (s.schemaCheckedAt === 0 || Date.now() - s.schemaCheckedAt > SCHEMA_RECHECK_MS) {
      const version = await schemaVersion(config, s.installId);
      if (version === null) return; // 연결 안 됨
      s = { ...s, schema: version, schemaCheckedAt: Date.now() };
      await db.writeSyncState(s);
    }
    if (s.pendingDelete) {
      if (!(await deleteServerRows(config, s.installId, s.schema))) {
        // 우리 표가 되돌려졌을 수 있다: 다음에 표 버전부터 다시 확인한다.
        await db.writeSyncState({ ...s, schemaCheckedAt: 0 });
        return;
      }
      s = { ...s, pendingDelete: false };
      await db.writeSyncState(s);
    }
    if (!data.settings.usageSyncEnabled) return;
    const sent = await db.readSyncSent();
    const uploads = buildUploads(data, sent, s.installId, s.schema);
    if (uploads.length === 0) return;
    await db.markSynced(await flush(uploads, config, s.installId));
  });
}

/**
 * 서버 기록 지우기를 맡긴다 (기록 초기화, 설정의 "서버 기록 지우기").
 * 보낸 기록 목록도 비워서, 다시 동의하면 처음부터 보낸다. 지우기 자체는 다음 runSync에서 한다.
 */
export function requestServerDelete(): Promise<void> {
  return serial(async () => {
    if (!isNativeAndroid()) return;
    const db = await import("./db.ts");
    const s = await state();
    await db.clearSynced();
    await db.writeSyncState({ ...s, pendingDelete: true });
  });
}
