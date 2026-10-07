"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { HanbakjaGuard, isGuardTarget, isNativeAndroid } from "@/lib/guard";
import { todayKey, webSecondsOn } from "@/lib/logic";
import { riskHours, hourLabel } from "@/lib/ai";
import { onNotificationAction, scheduleRiskNotice } from "@/lib/notify";
import { buildPolicy, cardsForService } from "@/lib/policy";

/**
 * 안드로이드에서 1.5초마다 접근성 서비스와 맞춘다.
 * 1. 정책표·공부 카드·웹이 잰 오늘 초를 넘기고, 서비스가 쌓은 세션·개입·잠금 시도를 받는다.
 * 2. SQLite에 저장한 뒤에만 ack 해서, 저장 전에 앱이 꺼져도 기록이 남는다.
 * 3. 서비스가 넘긴 개입(Level 3, Instagram)이 있으면 개입 화면을 연다.
 */
export function GuardBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, data, getData, mergeNative, adoptBlock, beginBlock } = useStore();
  const pathRef = useRef(pathname);
  const busy = useRef(false);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(
    () =>
      onNotificationAction({
        open: (route) => router.push(route),
        lock: (minutes) => {
          beginBlock(minutes);
          void HanbakjaGuard.startBlock({ minutes }).catch(() => undefined);
          router.push("/");
        },
      }),
    [beginBlock, router],
  );

  // AI: 위험 시간 알림은 하루에 한 번, 그리고 AI 설정이 바뀔 때 다시 예약한다.
  const aiOn = data?.settings.aiEnabled ?? false;
  const today = todayKey();
  useEffect(() => {
    if (!ready || !isNativeAndroid()) return;
    const current = getData();
    const risk = current && aiOn ? riskHours(current) : null;
    void scheduleRiskNotice(risk ? risk.hours[0] : null, risk ? hourLabel(risk.hours[0]) : "");
  }, [aiOn, getData, ready, today]);

  useEffect(() => {
    if (!ready || !isNativeAndroid()) return;
    let stopped = false;

    async function sync() {
      if (busy.current) return;
      const data = getData();
      if (!data) return;
      busy.current = true;
      try {
        const status = await HanbakjaGuard.getStatus();
        if (stopped) return;
        if (
          status.blockerEnabled &&
          isGuardTarget(status.pendingTarget) &&
          !pathRef.current.startsWith("/watch")
        ) {
          router.push(`/watch?guard=${status.pendingTarget}`);
        }
        if (status.blockedUntil > Date.now()) {
          adoptBlock(status.blockedUntil, status.blockMinutes);
        }
        const today = todayKey();
        const batch = await HanbakjaGuard.sync({
          level1Threshold: data.settings.level1Threshold,
          level3Threshold: data.settings.level3Threshold,
          webDate: today,
          webSeconds: webSecondsOn(data, today),
          policy: buildPolicy(data.settings, data),
          cards: cardsForService(data),
        });
        if (stopped) return;
        const ids = await mergeNative(batch);
        if (ids.length > 0) await HanbakjaGuard.ack({ ids });
      } catch {
        // 저장에 실패하면 ack 하지 않는다. 다음 주기에 다시 받는다.
      } finally {
        busy.current = false;
      }
    }

    void sync();
    const id = window.setInterval(() => void sync(), 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [adoptBlock, getData, mergeNative, ready, router]);

  return null;
}
