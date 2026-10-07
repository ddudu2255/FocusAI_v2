import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Policy } from "./policy";
import type { NativeBatch } from "./types";

export type GuardTarget = "youtube" | "instagram";
export type GuardOutcome = "watch" | "leave" | "block";

export type GuardStatus = {
  enabled: boolean;
  /** 웹 흐름이 이어받을 개입 (Level 3, Instagram). 없으면 "". */
  pendingTarget: string;
  /** 서비스가 감지 순간 정한 Level과 오늘 누적 초. 0이면 없음. */
  pendingLevel: number;
  pendingUsageSeconds: number;
  watching: boolean;
  blockerEnabled: boolean;
  /** 시간 차단이 끝나는 시각(epoch ms). 0이면 없음. */
  blockedUntil: number;
  blockMinutes: number;
  appVersion: string;
};

export type GuardSyncInput = {
  level1Threshold: number;
  level3Threshold: number;
  /** 웹이 직접 잰 오늘 초(연습 피드 등). 네이티브 세션은 서비스가 센다. */
  webDate: string;
  webSeconds: number;
  /** 개입 정책표 (lib/policy.ts). 서비스는 이 표만 읽고 결정한다. */
  policy: Policy;
  /** 시트에 낼 공부 카드 */
  cards: { id: string; question: string; options: string[]; answer: number; explanation: string }[];
};

export interface HanbakjaGuardPlugin {
  getStatus(): Promise<GuardStatus>;
  setBlocker(options: { enabled: boolean }): Promise<void>;
  /** 설정을 넘기고, 서비스가 쌓아 둔 세션·개입·잠금 시도를 받는다. */
  sync(options: GuardSyncInput): Promise<NativeBatch>;
  /** SQLite에 저장한 줄을 서비스 대기열에서 지운다. */
  ack(options: { ids: string[] }): Promise<void>;
  finish(options: {
    outcome: GuardOutcome;
    target: GuardTarget;
    blockMinutes?: number;
    /** "오늘은 끝": 쉰 시간에 넣지 않고, 잠금 뒤 질문도 하지 않는다. */
    dayEnd?: boolean;
  }): Promise<void>;
  startBlock(options: { minutes: number }): Promise<{ blockedUntil: number }>;
  resetRecords(): Promise<void>;
  openSettings(): Promise<void>;
}

export const HanbakjaGuard = registerPlugin<HanbakjaGuardPlugin>("HanbakjaGuard", {
  web: () => import("./guard-web").then((mod) => new mod.HanbakjaGuardWeb()),
});

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function isGuardTarget(value: string): value is GuardTarget {
  return value === "youtube" || value === "instagram";
}

export function guardSourceLabel(target: GuardTarget): string {
  return target === "instagram" ? "Instagram Reels" : "YouTube Shorts";
}
