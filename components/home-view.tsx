"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoalSuggestionCard } from "@/components/goal-suggestion";
import { GuardPanel } from "@/components/guard-panel";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import {
  BAND_LABEL,
  blockRemainingSeconds,
  formatClock,
  formatTime,
  FRAMINGS,
  goalRatio,
  hourlyUsage,
  insightFacts,
  insightLine,
  isBlocked,
  isReportDue,
  LEVEL_SUMMARY,
  levelForUsage,
  nextLevelGap,
  OUTCOME_LABEL,
  reasonLabel,
  statsForDate,
  todayKey,
  usageSecondsOn,
} from "@/lib/logic";

export function HomeView() {
  const router = useRouter();
  const { data } = useStore();
  const now = useNow();
  if (!data) return null;

  const today = todayKey(new Date(now));
  const seconds = usageSecondsOn(data, today);
  const level = levelForUsage(seconds, data.settings);
  const stats = statsForDate(data, today);
  const gap = nextLevelGap(seconds, data.settings);
  const blocked = isBlocked(data.block, now);
  const remaining = blockRemainingSeconds(data.block, now);
  const reportReady = isReportDue(data.settings.notificationTime, new Date(now));
  const recent = data.interventions
    .filter((log) => log.date === today)
    .slice()
    .reverse()
    .slice(0, 3);
  const goal = data.settings.level3Threshold;
  const ratio = goalRatio(seconds, data.settings);
  const percent = Math.round(ratio * 100);
  const budgetLeft = goal * 60 - seconds;
  // 막대 끝은 목표의 135%: 넘친 만큼도 보이게 한다. 50%·100% 지점에 강도 경계.
  const scaleMax = 1.35;
  const marker = Math.min(100, (ratio / scaleMax) * 100);
  const l1Width = (0.5 / scaleMax) * 100;
  const l2Width = (0.5 / scaleMax) * 100;
  const l3Width = 100 - l1Width - l2Width;
  const hours = hourlyUsage(data, today);
  const peakHour = Math.max(...hours, 1);
  // 시간 체감 문구: 하루 동안은 같은 종류를 쓰고, 숫자가 없는 종류는 건너뛴다.
  const facts = insightFacts(data, new Date(now));
  const framing =
    FRAMINGS.map((_, i) => insightLine(FRAMINGS[(new Date(now).getDate() + i) % FRAMINGS.length], facts)).find(
      (line): line is string => line !== null,
    ) ?? null;

  function openShorts() {
    router.push("/watch");
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">YouTube Shorts · Instagram Reels</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Focus on</h1>
        </div>
        <Badge variant={level === 3 ? "destructive" : "secondary"}>
          {BAND_LABEL[level]}
        </Badge>
      </header>

      <GoalSuggestionCard />

      <GuardPanel />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
        <Card className="gap-5">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              오늘 목표의 {percent}% 사용
            </CardTitle>
            <p className="text-4xl font-semibold tracking-tight tabular-nums">
              {budgetLeft > 0 ? `${formatClock(budgetLeft)} 남음` : `${formatClock(-budgetLeft)} 넘음`}
            </p>
            <p className="text-sm text-muted-foreground">
              오늘 {formatClock(seconds)} / 목표 {goal}분 · {LEVEL_SUMMARY[level]}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="relative h-3 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`오늘 목표의 ${percent}% 사용. 목표의 절반부터 중간, 목표를 넘으면 강함입니다.`}
            >
              <div className="absolute inset-0 flex">
                <div className="h-full bg-level-1/80" style={{ width: `${l1Width}%` }} />
                <div className="h-full bg-level-2/85" style={{ width: `${l2Width}%` }} />
                <div className="h-full bg-level-3/85" style={{ width: `${l3Width}%` }} />
              </div>
              <div
                className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
                style={{ left: `clamp(0px, calc(${marker}% - 8px), calc(100% - 16px))` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>0분</span>
              <span>절반 {Math.round(goal / 2)}분</span>
              <span>목표 {goal}분</span>
            </div>
            <p className="text-sm">
              {gap
                ? `${gap.label} ${formatClock(gap.remainSeconds)} 남았어요.`
                : "오늘 목표를 넘었어요. 다음에 열면 오늘을 마무리할지 고르게 돼요."}
            </p>
            {framing ? <p className="text-sm text-muted-foreground">{framing}</p> : null}
            <div aria-label="오늘 시간대별 시청" role="img">
              <div className="flex h-12 items-end gap-[2px]">
                {hours.map((value, hour) => (
                  <span
                    key={hour}
                    title={`${hour}시 ${formatClock(value)}`}
                    className={value > 0 ? "flex-1 rounded-sm bg-primary/80" : "flex-1 rounded-sm bg-muted"}
                    style={{ height: `${Math.max(6, (value / peakHour) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>0시</span>
                <span>6시</span>
                <span>12시</span>
                <span>18시</span>
                <span>24시</span>
              </div>
            </div>
            {blocked ? (
              <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm">
                <p className="font-medium text-destructive">쇼츠 열기가 차단되어 있습니다</p>
                <p className="mt-1 tabular-nums text-foreground">
                  남은 시간 {formatClock(remaining)}
                </p>
              </div>
            ) : null}
            <Button
              type="button"
              className="h-12 w-full text-base"
              onClick={openShorts}
            >
              {blocked ? "차단 상태 보기" : "쇼츠 열기"}
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              이 버튼은 연습입니다. 안드로이드에서 접근성을 켜면 실제 YouTube
              Shorts와 Instagram Reels 화면에서 같은 개입이 열립니다.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Card size="sm">
            <CardHeader>
              <CardTitle>오늘의 개입</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              <Stat label="스스로 멈춤" value={`${stats.selfStopCount}번`} />
              <Stat label="쉰 시간" value={stats.restSeconds >= 60 ? formatClock(stats.restSeconds) : "0분"} />
              <Stat label="잠금 연속" value={`${stats.lockStreak}일`} />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>일일 리포트</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {reportReady
                  ? "오늘의 리포트를 볼 수 있습니다."
                  : `${data.settings.notificationTime}에 하루를 정리합니다.`}
              </p>
              <Button variant="outline" className="h-10" onClick={() => router.push("/report")}>
                리포트 열기
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">최근 개입</h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm leading-6 text-muted-foreground">
              아직 오늘 쇼츠를 열지 않았습니다. 열면 이유와 레벨, 그다음 선택이
              여기에 남습니다.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((log) => (
              <li
                key={log.interventionId}
                className="rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">
                    Level {log.level} · {reasonLabel(log)}
                  </p>
                  <time className="text-xs text-muted-foreground tabular-nums" dateTime={log.timestamp}>
                    {formatTime(log.timestamp)}
                  </time>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {OUTCOME_LABEL[log.outcome]}
                  {log.alternativeAction ? ` · ${log.alternativeAction}` : ""}
                  {log.alternativeCompleted ? " · 수행함" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
