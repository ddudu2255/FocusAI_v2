import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-kr/korean-400.css";
import "@fontsource/noto-sans-kr/korean-500.css";
import "@fontsource/noto-sans-kr/korean-700.css";
import "@fontsource/noto-sans-kr/latin-400.css";
import "@fontsource/noto-sans-kr/latin-500.css";
import "@fontsource/noto-sans-kr/latin-700.css";
import { AppShell } from "@/components/app-shell";
import { GuardBridge } from "@/components/guard-bridge";
import { PwaRegister } from "@/components/pwa-register";
import { StoreProvider } from "@/components/store";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Focus on",
    template: "%s · Focus on",
  },
  description:
    "YouTube Shorts를 열기 전에 이유를 묻고, 오늘 사용량에 따라 단계적으로 개입하는 사용 조절 앱.",
  applicationName: "Focus on",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Focus on",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4efe4",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full">
        <noscript>Focus on은 자바스크립트가 필요합니다.</noscript>
        <StoreProvider>
          <PwaRegister />
          <GuardBridge />
          <AppShell>{children}</AppShell>
        </StoreProvider>
      </body>
    </html>
  );
}
