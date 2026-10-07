"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InterventionFlow } from "@/components/intervention-flow";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import { CLIPS } from "@/lib/clips";
import {
  guardSourceLabel,
  HanbakjaGuard,
  isGuardTarget,
  isNativeAndroid,
  type GuardTarget,
} from "@/lib/guard";
import {
  blockRemainingSeconds,
  formatClock,
  isBlocked,
  levelForUsage,
  todayKey,
  usageSecondsOn,
} from "@/lib/logic";
import type { InterventionInput, Level } from "@/lib/types";

/** 서비스가 감지 순간 정한 Level과 누적 초. 웹 기록보다 앞서 있을 수 있어 이 값을 쓴다. */
type NativeEntry = { target: GuardTarget; level: Level | null; usageSeconds: number };

export function WatchView() {
  const router = useRouter();
  const store = useStore();
  const now = useNow();
  const [phase, setPhase] = useState<"gate" | "play">("gate");
  const [entryUsage, setEntryUsage] = useState<number | null>(null);
  const [entry, setEntry] = useState<NativeEntry | null>(null);
  const recordedBlock = useRef(false);
  const entryRef = useRef<NativeEntry | null>(null);

  async function resolveEntry(): Promise<NativeEntry | null> {
    if (entryRef.current) return entryRef.current;
    if (!isNativeAndroid()) return null;
    try {
      const status = await HanbakjaGuard.getStatus();
      if (!isGuardTarget(status.pendingTarget)) return null;
      const level =
        status.pendingLevel === 1 || status.pendingLevel === 2 || status.pendingLevel === 3
          ? (status.pendingLevel as Level)
          : null;
      const next = {
        target: status.pendingTarget,
        level,
        usageSeconds: status.pendingUsageSeconds,
      };
      entryRef.current = next;
      setEntry(next);
      return next;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    // 개입 화면이 열릴 때 서비스가 넘긴 대상을 한 번 읽는다 (플러그인 응답 뒤 상태를 바꾼다).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolveEntry();
  }, []);

  if (store.data && entryUsage === null) {
    setEntryUsage(usageSecondsOn(store.data, todayKey()));
  }

  const blocked = store.data ? isBlocked(store.data.block, now) : false;
  const guardTarget = entry?.target ?? null;

  // 연습 피드(브라우저)에서 차단 중에 연 경우. 실제 쇼츠는 서비스가 잠금 화면으로 처리한다.
  useEffect(() => {
    if (!store.data || !blocked || phase === "play" || recordedBlock.current) return;
    if (isNativeAndroid() && entryRef.current) return;
    recordedBlock.current = true;
    store.recordLockAttempt("practice", blockRemainingSeconds(store.data.block));
  }, [blocked, phase, store]);

  const leftRealScreen = useRef(false);
  useEffect(() => {
    if (!blocked || phase === "play" || leftRealScreen.current || !isNativeAndroid()) return;
    let cancelled = false;
    void resolveEntry().then(async (found) => {
      if (cancelled || leftRealScreen.current || !found) return;
      leftRealScreen.current = true;
      await HanbakjaGuard.finish({ outcome: "leave", target: found.target }).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [blocked, phase]);

  if (!store.data || entryUsage === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6" role="status">
        <p className="text-sm text-muted-foreground">개입 화면을 준비하고 있습니다.</p>
      </div>
    );
  }

  if (blocked && phase !== "play") {
    const remaining = blockRemainingSeconds(store.data.block, now);
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5">
        <p className="text-sm font-medium text-destructive">쇼츠 쉬는 중</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {guardTarget === "instagram"
            ? "지금은 릴스를 열 수 없습니다."
            : "지금은 쇼츠를 열 수 없습니다."}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          선택한 차단이 끝나기 전에는 피드가 시작되지 않습니다.
        </p>
        <p className="my-8 text-5xl font-semibold tabular-nums">{formatClock(remaining)}</p>
        <Button type="button" className="h-12" onClick={() => router.push("/")}>
          홈으로
        </Button>
      </div>
    );
  }

  if (phase === "play") {
    return <Player />;
  }

  const usage = entry?.level ? entry.usageSeconds : entryUsage;
  const level: Level = entry?.level ?? levelForUsage(entryUsage, store.data.settings);

  function finish(input: InterventionInput) {
    const id = store.recordIntervention({
      ...input,
      target: entryRef.current?.target ?? (isNativeAndroid() ? null : "practice"),
    });
    const blocking = input.outcome === "timed-block" || input.outcome === "day-end";
    if (blocking) {
      store.beginBlock(input.blockDuration);
    }
    if (input.outcome === "watch" && !entryRef.current) {
      store.startWatching(input.level, id);
    }
    void (async () => {
      const found = await resolveEntry();
      if (found) {
        const outcome =
          input.outcome === "watch" ? "watch" : blocking ? "block" : "leave";
        try {
          await HanbakjaGuard.finish({
            outcome,
            target: found.target,
            blockMinutes: blocking ? input.blockDuration : undefined,
            dayEnd: input.outcome === "day-end",
          });
        } catch {
          // Still leave the intervention screen if the bridge is unavailable.
        }
        router.push("/");
        return;
      }
      if (blocking && isNativeAndroid()) {
        await HanbakjaGuard.startBlock({ minutes: input.blockDuration }).catch(() => undefined);
      }
      if (input.outcome === "watch") {
        setPhase("play");
        return;
      }
      router.push("/");
    })();
  }

  const sourceLabel = guardTarget ? guardSourceLabel(guardTarget) : null;

  return (
    <InterventionFlow
      level={level}
      usageSeconds={usage}
      onFinish={finish}
      sourceLabel={sourceLabel}
      dayEndHour={store.data.settings.dayEndHour}
    />
  );
}

function Player() {
  const router = useRouter();
  const store = useStore();
  const [index, setIndex] = useState(0);
  const [clipMs, setClipMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const clipMsRef = useRef(0);
  const storeRef = useRef(store);

  useEffect(() => {
    storeRef.current = store;
  });

  useEffect(() => {
    storeRef.current.cancelDetach();
    const id = window.setInterval(() => {
      const visible = document.visibilityState === "visible";
      setPaused(!visible);
      storeRef.current.flushWatch(visible);
    }, 500);
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      setPaused(!visible);
      storeRef.current.flushWatch(visible);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      storeRef.current.scheduleDetach();
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      clipMsRef.current += 250;
      if (clipMsRef.current >= 8000) {
        clipMsRef.current = 0;
        setClipMs(0);
        setIndex((value) => (value + 1) % CLIPS.length);
        storeRef.current.advanceClip();
        return;
      }
      setClipMs(clipMsRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const data = store.data;
  const session = data?.activeSession;
  const today = todayKey();
  const total = data ? usageSecondsOn(data, today) : 0;
  const liveLevel = data ? levelForUsage(total, data.settings) : 1;
  const clip = CLIPS[index] ?? CLIPS[0];

  function leave() {
    store.stopWatching();
    router.push("/");
  }

  function nextClip() {
    clipMsRef.current = 0;
    setClipMs(0);
    setIndex((value) => (value + 1) % CLIPS.length);
    store.advanceClip();
  }

  return (
    <div className="min-h-dvh bg-[#14110e] text-[#f6f1e7] md:grid md:place-items-center">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col md:min-h-[820px] md:overflow-hidden md:rounded-[28px] md:ring-1 md:ring-white/10">
        <header className="flex items-start justify-between gap-3 px-4 pt-4">
          <div>
            <p className="text-xs text-white/60">시뮬레이션 피드 · 실제 YouTube 아님</p>
            <p className="mt-1 text-sm tabular-nums">
              이번 시청 {formatClock(session?.duration ?? 0)}
            </p>
            <p className="text-xs text-white/60 tabular-nums">오늘 {formatClock(total)}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-white/20 bg-transparent text-[#f6f1e7] hover:bg-white/10"
            onClick={leave}
          >
            시청 종료
          </Button>
        </header>
        {session && liveLevel !== session.levelAtStart ? (
          <p className="mx-4 mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs leading-5">
            사용량이 Level {liveLevel} 구간에 들어왔습니다. 이번 영상은 이어서 볼 수
            있고, 다음에 열면 Level {liveLevel} 개입이 시작됩니다.
          </p>
        ) : null}
        <div className="flex flex-1 items-center px-4 py-6">
          <article
            className="relative flex aspect-[9/16] w-full max-h-[68dvh] flex-col justify-end overflow-hidden rounded-3xl p-5"
            style={{ backgroundImage: `linear-gradient(160deg, ${clip.from}, ${clip.to})` }}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-white/15">
              <div
                className="h-full bg-white"
                style={{ width: `${(clipMs / 8000) * 100}%` }}
              />
            </div>
            <p className="text-xs text-white/70">쇼츠 {index + 1}</p>
            <h1 className="mt-2 text-2xl font-semibold">{clip.title}</h1>
            <p className="mt-2 text-sm leading-6 text-white/80">{clip.caption}</p>
          </article>
        </div>
        {paused ? (
          <p className="px-4 pb-2 text-center text-xs text-white/70" role="status">
            이 탭을 보고 있을 때만 사용 시간이 쌓입니다. 지금은 일시정지입니다.
          </p>
        ) : null}
        <div className="px-4 pb-6">
          <Button
            type="button"
            className="h-12 w-full bg-[#f6f1e7] text-[#14110e] hover:bg-white"
            onClick={nextClip}
          >
            다음 쇼츠
          </Button>
        </div>
      </div>
    </div>
  );
}
