"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/components/store";
import { HanbakjaGuard, isNativeAndroid } from "@/lib/guard";
import { blockRemainingSeconds, formatClock, isBlocked, todayKey, usageSecondsOn } from "@/lib/logic";

const OFF_WAIT_SEC = 3;

/** 끄기 전에 한 번 더: 오늘 본 시간을 보여 주고 스스로 정한 약속을 떠올리게 한다. */
const OFF_LINES = [
  (minutes: number) => `오늘 쇼츠를 벌써 ${minutes}분 봤어요. 지금 끄면 아무도 멈춰주지 않아요.`,
  (minutes: number) =>
    `끄는 건 쉬워요. 다시 켜는 건 생각보다 어려워요. 오늘 ${minutes}분, 정말 괜찮으세요?`,
];

export function GuardPanel() {
  const { data } = useStore();
  const [native, setNative] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [blocker, setBlocker] = useState<boolean | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [offWait, setOffWait] = useState(0);
  const [offLine, setOffLine] = useState(0);

  useEffect(() => {
    if (!confirmOff || offWait <= 0) return;
    const id = window.setTimeout(() => setOffWait((value) => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [confirmOff, offWait]);

  function setSwitch(next: boolean) {
    setBlocker(next);
    void HanbakjaGuard.setBlocker({ enabled: next }).catch(() => {
      setBlocker(!next);
    });
  }

  useEffect(() => {
    const onAndroid = isNativeAndroid();
    setNative(onAndroid);
    let stopped = false;

    async function read() {
      try {
        const status = await HanbakjaGuard.getStatus();
        if (stopped) return;
        setBlocker(status.blockerEnabled);
        if (onAndroid) setEnabled(status.enabled);
      } catch {
        if (stopped) return;
        setBlocker(true);
        if (onAndroid) setEnabled(false);
      }
    }

    void read();
    const id = window.setInterval(() => void read(), 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const blockerOn = blocker !== false;

  return (
    <section className="space-y-3 rounded-3xl bg-card px-4 py-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="blocker-enabled" className="text-base font-medium">
            쇼츠·릴스 개입
          </Label>
          <p className="text-sm leading-6 text-muted-foreground">
            {blocker === null
              ? "개입 스위치를 확인하고 있습니다."
              : blockerOn
                ? "켜져 있습니다. 쇼츠가 열리면 영상을 멈추고 그 위에 질문을 띄웁니다."
                : "꺼져 있습니다. 질문과 차단은 멈추고, 쇼츠 사용 시간만 기록합니다."}
          </p>
        </div>
        <Switch
          id="blocker-enabled"
          checked={blockerOn}
          disabled={blocker === null}
          aria-label="쇼츠·릴스 개입"
          onCheckedChange={(checked) => {
            if (checked) {
              setConfirmOff(false);
              setSwitch(true);
              return;
            }
            setOffLine((value) => (value + 1) % OFF_LINES.length);
            setOffWait(OFF_WAIT_SEC);
            setConfirmOff(true);
          }}
        />
      </div>
      {confirmOff && data ? (
        <OffConfirm
          minutes={Math.round(usageSecondsOn(data, todayKey()) / 60)}
          line={offLine}
          wait={offWait}
          blockedMinutes={
            isBlocked(data.block) ? Math.ceil(blockRemainingSeconds(data.block) / 60) : 0
          }
          onKeep={() => setConfirmOff(false)}
          onOff={() => {
            setConfirmOff(false);
            setSwitch(false);
          }}
        />
      ) : null}
      <h2 className="text-base font-medium">실제 쇼츠·릴스 개입</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        안드로이드에서 접근성 서비스를 직접 켜면, YouTube Shorts 플레이어가 열릴 때
        영상을 멈추고 그 위에 질문이 올라옵니다. 오늘 목표의 절반까지는 이유와 볼 시간만
        정하고, 절반을 넘으면 숨 고르기·문제 하나 같은 멈추는 활동을 거칩니다. 정한 시간이
        되면 다시 멈춥니다. 목표를 넘으면 오늘을 마무리할지, 잠시 잠글지 고릅니다. 잠금
        중에 쇼츠를 열면 남은 시간이 보이는 잠금 화면이 뜹니다. 일반 영상, 홈 피드,
        검색에서는 개입하지 않습니다. Instagram Reels는 지금처럼 이 앱 화면으로 개입합니다.
      </p>
      <p className="text-sm leading-6 text-muted-foreground">
        기록은 이 기기에만 남습니다. 화면의 글, 메시지, 비밀번호, 계정은 읽거나
        저장하거나 보내지 않습니다. 쇼츠를 보다 다른 앱으로 넘어갔는지는 앱 이름만으로
        판단하고, 쇼츠를 작은 창(PIP)으로 계속 보는지는 화면에 떠 있는 YouTube 작은 창만
        확인합니다. 다른 앱의 이름은 기록하지 않습니다. 사용 시간과 차단 시간은 항상 실제
        시간입니다.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
        <li>아래 버튼을 누르거나 휴대폰의 설정 앱을 엽니다.</li>
        <li>
          <strong className="font-medium text-foreground">설정 → 접근성</strong>으로
          이동합니다. ShortsAI가 바로 없으면{" "}
          <strong className="font-medium text-foreground">설치된 앱</strong> 또는{" "}
          <strong className="font-medium text-foreground">다운로드한 앱</strong>을
          엽니다.
        </li>
        <li>ShortsAI를 켜고, 확인 창에서 허용을 누릅니다.</li>
      </ol>
      <p className="text-sm leading-6 text-muted-foreground">
        안드로이드 13 이상에서는 그 전에{" "}
        <strong className="font-medium text-foreground">
          설정 → 앱 → ShortsAI → 오른쪽 위 ⋮ → 제한된 설정 허용
        </strong>
        이 필요할 수 있습니다.
      </p>
      {native ? (
        <p className="text-sm font-medium">
          {enabled === null
            ? "접근성 상태를 확인하고 있습니다."
            : enabled
              ? "이 기기에서 접근성 서비스가 켜져 있습니다."
              : "이 기기에서 접근성 서비스가 꺼져 있습니다."}
        </p>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          이 브라우저와 아이폰에서는 다른 앱의 Shorts·Reels를 막을 수 없습니다.
          접근성 설정 버튼은 설치한 안드로이드 앱 안에 있습니다. 스위치 선택은 이
          브라우저에 남습니다.
        </p>
      )}
      {native ? (
        <Button
          type="button"
          className="h-11"
          onClick={() => {
            void HanbakjaGuard.openSettings();
          }}
        >
          접근성 설정 열기
        </Button>
      ) : null}
    </section>
  );
}

function OffConfirm({
  minutes,
  line,
  wait,
  blockedMinutes,
  onKeep,
  onOff,
}: {
  minutes: number;
  line: number;
  wait: number;
  blockedMinutes: number;
  onKeep: () => void;
  onOff: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl bg-secondary px-4 py-4" role="alertdialog" aria-label="개입 끄기 확인">
      <p className="text-lg font-semibold">정말 끌까요?</p>
      <p className="text-sm leading-6">{OFF_LINES[line](minutes)}</p>
      {blockedMinutes > 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          지금 걸린 차단은 남은 {formatClock(blockedMinutes * 60)} 동안 계속돼요.
        </p>
      ) : null}
      <Button type="button" className="h-12 w-full text-base" onClick={onKeep}>
        계속 켜둘게요
      </Button>
      <button
        type="button"
        disabled={wait > 0}
        onClick={onOff}
        className="h-9 w-full text-sm text-muted-foreground underline-offset-4 enabled:hover:underline disabled:opacity-60"
      >
        {wait > 0 ? `그래도 끌래요 (${wait})` : "그래도 끌래요"}
      </button>
    </div>
  );
}
