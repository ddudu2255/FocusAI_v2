"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartColumn, House, NotebookText, Settings } from "lucide-react";
import { useStore } from "@/components/store";
import { isReportDue, todayKey } from "@/lib/logic";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "홈", icon: House },
  { href: "/stats", label: "통계", icon: ChartColumn },
  { href: "/report", label: "리포트", icon: NotebookText },
  { href: "/settings", label: "설정", icon: Settings },
];

function Mark({ className }: { className?: string }) {
  return (
    <img
      src="/icons/icon-192.png"
      alt=""
      className={cn("h-8 w-8 rounded-lg", className)}
    />
  );
}

function LoadingScreen() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center px-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm space-y-4">
        <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-12 animate-pulse rounded-2xl bg-muted" />
        <p className="text-sm text-muted-foreground">기록을 불러오는 중입니다.</p>
      </div>
    </div>
  );
}

function CorruptScreen() {
  const { reload, reset } = useStore();
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-card p-6 ring-1 ring-foreground/10">
        <p className="text-sm font-medium text-destructive">기록을 읽지 못했습니다</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          이 브라우저에 저장된 데이터가 손상되었습니다.
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          사용 시간과 개입 기록을 열 수 없어 통계를 표시하지 않습니다. 다시
          읽거나, 초기화한 뒤 새로 시작할 수 있습니다.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={reload}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            다시 읽기
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium"
          >
            초기화하고 시작
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, corrupt, saveError, dismissSaveError, data } = useStore();
  const immersive = pathname.startsWith("/watch");
  const reportDue = data
    ? isReportDue(data.settings.notificationTime) &&
      data.lastNotifiedDate !== todayKey()
    : false;

  if (!ready) return <LoadingScreen />;
  if (corrupt) return <CorruptScreen />;

  if (immersive) {
    return <div className="min-h-dvh">{children}</div>;
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border/80 md:flex md:flex-col md:px-4 md:py-6">
        <Link href="/" className="flex items-center gap-2 px-2">
          <Mark />
          <span className="text-lg font-semibold tracking-tight">Focus on</span>
        </Link>
        <p className="mt-2 px-2 text-xs leading-5 text-muted-foreground">
          Shorts · Reels 사용 조절
        </p>
        <nav className="mt-8 flex flex-col gap-1" aria-label="주요">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-xl px-3 text-sm",
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
                {item.href === "/report" && reportDue ? (
                  <span className="ml-auto size-2 rounded-full bg-primary" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-h-dvh flex-col">
        {saveError ? (
          <div
            className="flex items-start justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            <p>{saveError}</p>
            <button type="button" className="shrink-0 underline" onClick={dismissSaveError}>
              닫기
            </button>
          </div>
        ) : null}
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">
          <div className="mb-4 flex items-center gap-2 md:hidden">
            <Mark />
            <span className="text-lg font-semibold tracking-tight">Focus on</span>
          </div>
          {children}
        </div>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border/80 bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}
        aria-label="주요"
      >
        <ul className="grid grid-cols-4">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 text-[11px]",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
