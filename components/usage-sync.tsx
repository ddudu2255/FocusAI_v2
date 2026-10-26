"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/components/store";
import { COMPARE_REFRESH_MS, fetchCompare } from "@/lib/compare";
import { isNativeAndroid } from "@/lib/guard";
import { needsOnboarding } from "@/lib/onboarding";
import { bakedSyncConfig } from "@/lib/sync-config";
import { runSync } from "@/lib/sync-runner";

/** 1분마다, 그리고 앱을 다시 열 때 안 보낸 기록을 보낸다 (동의한 경우만, 안드로이드만). */
const SYNC_EVERY_MS = 60_000;

/**
 * 동의 창 문구 (사용자 확인 2026-10-26, docs/server/DESIGN.md). 바꿀 때는 표로 먼저 확인받는다.
 * 팀원 hanbakja의 동의 창을 바탕으로, 새로 보내는 것(이유 번호, 하루 목표, AI 예측 기록)을 더했다.
 */
export const SYNC_COPY = {
  title: "사용 기록을 서버에 보낼까요?",
  body:
    "사용 기록은 이 휴대폰에 그대로 남아요. 보내기를 누르면 쇼츠·릴스를 본 시간, 개입에서 고른 것(이유 버튼, 몇 분, 나가기), " +
    "하루 목표, AI 예측 기록을 이름 없이 서버로 보내요. 다른 사용자와 비교하는 통계와 AI 학습에만 써요. " +
    "성찰 답, 직접 쓴 글, 공부 카드, 화면의 글은 보내지 않아요. 설정에서 언제든 끄고 서버 기록을 지울 수 있어요.",
  agree: "보내기",
  decline: "보내지 않기",
};

export function UsageSync() {
  const { ready, getData, data, answerUsageSync, saveCompare } = useStore();
  const native = typeof window !== "undefined" && isNativeAndroid();
  const enabled = data?.settings.usageSyncEnabled ?? false;
  const demo = data?.settings.demoMode ?? false;
  const fetchedAt = data?.compare?.fetchedAt ?? "";
  const fetchedDemo = data?.compare?.demo ?? null;

  // 비교 통계: 하루 한 번 (보내기에 동의했거나 시연 모드일 때만 서버에 묻는다). 시연 모드를 바꾸면 바로 다시 받는다.
  useEffect(() => {
    if (!ready || (!enabled && !demo)) return;
    const stale = !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > COMPARE_REFRESH_MS || fetchedDemo !== demo;
    if (!stale) return;
    let stopped = false;
    void fetchCompare(bakedSyncConfig(), demo).then((stats) => {
      if (!stopped && stats) saveCompare(stats);
    });
    return () => {
      stopped = true;
    };
  }, [demo, enabled, fetchedAt, fetchedDemo, ready, saveCompare]);

  useEffect(() => {
    if (!ready || !native) return;
    const tick = () => void runSync(getData()).catch(() => undefined);
    tick();
    const id = window.setInterval(tick, SYNC_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, getData, native, ready]);

  // 처음 질문이 먼저, 그다음 동의 창.
  if (!ready || !native || !data || data.settings.usageSyncAsked || needsOnboarding(data)) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="usage-sync-title"
    >
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 id="usage-sync-title" className="text-xl font-semibold tracking-tight">
          {SYNC_COPY.title}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">{SYNC_COPY.body}</p>
        <div className="flex flex-col gap-2">
          <Button type="button" className="h-11" onClick={() => answerUsageSync(true)}>
            {SYNC_COPY.agree}
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => answerUsageSync(false)}>
            {SYNC_COPY.decline}
          </Button>
        </div>
      </div>
    </div>
  );
}
