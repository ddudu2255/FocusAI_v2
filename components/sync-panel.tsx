"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/components/store";
import { isNativeAndroid } from "@/lib/guard";
import { requestServerDelete } from "@/lib/sync-runner";

/** 설정: 사용 기록 보내기 스위치와 서버 기록 지우기. */
export function SyncPanel() {
  const { data, saveSettings } = useStore();
  const [deleted, setDeleted] = useState(false);
  if (!data || !isNativeAndroid()) return null;
  const settings = data.settings;

  return (
    <section className="space-y-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="usage-sync" className="text-base font-medium">
            사용 기록 보내기
          </Label>
          <p className="text-sm leading-6 text-muted-foreground">
            이름 없이 본 시간, 개입에서 고른 것, 하루 목표, AI 예측 기록을 서버로 보내요. 다른 사용자와 비교하는
            통계와 AI 학습에만 써요. 성찰 답, 직접 쓴 글, 공부 카드, 화면의 글은 보내지 않아요.
          </p>
        </div>
        <Switch
          id="usage-sync"
          checked={settings.usageSyncEnabled}
          aria-label="사용 기록 보내기"
          onCheckedChange={(checked) =>
            saveSettings({ ...settings, usageSyncEnabled: Boolean(checked), usageSyncAsked: true })
          }
        />
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={deleted}
        onClick={() => {
          void requestServerDelete().then(() => setDeleted(true));
        }}
      >
        {deleted ? "서버 기록을 지우는 중이에요 (연결되면 지워져요)" : "서버에 보낸 기록 지우기"}
      </Button>
    </section>
  );
}
