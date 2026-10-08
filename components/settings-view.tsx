"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AiPanel } from "@/components/ai-panel";
import { CardsPanel } from "@/components/cards-panel";
import { GuardPanel } from "@/components/guard-panel";
import { useStore } from "@/components/store";
import { APP_VERSION, RELEASES_URL } from "@/lib/app-info";
import { isNativeAndroid } from "@/lib/guard";
import { normalizeClock, validateSettings } from "@/lib/logic";
import { settingsFromGoal } from "@/lib/storage";
import type { Settings } from "@/lib/types";

type Draft = {
  goal: string;
  finalGoal: string;
  dayEndHour: string;
  interestTopic: string;
  wakeTime: string;
  notificationTime: string;
  notifyEnabled: boolean;
};

function toDraft(settings: Settings): Draft {
  return {
    goal: String(settings.level3Threshold),
    finalGoal: String(settings.finalGoal),
    dayEndHour: String(settings.dayEndHour),
    interestTopic: settings.interestTopic,
    wakeTime: settings.wakeTime,
    notificationTime: settings.notificationTime,
    notifyEnabled: settings.notifyEnabled,
  };
}

export function SettingsView() {
  const {
    data,
    permission,
    notifyIssue,
    storageKind,
    saveSettings,
    reset,
    requestNotificationPermission,
    previewNotification,
  } = useStore();
  const native = isNativeAndroid();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!data) return null;
  const form = draft ?? toDraft(data.settings);

  function update(partial: Partial<Draft>) {
    setDraft({ ...form, ...partial });
    setSaved(false);
    setError(null);
  }

  function save() {
    if (!data) return;
    const goal = Number(form.goal);
    const finalGoal = Number(form.finalGoal);
    const dayEndHour = Number(form.dayEndHour);
    const notificationTime = normalizeClock(form.notificationTime);
    const wakeTime = normalizeClock(form.wakeTime);
    const message = validateSettings({
      goal,
      finalGoal,
      dayEndHour,
      notificationTime: notificationTime ?? form.notificationTime,
      wakeTime: wakeTime ?? form.wakeTime,
    });
    if (message || !notificationTime || !wakeTime) {
      setError(message ?? "알림 시각을 다시 확인해 주세요.");
      setSaved(false);
      return;
    }
    saveSettings(
      settingsFromGoal(goal, {
        notificationTime,
        notifyEnabled: form.notifyEnabled,
        finalGoal,
        dayEndHour,
        interestTopic: form.interestTopic.trim().slice(0, 40),
        wakeTime,
        aiEnabled: data.settings.aiEnabled,
        strictMode: data.settings.strictMode,
        banditV2: data.settings.banditV2,
        goalWeekAnswered: data.settings.goalWeekAnswered,
      }),
    );
    setError(null);
    setSaved(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header>
        <p className="text-sm text-muted-foreground">목표, 알림, 공부 카드</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">설정</h1>
      </header>

      <GuardPanel />

      <form
        className="space-y-5 rounded-3xl bg-card p-5 ring-1 ring-foreground/10"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="goal">하루 목표 (분)</Label>
          <Input
            id="goal"
            inputMode="numeric"
            value={form.goal}
            onChange={(event) => update({ goal: event.target.value })}
            aria-invalid={Boolean(error)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            오늘 쇼츠에 쓸 시간입니다. 목표의 절반까지는 가볍게, 절반을 넘으면 멈추는 활동을
            하나 거치고, 목표를 넘으면 오늘을 마무리할지 고릅니다. 기본값은 20분입니다.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="final-goal">최종 목표 (분)</Label>
          <Input
            id="final-goal"
            inputMode="numeric"
            value={form.finalGoal}
            onChange={(event) => update({ finalGoal: event.target.value })}
            aria-invalid={Boolean(error)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            언젠가 줄이고 싶은 하루 시간입니다. 지금은 기록만 하고, 나중에 하루 목표를 이쪽으로
            조금씩 줄이자고 제안할 때 씁니다.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="day-end">&quot;오늘은 끝&quot;이 풀리는 시각 (시)</Label>
          <Input
            id="day-end"
            inputMode="numeric"
            value={form.dayEndHour}
            onChange={(event) => update({ dayEndHour: event.target.value })}
            aria-invalid={Boolean(error)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            목표를 넘었을 때 &quot;오늘은 끝&quot;을 고르면 다음 날 이 시각까지 쇼츠가 잠깁니다.
            0~12 사이로 적습니다. 기본값은 6시입니다.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wake-time">일어나는 시각</Label>
          <Input
            id="wake-time"
            type="time"
            value={form.wakeTime}
            onChange={(event) => update({ wakeTime: event.target.value })}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            밤에 쇼츠를 열면 &quot;지금 자면 몇 시간 잘 수 있어요&quot;를 알려 줄 때 씁니다. 휴대폰에
            12시간 안에 울리는 알람이 있으면 알람 시각을 먼저 씁니다.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="topic">관심 주제</Label>
          <Input
            id="topic"
            value={form.interestTopic}
            maxLength={40}
            placeholder="예: AI, 축구, 주식"
            onChange={(event) => update({ interestTopic: event.target.value })}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            나중에 이 주제의 최신 기사 요약을 쇼츠 대신 보여 줄 때 씁니다. 아직은 저장만 합니다.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notify-time">일일 리포트 시각</Label>
          <Input
            id="notify-time"
            type="time"
            value={form.notificationTime}
            onChange={(event) => update({ notificationTime: event.target.value })}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {native
              ? "이 기기 시각 기준입니다. 앱이 꺼져 있어도 매일 이 시각에 알림이 오고, 누르면 오늘 리포트가 열립니다."
              : "이 기기 시각 기준입니다. 앱이 열려 있을 때 브라우저 알림을 보내고, 리포트 화면에도 같은 내용을 표시합니다."}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="notify-enabled">{native ? "리포트 알림" : "브라우저 알림"}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              끄면 예약 알림을 보내지 않습니다. 리포트 화면은 유지됩니다.
            </p>
          </div>
          <Switch
            id="notify-enabled"
            checked={form.notifyEnabled}
            onCheckedChange={(checked) => update({ notifyEnabled: checked })}
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="text-sm text-muted-foreground" role="status">
            설정을 저장했습니다.
          </p>
        ) : null}
        <Button type="submit" className="h-11 w-full">
          저장
        </Button>
      </form>

      <AiPanel />

      <CardsPanel />

      <section className="space-y-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 className="text-base font-medium">알림 권한</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {permission === "granted"
            ? native
              ? "알림을 보낼 수 있습니다. 리포트 알림과 시간 차단 중 남은 시간 알림이 옵니다."
              : "이 브라우저에서 알림을 보낼 수 있습니다."
            : permission === "denied"
              ? native
                ? "알림이 꺼져 있습니다. 휴대폰 설정 → 애플리케이션 → ShortsAI → 알림에서 허용해 주세요."
                : "알림이 차단되어 있습니다. 주소창의 사이트 설정에서 허용해 주세요."
              : permission === "unsupported"
                ? "이 기기에서는 알림을 쓸 수 없습니다."
                : "아직 권한을 묻지 않았습니다."}
        </p>
        {notifyIssue ? (
          <p className="text-sm text-destructive" role="alert">
            {notifyIssue}
          </p>
        ) : null}
        {permissionMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {permissionMessage}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm" role="status">
            {notice}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              void requestNotificationPermission().then((message) => {
                setPermissionMessage(message);
                setNotice(message ? null : "알림을 허용했습니다.");
              });
            }}
          >
            알림 허용 요청
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              void previewNotification().then((message) => {
                setPermissionMessage(message);
                setNotice(message ? null : "알림을 보냈습니다.");
              });
            }}
          >
            알림 미리보기
          </Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-base font-medium">기록 초기화</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {storageKind === "sqlite" ? "이 기기에" : "이 브라우저에"} 저장된 사용 시간,
          개입, 잠금 시도, 차단을 지웁니다. 설정은 기본값으로 돌아갑니다. 공부 카드는
          남기고 푼 횟수만 지웁니다.
        </p>
        {confirmReset ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => {
                void reset();
                setDraft(null);
                setConfirmReset(false);
                setSaved(false);
              }}
            >
              정말 지우기
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setConfirmReset(false)}
            >
              취소
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setConfirmReset(true)}
          >
            기록 모두 지우기
          </Button>
        )}
      </section>

      <section className="space-y-2 text-sm leading-6 text-muted-foreground">
        <h2 className="text-base font-medium text-foreground">폰에 설치</h2>
        <p>
          아이폰은 Safari에서 이 페이지를 연 뒤 공유 버튼을 누르고{" "}
          <strong className="font-medium text-foreground">홈 화면에 추가</strong>를
          고르세요. 한 번 열린 뒤에는 네트워크가 없어도 홈 화면 아이콘으로 열립니다.
        </p>
        <p>
          안드로이드는{" "}
          {RELEASES_URL ? (
            <a className="underline" href={RELEASES_URL}>
              ShortsAI APK
            </a>
          ) : (
            "GitHub Releases의 ShortsAI APK"
          )}
          를 받아 설치하세요. 출처를 알 수 없는 앱 설치를 허용해야 합니다. 설치 후
          설정 → 접근성에서 ShortsAI를 켜야 실제 쇼츠와 릴스 플레이어에 개입합니다.
        </p>
      </section>

      <section className="space-y-1 text-sm leading-6 text-muted-foreground">
        <h2 className="text-base font-medium text-foreground">앱 정보</h2>
        <p>ShortsAI {APP_VERSION ? `버전 ${APP_VERSION}` : ""}</p>
        <p>
          기록 저장소: {storageKind === "sqlite" ? "기기 데이터베이스(SQLite)" : "브라우저 저장소"}
        </p>
      </section>

      <section className="space-y-2 text-sm leading-6 text-muted-foreground">
        <h2 className="text-base font-medium text-foreground">이 앱이 하지 않는 일</h2>
        <p>
          브라우저에서는 다른 앱을 막지 않습니다. 안드로이드 설치본은 접근성을 켠
          뒤에 YouTube Shorts 플레이어와 Instagram Reels 플레이어만 구분합니다.
          쇼츠 플레이어가 열리면 영상을 멈추고 그 위에 질문을 띄웁니다. Level 3에서는
          YouTube를 닫고 ShortsAI로 돌아옵니다. 화면의 글이나 다른 앱의 내용은 읽거나
          저장하지 않고, 기록은 이 기기 밖으로 보내지 않습니다.
        </p>
      </section>
    </div>
  );
}
