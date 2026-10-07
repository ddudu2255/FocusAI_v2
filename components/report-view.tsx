"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import { isNativeAndroid } from "@/lib/guard";
import {
  formatKoreanDate,
  isReportDue,
  reportLines,
  statsForDate,
  todayKey,
} from "@/lib/logic";

export function ReportView() {
  const { data, permission, previewNotification, markReportSeen } = useStore();
  const now = useNow(5000);
  const [notice, setNotice] = useState<string | null>(null);
  const native = isNativeAndroid();
  const due = data ? isReportDue(data.settings.notificationTime, new Date(now)) : false;

  // 리포트 시각이 지난 뒤 이 화면을 열면 오늘 리포트를 본 것으로 표시한다.
  useEffect(() => {
    if (due) markReportSeen();
  }, [due, markReportSeen]);

  if (!data) return null;

  const today = todayKey(new Date(now));
  const stats = statsForDate(data, today);
  const empty =
    stats.usageSeconds === 0 &&
    stats.interventionCount === 0 &&
    stats.clipCount === 0;
  const lines = reportLines(stats);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header>
        <p className="text-sm text-muted-foreground">{formatKoreanDate(today)}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {due ? "오늘의 Shorts 사용 리포트" : "오늘의 중간 집계"}
        </h1>
      </header>

      {empty ? (
        <div className="rounded-3xl bg-card px-5 py-8 ring-1 ring-foreground/10">
          <p className="text-lg font-medium">오늘 기록된 사용이 없습니다.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {due
              ? "리포트 시각은 지났지만, 쇼츠를 열지 않아 집계가 비어 있습니다."
              : `${data.settings.notificationTime}에 리포트가 도착합니다. 그 전에 쇼츠를 열면 사용 시간과 개입이 여기 모입니다.`}
          </p>
        </div>
      ) : (
        <article className="rounded-3xl bg-card px-5 py-6 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            {due
              ? "하루를 이렇게 정리했습니다."
              : `${data.settings.notificationTime}까지는 중간 집계입니다.`}
          </p>
          <ul className="mt-4 space-y-2">
            {lines.map((line) => (
              <li key={line} className="text-lg leading-8">
                {line}
              </li>
            ))}
          </ul>
          {stats.forceQuitCount > 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              강제 종료 {stats.forceQuitCount}회
            </p>
          ) : null}
        </article>
      )}

      <div className="space-y-2 text-sm leading-6 text-muted-foreground">
        {!data.settings.notifyEnabled ? (
          <p>리포트 알림이 설정에서 꺼져 있습니다. 이 화면의 리포트는 그대로 볼 수 있습니다.</p>
        ) : native && permission === "granted" ? (
          <p>
            매일 {data.settings.notificationTime}에 앱이 꺼져 있어도 알림이 옵니다. 누르면 이
            화면이 열립니다.
          </p>
        ) : native ? (
          <p>알림 권한이 없어 리포트 알림이 오지 않습니다. 설정 화면에서 알림을 허용해 주세요.</p>
        ) : permission === "granted" ? (
          <p>
            알림 권한이 있습니다. 앱이 열려 있고 시각이 {data.settings.notificationTime}을
            지나면 같은 내용을 브라우저 알림으로도 보냅니다.
          </p>
        ) : permission === "denied" ? (
          <p>
            브라우저가 알림을 막았습니다. 사이트 설정에서 허용하거나, 이 화면에서
            리포트를 확인하세요.
          </p>
        ) : permission === "unsupported" ? (
          <p>이 브라우저는 알림을 지원하지 않습니다. 리포트는 이 화면에서 확인합니다.</p>
        ) : (
          <p>알림을 받으려면 설정에서 브라우저 알림을 허용하세요.</p>
        )}
        {notice ? <p role="status">{notice}</p> : null}
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={() => {
            void previewNotification().then((message) => setNotice(message ?? "알림을 보냈습니다."));
          }}
        >
          알림 미리보기
        </Button>
      </div>
    </div>
  );
}
