import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.focuson.shorts",
  appName: "ShortsAI",
  webDir: "out",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // DB는 암호화 없이 연다. 켜 두면 플러그인이 시작할 때 키 저장소를 열고,
    // 백업 복원 뒤 열쇠가 없으면 플러그인 전체가 멈춘다 (v0.12.1).
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
