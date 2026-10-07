"use client";

import { useEffect } from "react";

type NativeWindow = Window & {
  Capacitor?: { isNativePlatform?: () => boolean };
};

export function PwaRegister() {
  useEffect(() => {
    const native = (window as NativeWindow).Capacitor?.isNativePlatform?.();
    if (native || !("serviceWorker" in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // 설치 안내는 설정 화면에 있고, 등록 실패가 앱 사용을 막지는 않습니다.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
