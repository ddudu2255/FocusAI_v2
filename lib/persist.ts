import type { Op } from "./db";
import { isNativeAndroid } from "./guard";
import { finalizeSession } from "./logic";
import { defaultData, loadData, saveData } from "./storage";
import type { AppData } from "./types";

export type { Op } from "./db";

/** 기록 저장소. 안드로이드는 SQLite, 브라우저는 localStorage. */
export type Backend = {
  kind: "sqlite" | "local";
  load(): Promise<{ data: AppData; corrupt: boolean; migrated: number }>;
  /** next = 바뀐 뒤 전체 상태, ops = SQLite에 쓸 변경. 순서대로 저장한다. */
  apply(next: AppData, ops: Op[]): Promise<void>;
};

const localBackend: Backend = {
  kind: "local",
  async load() {
    const loaded = loadData();
    return { ...loaded, migrated: 0 };
  },
  async apply(next) {
    saveData(next);
  },
};

function sqliteBackend(): Backend {
  let chain: Promise<void> = Promise.resolve();
  return {
    kind: "sqlite",
    async load() {
      const db = await import("./db");
      const migrated = await db.migrateFromLocalStorage();
      const loaded = await db.loadAll();
      // 연습 피드가 열린 채 앱이 닫혔으면 그 세션을 마감한다.
      const data = finalizeSession(loaded);
      if (loaded.activeSession) {
        const closed = data.usageLogs.find((log) => log.usageId === loaded.activeSession?.usageId);
        await db.applyOps([
          ...(closed ? [{ kind: "session" as const, row: closed }] : []),
          { kind: "activeSession", session: null },
        ]);
      }
      return { data, corrupt: false, migrated };
    },
    apply(_next, ops) {
      const run = chain.then(async () => {
        const db = await import("./db");
        await db.applyOps(ops);
      });
      // 한 번 실패해도 다음 저장은 이어서 시도한다.
      chain = run.catch(() => undefined);
      return run;
    },
  };
}

let chosen: Backend | null = null;

export function backend(): Backend {
  if (!chosen) chosen = isNativeAndroid() ? sqliteBackend() : localBackend;
  return chosen;
}

/** SQLite를 열지 못하면 localStorage로 돌아간다. 데이터는 잃지 않지만 안내한다. */
export async function loadWithFallback(): Promise<{
  data: AppData;
  corrupt: boolean;
  migrated: number;
  fallback: boolean;
}> {
  const first = backend();
  try {
    return { ...(await first.load()), fallback: false };
  } catch {
    if (first.kind === "local") return { data: defaultData(), corrupt: true, migrated: 0, fallback: false };
    chosen = localBackend;
    return { ...(await localBackend.load()), fallback: true };
  }
}
