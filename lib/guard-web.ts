import { WebPlugin } from "@capacitor/core";
import type { HanbakjaGuardPlugin } from "./guard";

const BLOCKER_KEY = "hanbakja.blocker";

function readBlocker(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(BLOCKER_KEY) !== "0";
}

/** 브라우저에는 접근성 서비스가 없다. 개입 스위치만 기억한다. */
export class HanbakjaGuardWeb extends WebPlugin implements HanbakjaGuardPlugin {
  async getStatus() {
    return {
      enabled: false,
      pendingTarget: "",
      pendingLevel: 0,
      pendingUsageSeconds: 0,
      watching: false,
      blockerEnabled: readBlocker(),
      blockedUntil: 0,
      blockMinutes: 0,
      appVersion: "",
    };
  }

  async setBlocker(options: { enabled: boolean }) {
    localStorage.setItem(BLOCKER_KEY, options.enabled ? "1" : "0");
  }

  async sync() {
    return { sessions: [], interventions: [], lockAttempts: [] };
  }

  async ack() {}

  async finish() {}

  async startBlock() {
    return { blockedUntil: 0 };
  }

  async resetRecords() {}

  async openSettings() {}
}
