import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.focuson.shorts",
  appName: "ShortsAI",
  webDir: "out",
  android: {
    allowMixedContent: false,
  },
};

export default config;
