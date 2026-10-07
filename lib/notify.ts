import { LocalNotifications } from "@capacitor/local-notifications";
import { isNativeAndroid } from "./guard";
import type { Settings } from "./types";

/** 매일 리포트 알림. 앱이 꺼져 있어도 OS가 보낸다. 통계는 알림을 눌러 앱이 열릴 때 계산한다. */
const REPORT_ID = 2101;
const PREVIEW_ID = 2102;
const RISK_ID = 2103;
const RISK_ACTIONS = "risk-lock";
export const REPORT_ROUTE = "/report";
/** 위험 시간 알림의 버튼으로 잠그는 시간 */
export const RISK_LOCK_MINUTES = 60;

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

function mapPermission(state: string): NotifyPermission {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "default";
}

export async function checkNotifyPermission(): Promise<NotifyPermission> {
  if (!isNativeAndroid()) {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  }
  try {
    return mapPermission((await LocalNotifications.checkPermissions()).display);
  } catch {
    return "unsupported";
  }
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!isNativeAndroid()) {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.requestPermission();
  }
  try {
    return mapPermission((await LocalNotifications.requestPermissions()).display);
  } catch {
    return "unsupported";
  }
}

/**
 * 설정 시각에 매일 반복 알림을 다시 예약한다. 끄면 예약을 지운다.
 * @returns 안내 문구, 문제가 없으면 null
 */
export async function scheduleDailyReport(settings: Settings): Promise<string | null> {
  if (!isNativeAndroid()) return null;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REPORT_ID }] });
    if (!settings.notifyEnabled) return null;
    if ((await checkNotifyPermission()) !== "granted") {
      return "알림 권한이 없어 리포트 알림을 예약하지 못했습니다.";
    }
    const [hour, minute] = settings.notificationTime.split(":").map(Number);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REPORT_ID,
          title: "오늘 리포트가 준비됐어요",
          body: "눌러서 오늘 쇼츠 사용을 확인해 보세요.",
          schedule: { on: { hour, minute }, allowWhileIdle: true },
          smallIcon: "ic_stat_shortsai",
          extra: { route: REPORT_ROUTE },
        },
      ],
    });
    return null;
  } catch {
    return "리포트 알림을 예약하지 못했습니다.";
  }
}

/** 바로 한 번 보내 본다. */
export async function previewReport(): Promise<string | null> {
  if (!isNativeAndroid()) return "unsupported";
  if ((await checkNotifyPermission()) !== "granted") return "알림 권한이 없습니다. 먼저 허용해 주세요.";
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: PREVIEW_ID,
          title: "오늘 리포트가 준비됐어요",
          body: "눌러서 오늘 쇼츠 사용을 확인해 보세요.",
          schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
          smallIcon: "ic_stat_shortsai",
          extra: { route: REPORT_ROUTE },
        },
      ],
    });
    return null;
  } catch {
    return "알림을 보내지 못했습니다.";
  }
}

/**
 * AI: 평소 오래 보던 시간 10분 전에 매일 알림. [1시간 잠그기]를 누르면 잠근다.
 * 위험 시간이 없거나 AI가 꺼져 있으면 예약을 지운다. 문구는 사용자 확인 완료 (docs/HANDOFF.md).
 */
export async function scheduleRiskNotice(firstRiskHour: number | null, label: string): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: RISK_ID }] });
    if (firstRiskHour === null || (await checkNotifyPermission()) !== "granted") return;
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: RISK_ACTIONS,
          actions: [
            { id: "lock", title: `${RISK_LOCK_MINUTES / 60}시간 잠그기` },
            { id: "skip", title: "괜찮아요" },
          ],
        },
      ],
    });
    const hour = (firstRiskHour + 23) % 24;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: RISK_ID,
          title: "곧 평소 오래 보던 시간이에요",
          body: `오늘은 ${label}부터 쇼츠를 잠가 둘까요?`,
          schedule: { on: { hour, minute: 50 }, allowWhileIdle: true },
          smallIcon: "ic_stat_shortsai",
          actionTypeId: RISK_ACTIONS,
          extra: { kind: "risk" },
        },
      ],
    });
  } catch {
    // 알림을 못 걸어도 시트 개입은 그대로 동작한다.
  }
}

/**
 * 알림을 눌렀을 때. 리포트 알림은 리포트로, 위험 시간 알림의 [잠그기]는 잠금.
 * 반환값으로 구독을 끊는다.
 */
export function onNotificationAction(handlers: {
  open: (route: string) => void;
  lock: (minutes: number) => void;
}): () => void {
  if (!isNativeAndroid()) return () => undefined;
  const handle = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const extra = action.notification.extra ?? {};
    if (extra.kind === "risk") {
      if (action.actionId === "lock") handlers.lock(RISK_LOCK_MINUTES);
      else handlers.open("/");
      return;
    }
    const route = extra.route;
    handlers.open(typeof route === "string" ? route : REPORT_ROUTE);
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}
