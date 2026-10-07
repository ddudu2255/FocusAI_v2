import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // 설정 화면에 보이는 버전. APK의 versionName도 같은 package.json 값을 쓴다.
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
