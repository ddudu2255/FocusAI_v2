"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HanbakjaGuard, isNativeAndroid } from "@/lib/guard";
import {
  applyFlush,
  blockUntilFromMinutes,
  buildIntervention,
  convertNativeBatch,
  finalizeSession,
  isReportDue,
  reportLines,
  settleReentry,
  statsForDate,
  todayKey,
  withClip,
} from "@/lib/logic";
import {
  checkNotifyPermission,
  previewReport,
  requestNotifyPermission,
  scheduleDailyReport,
  type NotifyPermission,
} from "@/lib/notify";
import { backend, loadWithFallback, type Op } from "@/lib/persist";
import { clearData, defaultData } from "@/lib/storage";
import type {
  AppData,
  InterventionInput,
  Level,
  NativeBatch,
  SessionTarget,
  Settings,
  StudyCard,
} from "@/lib/types";

const SAVE_ERROR = "기록을 저장하지 못했습니다. 저장 공간이 가득 찼을 수 있습니다.";
const FALLBACK_ERROR =
  "기기 데이터베이스를 열지 못해 임시 저장소에 기록합니다. 앱을 다시 열어 주세요.";

type StoreContextValue = {
  ready: boolean;
  corrupt: boolean;
  saveError: string | null;
  data: AppData | null;
  storageKind: "sqlite" | "local";
  permission: NotifyPermission;
  /** 예약 알림을 걸지 못했을 때 안내. */
  notifyIssue: string | null;
  getData: () => AppData | null;
  reload: () => void;
  reset: () => Promise<void>;
  dismissSaveError: () => void;
  saveSettings: (settings: Settings) => void;
  recordIntervention: (input: InterventionInput) => string;
  recordLockAttempt: (target: SessionTarget | null, remainingSec: number) => void;
  startWatching: (level: Level, interventionId: string) => void;
  flushWatch: (visible: boolean) => void;
  advanceClip: () => void;
  stopWatching: () => void;
  beginBlock: (minutes: number) => void;
  /** 서비스 쪽 차단이 더 길면 화면에도 반영한다. */
  adoptBlock: (untilMs: number, minutes: number) => void;
  /** 서비스 기록을 저장하고, 저장한(또는 이미 있던) id를 돌려준다. 그 뒤에 ack 한다. */
  mergeNative: (batch: NativeBatch) => Promise<string[]>;
  markReportSeen: () => void;
  addCards: (cards: StudyCard[]) => void;
  deleteCard: (id: string) => void;
  cancelDetach: () => void;
  scheduleDetach: () => void;
  requestNotificationPermission: () => Promise<string | null>;
  previewNotification: () => Promise<string | null>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

type Change = { next: AppData; ops: Op[] };

/** 연습 피드 세션 한 줄과 열린 세션 상태를 저장하는 변경. */
function practiceOps(next: AppData, usageId: string | undefined): Op[] {
  const row = usageId ? next.usageLogs.find((log) => log.usageId === usageId) : undefined;
  return [
    ...(row ? [{ kind: "session" as const, row }] : []),
    { kind: "activeSession" as const, session: next.activeSession },
  ];
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [storageKind, setStorageKind] = useState<"sqlite" | "local">("local");
  const [permission, setPermission] = useState<NotifyPermission>("default");
  const [notifyIssue, setNotifyIssue] = useState<string | null>(null);
  const dataRef = useRef<AppData | null>(null);
  const detachRef = useRef<number | null>(null);

  /** 상태와 저장소를 함께 바꾼다. 저장이 끝나면 resolve. */
  const mutate = useCallback((recipe: (current: AppData) => Change | null) => {
    const current = dataRef.current;
    if (!current) return Promise.resolve();
    const change = recipe(current);
    if (!change) return Promise.resolve();
    dataRef.current = change.next;
    setData(change.next);
    return backend()
      .apply(change.next, change.ops)
      .then(
        () => setSaveError(null),
        (error: unknown) => {
          setSaveError(SAVE_ERROR);
          throw error;
        },
      );
  }, []);

  const fire = useCallback(
    (recipe: (current: AppData) => Change | null) => {
      void mutate(recipe).catch(() => undefined);
    },
    [mutate],
  );

  const load = useCallback(async () => {
    try {
      const loaded = await loadWithFallback();
      dataRef.current = loaded.corrupt ? null : loaded.data;
      setCorrupt(loaded.corrupt);
      setData(loaded.corrupt ? null : loaded.data);
      setStorageKind(backend().kind);
      setSaveError(loaded.fallback ? FALLBACK_ERROR : null);
    } catch {
      setCorrupt(true);
      setData(null);
    } finally {
      setReady(true);
      setPermission(await checkNotifyPermission());
    }
  }, []);

  useEffect(() => {
    // 저장소는 마운트 뒤에 읽어 서버 렌더와 첫 화면이 같게 한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const reload = useCallback(() => {
    setReady(false);
    void load();
  }, [load]);

  // 안드로이드: 설정이 바뀌거나 앱을 열 때 매일 리포트 알림을 다시 예약한다.
  const settingsKey = data
    ? `${data.settings.notificationTime}|${data.settings.notifyEnabled}|${permission}`
    : "";
  useEffect(() => {
    if (!ready || !isNativeAndroid() || !dataRef.current) return;
    void scheduleDailyReport(dataRef.current.settings).then(setNotifyIssue);
  }, [ready, settingsKey]);

  const reset = useCallback(async () => {
    // 공부 카드는 사용자가 만든 내용이라 남기고, 푼 횟수만 지운다.
    const fresh = {
      ...defaultData(),
      cards: (dataRef.current?.cards ?? []).map((card) => ({ ...card, shown: 0, correct: 0 })),
    };
    if (backend().kind === "local") clearData();
    dataRef.current = dataRef.current ?? fresh;
    await mutate(() => ({
      next: fresh,
      ops: [{ kind: "clear" }, { kind: "settings", settings: fresh.settings }],
    })).catch(() => undefined);
    if (isNativeAndroid()) await HanbakjaGuard.resetRecords().catch(() => undefined);
    setCorrupt(false);
  }, [mutate]);

  const dismissSaveError = useCallback(() => setSaveError(null), []);

  const saveSettings = useCallback(
    (settings: Settings) => {
      fire((current) => ({
        next: { ...current, settings },
        ops: [{ kind: "settings", settings }],
      }));
    },
    [fire],
  );

  const recordIntervention = useCallback(
    (input: InterventionInput) => {
      const id = crypto.randomUUID();
      const row = buildIntervention(input, id);
      fire((current) => ({
        next: { ...current, interventions: [...current.interventions, row] },
        ops: [{ kind: "intervention", row }],
      }));
      return id;
    },
    [fire],
  );

  const recordLockAttempt = useCallback(
    (target: SessionTarget | null, remainingSec: number) => {
      const now = new Date();
      const row = {
        id: crypto.randomUUID(),
        createdAt: now.toISOString(),
        date: todayKey(now),
        remainingSec: Math.max(0, Math.round(remainingSec)),
        target,
      };
      fire((current) => ({
        next: { ...current, lockAttempts: [...current.lockAttempts, row] },
        ops: [{ kind: "lock", row }],
      }));
    },
    [fire],
  );

  const startWatching = useCallback(
    (level: Level, interventionId: string) => {
      const now = Date.now();
      fire((current) => {
        const previous = current.activeSession?.usageId;
        const settled = finalizeSession(current, now);
        const usageId = crypto.randomUUID();
        const startTime = new Date(now).toISOString();
        const date = todayKey(new Date(now));
        const row = {
          usageId,
          date,
          startTime,
          endTime: startTime,
          duration: 0,
          clipCount: 1,
          target: "practice" as const,
          source: "web" as const,
        };
        const next: AppData = {
          ...settled,
          activeSession: {
            usageId,
            date,
            startTime,
            duration: 0,
            clipCount: 1,
            interventionId,
            levelAtStart: level,
            lastTickAt: now,
          },
          usageLogs: [...settled.usageLogs, row],
        };
        const closed = previous ? practiceOps(settled, previous).slice(0, -1) : [];
        return { next, ops: [...closed, ...practiceOps(next, usageId)] };
      });
    },
    [fire],
  );

  const flushWatch = useCallback(
    (visible: boolean) => {
      fire((current) => {
        if (!current.activeSession) return null;
        const next = applyFlush(current, visible);
        return { next, ops: practiceOps(next, current.activeSession.usageId) };
      });
    },
    [fire],
  );

  const advanceClip = useCallback(() => {
    fire((current) => {
      if (!current.activeSession) return null;
      const next = withClip(current);
      return { next, ops: practiceOps(next, current.activeSession.usageId) };
    });
  }, [fire]);

  const cancelDetach = useCallback(() => {
    if (detachRef.current !== null) {
      window.clearTimeout(detachRef.current);
      detachRef.current = null;
    }
  }, []);

  const closePractice = useCallback(
    (flush: boolean) => {
      fire((current) => {
        if (!current.activeSession) return null;
        const visible =
          typeof document === "undefined" || document.visibilityState === "visible";
        const flushed = flush ? applyFlush(current, visible) : current;
        const next = finalizeSession(flushed);
        return { next, ops: practiceOps(next, current.activeSession.usageId) };
      });
    },
    [fire],
  );

  const stopWatching = useCallback(() => {
    cancelDetach();
    closePractice(true);
  }, [cancelDetach, closePractice]);

  const scheduleDetach = useCallback(() => {
    cancelDetach();
    flushWatch(typeof document === "undefined" || document.visibilityState === "visible");
    detachRef.current = window.setTimeout(() => {
      detachRef.current = null;
      closePractice(false);
    }, 400);
  }, [cancelDetach, closePractice, flushWatch]);

  const beginBlock = useCallback(
    (minutes: number) => {
      const block = { minutes, until: blockUntilFromMinutes(minutes) };
      fire((current) => ({ next: { ...current, block }, ops: [{ kind: "block", block }] }));
    },
    [fire],
  );

  const adoptBlock = useCallback(
    (untilMs: number, minutes: number) => {
      fire((current) => {
        const mine = current.block.until ? new Date(current.block.until).getTime() : 0;
        if (!untilMs || untilMs <= mine) return null;
        const block = { minutes, until: new Date(untilMs).toISOString() };
        return { next: { ...current, block }, ops: [{ kind: "block", block }] };
      });
    },
    [fire],
  );

  const mergeNative = useCallback(
    async (batch: NativeBatch) => {
      const ids = [
        ...(batch.sessions ?? []).map((row) => row.id),
        ...(batch.interventions ?? []).map((row) => row.id),
        ...(batch.lockAttempts ?? []).map((row) => row.id),
      ].filter(Boolean);
      await mutate((current) => {
        const added = convertNativeBatch(current, batch);
        // "도움이 됐나요?" 답을 해당 개입 기록에 붙인다 (같은 묶음에 온 기록 포함).
        const answers = new Map(added.feedback.map((f) => [f.refId, f.feedback]));
        const withFeedback = (rows: AppData["interventions"]) =>
          rows.map((row) =>
            answers.has(row.interventionId) ? { ...row, feedback: answers.get(row.interventionId) ?? null } : row,
          );
        const merged: AppData = {
          ...current,
          usageLogs: [...current.usageLogs, ...added.usageLogs],
          interventions: withFeedback([...current.interventions, ...added.interventions]),
          lockAttempts: [...current.lockAttempts, ...added.lockAttempts],
        };
        // 시트에서 푼 카드의 본 횟수·정답 수를 올린다.
        const cardHits = new Map<string, { shown: number; correct: number }>();
        for (const row of added.interventions) {
          if (!row.cardId || row.cardCorrect === null) continue;
          const hit = cardHits.get(row.cardId) ?? { shown: 0, correct: 0 };
          hit.shown += 1;
          if (row.cardCorrect) hit.correct += 1;
          cardHits.set(row.cardId, hit);
        }
        const touchedCards: StudyCard[] = [];
        if (cardHits.size > 0) {
          merged.cards = current.cards.map((card) => {
            const hit = cardHits.get(card.id);
            if (!hit) return card;
            const next = { ...card, shown: card.shown + hit.shown, correct: card.correct + hit.correct };
            touchedCards.push(next);
            return next;
          });
        }
        const settled = settleReentry(merged);
        const ops: Op[] = [
          ...touchedCards.map((row) => ({ kind: "card" as const, row })),
          ...added.usageLogs.map((row) => ({ kind: "session" as const, row })),
          ...added.lockAttempts.map((row) => ({ kind: "lock" as const, row })),
          // 재진입 판정이 붙은 개입은 최신 내용으로 덮어쓴다.
          ...settled.data.interventions
            .filter(
              (row) =>
                added.interventions.some((a) => a.interventionId === row.interventionId) ||
                answers.has(row.interventionId) ||
                settled.changed.some((c) => c.interventionId === row.interventionId),
            )
            .map((row) => ({ kind: "intervention" as const, row })),
        ];
        if (ops.length === 0) return null;
        return { next: settled.data, ops };
      });
      return ids;
    },
    [mutate],
  );

  const addCards = useCallback(
    (cards: StudyCard[]) => {
      if (cards.length === 0) return;
      fire((current) => ({
        next: { ...current, cards: [...current.cards, ...cards] },
        ops: cards.map((row) => ({ kind: "card" as const, row })),
      }));
    },
    [fire],
  );

  const deleteCard = useCallback(
    (id: string) => {
      fire((current) => ({
        next: { ...current, cards: current.cards.filter((card) => card.id !== id) },
        ops: [{ kind: "deleteCard", id }],
      }));
    },
    [fire],
  );

  const markReportSeen = useCallback(() => {
    const today = todayKey();
    fire((current) => {
      if (current.lastNotifiedDate === today) return null;
      return {
        next: { ...current, lastNotifiedDate: today },
        ops: [{ kind: "lastNotifiedDate", date: today }],
      };
    });
  }, [fire]);

  // 브라우저에서만: 앱이 열려 있을 때 리포트 시각이 지나면 Notification API로 알린다.
  const notifyInBrowser = useCallback((current: AppData) => {
    if (!current.settings.notifyEnabled) return "알림이 꺼져 있습니다.";
    if (typeof Notification === "undefined") return "이 브라우저는 알림을 지원하지 않습니다.";
    if (Notification.permission !== "granted") return "브라우저 알림 권한이 없습니다.";
    const stats = statsForDate(current, todayKey());
    const body = reportLines(stats).slice(0, 4).join(" · ");
    new Notification("오늘의 Shorts 사용 리포트", { body, lang: "ko" });
    return null;
  }, []);

  useEffect(() => {
    if (!ready || isNativeAndroid()) return;
    const check = () => {
      const current = dataRef.current;
      if (!current || !current.settings.notifyEnabled) return;
      if (!isReportDue(current.settings.notificationTime)) return;
      const today = todayKey();
      if (current.lastNotifiedDate === today) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (notifyInBrowser(current)) return;
      fire((latest) => ({
        next: { ...latest, lastNotifiedDate: today },
        ops: [{ kind: "lastNotifiedDate", date: today }],
      }));
    };
    check();
    const id = window.setInterval(check, 15000);
    return () => window.clearInterval(id);
  }, [fire, notifyInBrowser, ready]);

  // 30분이 지난 개입의 재진입 여부를 채운다 (앱이 열려 있는 동안 1분마다).
  useEffect(() => {
    if (!ready) return;
    const settle = () =>
      fire((current) => {
        const settled = settleReentry(current);
        if (settled.changed.length === 0) return null;
        return {
          next: settled.data,
          ops: settled.changed.map((row) => ({ kind: "intervention" as const, row })),
        };
      });
    settle();
    const id = window.setInterval(settle, 60_000);
    return () => window.clearInterval(id);
  }, [fire, ready]);

  const requestNotificationPermission = useCallback(async () => {
    const result = await requestNotifyPermission();
    setPermission(result);
    if (result === "unsupported") return "이 기기에서는 알림을 쓸 수 없습니다.";
    if (result === "denied") {
      return isNativeAndroid()
        ? "알림이 꺼져 있습니다. 휴대폰 설정 → 애플리케이션 → ShortsAI → 알림에서 허용해 주세요."
        : "알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용해 주세요.";
    }
    if (result !== "granted") return "알림 권한을 허용하지 않았습니다.";
    return null;
  }, []);

  const previewNotification = useCallback(async () => {
    const current = dataRef.current;
    if (!current) return "기록을 아직 불러오지 못했습니다.";
    if (isNativeAndroid()) return previewReport();
    return notifyInBrowser(current);
  }, [notifyInBrowser]);

  const getData = useCallback(() => dataRef.current, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      ready,
      corrupt,
      saveError,
      data,
      storageKind,
      permission,
      notifyIssue,
      getData,
      reload,
      reset,
      dismissSaveError,
      saveSettings,
      recordIntervention,
      recordLockAttempt,
      startWatching,
      flushWatch,
      advanceClip,
      stopWatching,
      beginBlock,
      adoptBlock,
      mergeNative,
      markReportSeen,
      addCards,
      deleteCard,
      cancelDetach,
      scheduleDetach,
      requestNotificationPermission,
      previewNotification,
    }),
    [
      ready,
      corrupt,
      saveError,
      data,
      storageKind,
      permission,
      notifyIssue,
      getData,
      reload,
      reset,
      dismissSaveError,
      saveSettings,
      recordIntervention,
      recordLockAttempt,
      startWatching,
      flushWatch,
      advanceClip,
      stopWatching,
      beginBlock,
      adoptBlock,
      mergeNative,
      markReportSeen,
      addCards,
      deleteCard,
      cancelDetach,
      scheduleDetach,
      requestNotificationPermission,
      previewNotification,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("StoreProvider가 필요합니다.");
  return value;
}
