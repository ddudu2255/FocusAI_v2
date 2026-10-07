"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/components/store";
import { useNow } from "@/components/use-now";
import {
  BAND_LABEL,
  formatClock,
  formatKoreanDate,
  formatShortDate,
  formatTime,
  lastDates,
  OUTCOME_LABEL,
  reasonLabel,
  secondsOnDate,
  statsForDate,
  TARGET_LABEL,
  todayKey,
  usageSecondsOn,
} from "@/lib/logic";
import { cn } from "@/lib/utils";

export function StatsView() {
  const { data } = useStore();
  const now = useNow(5000);
  const today = todayKey(new Date(now));
  const [selected, setSelected] = useState(today);
  if (!data) return null;

  const days = lastDates(7, new Date(now));
  const active = days.includes(selected) ? selected : today;
  const series = days.map((date) => ({
    date,
    seconds: usageSecondsOn(data, date),
  }));
  const max = Math.max(...series.map((item) => item.seconds), 1);
  const stats = statsForDate(data, active);
  const interventions = data.interventions
    .filter((log) => log.date === active)
    .slice()
    .reverse();
  // 자정을 넘긴 세션은 걸친 두 날짜에 모두 보인다. 시간은 그 날짜 몫만 표시한다.
  const sessions = data.usageLogs
    .map((log) => ({ log, seconds: secondsOnDate(log, active) }))
    .filter((item) => item.seconds > 0 || item.log.date === active)
    .reverse();
  const locks = data.lockAttempts.filter((item) => item.date === active).reverse();
  const empty = interventions.length === 0 && sessions.length === 0 && locks.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted-foreground">일별 사용과 개입</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">통계</h1>
      </header>

      <section aria-label="최근 7일 사용 시간">
        <div className="grid grid-cols-7 gap-2">
          {series.map((item) => {
            const height = Math.max(8, Math.round((item.seconds / max) * 96));
            const on = item.date === active;
            return (
              <button
                key={item.date}
                type="button"
                onClick={() => setSelected(item.date)}
                aria-pressed={on}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl px-1 py-2",
                  on ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                <span className="flex h-28 items-end">
                  <span
                    className={cn(
                      "w-3 rounded-full",
                      item.seconds > 0 ? "bg-primary" : "bg-muted",
                    )}
                    style={{ height }}
                  />
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatShortDate(item.date, today)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div>
        <h2 className="text-lg font-semibold">{formatKoreanDate(active)}</h2>
        {empty ? (
          <Card className="mt-3">
            <CardContent className="py-8 text-sm leading-6 text-muted-foreground">
              이 날의 기록이 없습니다. 쇼츠를 열면 사용 시간, 실행 이유, 레벨,
              대체행동, 재실행 여부가 여기에 쌓입니다.
            </CardContent>
          </Card>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="스스로 멈춘 횟수" value={`${stats.selfStopCount}번`} />
            <Metric label="사용 시간" value={formatClock(stats.usageSeconds)} />
            <Metric label="실행" value={`${stats.clipCount}회`} />
            <Metric label="개입" value={`${stats.interventionCount}회`} />
            <Metric label="많은 이유" value={stats.topReason ?? "없음"} />
            <Metric label="약속 지킴" value={`${stats.keptCount}번`} />
            <Metric label="약속 연장" value={`${stats.extendCount}번`} />
            <Metric label="가벼움 / 중간 / 강함" value={`${stats.levelCounts[1]} / ${stats.levelCounts[2]} / ${stats.levelCounts[3]}`} />
            <Metric label="오늘은 끝" value={stats.dayEndCount > 0 ? "스스로 마무리" : "없음"} />
            <Metric label="목표 초과" value={`${stats.overdraftCount}번`} />
            <Metric label="시간 잠금" value={`${stats.blockCount}회`} />
            <Metric label="잠금 중 시도" value={`${stats.lockAttemptCount}회`} />
            <Metric label="쉰 시간" value={formatClock(stats.restSeconds)} />
            <Metric label="푼 문제" value={`${stats.cardsSolved}개 (정답 ${stats.cardsCorrect})`} />
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">개입 기록</h2>
        {interventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 날의 개입이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {interventions.map((log) => (
              <li key={log.interventionId}>
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span>
                        {formatTime(log.timestamp)} · {BAND_LABEL[log.level]}
                      </span>
                      <Badge variant="outline">{OUTCOME_LABEL[log.outcome]}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <Field label="실행 이유" value={reasonLabel(log)} />
                      <Field label="방식" value={METHOD_LABEL[log.interventionType] ?? log.interventionType} />
                      {log.commitMinutes > 0 ? (
                        <Field label="약속 시간" value={`${log.commitMinutes}분`} />
                      ) : null}
                      {log.reflection ? <Field label="성찰" value={log.reflection} /> : null}
                      {log.cardCorrect !== null ? (
                        <Field label="문제" value={log.cardCorrect ? "맞힘" : "틀림"} />
                      ) : null}
                      <Field label="당시 누적" value={formatClock(log.usageSeconds)} />
                      <Field label="대체행동" value={log.alternativeAction ?? "없음"} />
                      <Field
                        label="수행 여부"
                        value={log.alternativeCompleted ? "수행함" : "하지 않음"}
                      />
                      <Field label="재실행" value={log.reEntered ? "다시 봄" : "보지 않음"} />
                      <Field label="차단 여부" value={log.blocked ? "차단함" : "차단 안 함"} />
                      <Field
                        label="30분 내 재진입"
                        value={
                          log.outcome === "watch"
                            ? "해당 없음"
                            : log.reenteredWithin30 === null
                              ? "확인 중"
                              : log.reenteredWithin30
                                ? "다시 열었음"
                                : "열지 않음"
                        }
                      />
                      <Field
                        label="차단 시간"
                        value={
                          log.blockDuration > 0
                            ? log.blockDuration === 60
                              ? "1시간"
                              : `${log.blockDuration}분`
                            : "없음"
                        }
                      />
                    </dl>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">사용 기록</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 날의 시청 기록이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map(({ log, seconds }) => (
              <li
                key={log.usageId}
                className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10"
              >
                <span>
                  <span className="block tabular-nums">
                    {formatTime(log.startTime)} – {formatTime(log.endTime)}
                  </span>
                  <span className="text-xs text-muted-foreground">{TARGET_LABEL[log.target]}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {formatClock(seconds)}
                  {Math.round(seconds) < Math.round(log.duration) ? " (자정 넘김)" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {locks.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">잠금 중 시도</h2>
          <LockList items={locks} />
        </section>
      ) : null}
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = {
  pause: "5초 숨 고르기",
  framing: "시간 바꿔 말하기",
  breath: "호흡 따라 하기",
  alternative: "대체행동",
  reflection: "성찰 질문",
  card: "공부 카드",
  warning: "경고",
  commit_end: "약속 시간 끝",
  strong: "마무리 선택",
  locked: "잠금",
  pip: "나가기 후 작은 창으로 계속 봄",
};

function LockList({ items }: { items: { id: string; createdAt: string; remainingSec: number }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10"
        >
          <span className="tabular-nums">{formatTime(item.createdAt)}</span>
          <span className="text-muted-foreground tabular-nums">
            남은 잠금 {formatClock(item.remainingSec)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
