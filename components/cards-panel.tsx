"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/components/store";
import { CARD_PROMPT, parseCardImport } from "@/lib/policy";
import type { StudyCard } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_OPTIONS = ["", "", "", ""];
/** 공부 모드에서 이보다 적으면 같은 문제가 자주 나올 수 있다고 알려 준다. */
const RECOMMENDED_CARDS = 30;

/** 가져오기 결과 알림. 문구는 사용자 확인 완료 (2026-10-13). */
function importMessage(result: ReturnType<typeof parseCardImport>): string {
  if (result.error) return result.error;
  let line = `${result.cards.length}개를 가져왔어요.`;
  if (result.skipped > 0) line += ` 형식이 이상한 ${result.skipped}개는 건너뛰었어요.`;
  if (result.duplicates > 0) line += ` 이미 있는 문제 ${result.duplicates}개는 넣지 않았어요.`;
  if (result.suspectIds.length > 0) {
    line += ` 해설이 정답과 맞지 않아 보이는 문제 ${result.suspectIds.length}개에 표시했어요. 아래에서 확인해 주세요.`;
  }
  return line;
}

/**
 * 내 공부 카드. 쇼츠 개입에서 문제 1개로 나온다 (공부 모드면 매번).
 * 직접 입력하거나, ChatGPT·Gemini 무료 채팅에서 만든 결과를 붙여넣는다 (서버 없음).
 */
export function CardsPanel() {
  const { data, addCards, deleteCard, saveSettings } = useStore();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
  const [answer, setAnswer] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  /** 방금 가져온 문제 (확인 목록). 의심 문제 id는 따로. */
  const [review, setReview] = useState<{ ids: string[]; suspect: string[] } | null>(null);

  if (!data) return null;
  const settings = data.settings;
  const cards = data.cards;
  const reviewCards: StudyCard[] = review
    ? review.ids.map((id) => cards.find((card) => card.id === id)).filter((card): card is StudyCard => !!card)
    : [];

  function addManual() {
    const filled = options.map((o) => o.trim());
    if (!question.trim()) {
      setMessage("문제를 적어 주세요.");
      return;
    }
    if (filled.some((o) => !o)) {
      setMessage("보기 4개를 모두 적어 주세요.");
      return;
    }
    addCards([
      {
        id: crypto.randomUUID(),
        question: question.trim(),
        options: filled,
        answer,
        createdAt: new Date().toISOString(),
        source: "manual",
        shown: 0,
        correct: 0,
        explanation: explanation.trim(),
      },
    ]);
    setQuestion("");
    setOptions(EMPTY_OPTIONS);
    setAnswer(0);
    setExplanation("");
    setMessage("카드를 추가했어요.");
  }

  function importPasted() {
    const result = parseCardImport(pasted, undefined, undefined, cards);
    if (result.cards.length > 0) {
      addCards(result.cards);
      setPasted("");
      setReview({ ids: result.cards.map((card) => card.id), suspect: result.suspectIds });
    }
    setMessage(importMessage(result));
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CARD_PROMPT);
      setMessage("질문 문장을 복사했어요. ChatGPT나 Gemini에 붙여넣고, 공부 자료를 붙이거나 PDF 파일을 첨부해 주세요.");
    } catch {
      setMessage("복사하지 못했어요. 아래 문장을 길게 눌러 직접 복사해 주세요.");
    }
  }

  return (
    <section className="space-y-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="space-y-3">
        <h2 className="text-base font-medium">내 공부 카드</h2>
        <div className="space-y-3 text-sm leading-6 text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">쇼츠 대신 문제 하나</p>
            <p>
              쇼츠를 열려는 순간, 내 공부 자료로 만든 문제를 하나 풀고 넘어가게 해 주는 기능이에요. 카드는
              이 폰 안에만 저장돼요.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">어떻게 나오나요?</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>평소에는 다른 활동(숨 고르기, 호흡 등)과 번갈아 가끔 나와요.</li>
              <li>공부 모드를 켜면 쇼츠를 열 때마다 문제가 나와요.</li>
              <li>
                틀린 문제는 더 자주, 맞힌 문제는 점점 드물게 나와요. 같은 문제는 몇 시간 안에 다시 나오지
                않아요.
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">어떤 자료가 좋나요?</p>
            <p>
              시험 범위 강의 자료, 교재 PDF, 단어장처럼 외우거나 이해해야 하는 내용이 좋아요. 범위를 나눠 여러
              번 만들어 30장 이상 쌓아 두면 좋아요.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">문제가 이상하면?</p>
            <p>
              문제 아래 &quot;이 문제 이상해요&quot;를 누르면 빠져요. 아래 목록에서 직접 지울 수도 있어요.
            </p>
          </div>
        </div>
        <p className="text-sm">지금 {cards.length}장 있어요.</p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-2xl bg-background px-4 py-3 ring-1 ring-foreground/10">
        <div className="space-y-1">
          <Label htmlFor="study-mode" className="text-base font-medium">
            공부 모드
          </Label>
          <p className="text-sm leading-6 text-muted-foreground">
            켜면 쇼츠를 열 때 숨 고르기나 다른 활동 대신 내 공부 카드 문제가 나와요. 카드가 없으면 평소대로
            해요.
          </p>
          {settings.studyMode && cards.length < RECOMMENDED_CARDS ? (
            <p className="text-sm leading-6" role="status">
              카드가 {cards.length}장이라 같은 문제가 자주 나올 수 있어요. 오래 쓰려면 {RECOMMENDED_CARDS}장 이상
              만들어 두면 좋아요.
            </p>
          ) : null}
        </div>
        <Switch
          id="study-mode"
          checked={settings.studyMode}
          aria-label="공부 모드"
          onCheckedChange={(checked) => saveSettings({ ...settings, studyMode: Boolean(checked) })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="card-question">직접 만들기</Label>
        <Textarea
          id="card-question"
          value={question}
          maxLength={300}
          placeholder="문제"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div className="space-y-2" role="radiogroup" aria-label="정답 고르기">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={answer === index}
                aria-label={`${index + 1}번을 정답으로`}
                onClick={() => setAnswer(index)}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full border text-sm",
                  answer === index ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {index + 1}
              </button>
              <Input
                value={option}
                maxLength={120}
                placeholder={`보기 ${index + 1}`}
                onChange={(event) =>
                  setOptions(options.map((o, i) => (i === index ? event.target.value : o)))
                }
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">동그라미를 눌러 정답을 고르세요.</p>
        <Textarea
          value={explanation}
          maxLength={500}
          placeholder="해설 (선택) · 문제를 푼 뒤에 보여 줘요"
          onChange={(event) => setExplanation(event.target.value)}
        />
        <Button type="button" variant="outline" className="h-11 w-full" onClick={addManual}>
          카드 추가
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="card-import">ChatGPT·Gemini로 한 번에 만들기 (무료)</Label>
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
          <li>아래 버튼으로 질문 문장을 복사해요.</li>
          <li>ChatGPT나 Gemini 무료 채팅에 붙여넣고, 공부 자료를 붙이거나 PDF 파일을 첨부해요.</li>
          <li>나온 결과를 통째로 복사해서 아래 칸에 붙여넣어요.</li>
        </ol>
        <p className="text-sm leading-6 text-muted-foreground">
          자료가 길면 &quot;3장만&quot;, &quot;1~10쪽만&quot;처럼 범위를 나눠서 여러 번 만들면 문제가 고르게 나와요.
        </p>
        <Button type="button" variant="outline" className="h-10" onClick={() => void copyPrompt()}>
          질문 문장 복사
        </Button>
        <Textarea
          id="card-import"
          className="min-h-28 font-mono text-xs"
          value={pasted}
          placeholder='[{"question":"...","options":["...","...","...","..."],"answer":1}]'
          onChange={(event) => setPasted(event.target.value)}
        />
        <Button
          type="button"
          className="h-11 w-full"
          disabled={!pasted.trim()}
          onClick={importPasted}
        >
          붙여넣은 문제 가져오기
        </Button>
      </div>

      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}

      {review && reviewCards.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">방금 가져온 문제</p>
          <ul className="space-y-2">
            {reviewCards.map((card) => (
              <li key={card.id} className="rounded-2xl bg-background px-4 py-3 text-sm ring-1 ring-foreground/10">
                {review.suspect.includes(card.id) ? (
                  <p className="mb-1 text-xs font-medium text-destructive">해설이 정답과 달라 보여요</p>
                ) : null}
                <p className="font-medium">{card.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">정답: {card.options[card.answer]}</p>
                {card.explanation ? (
                  <p className="mt-1 text-xs text-muted-foreground">해설: {card.explanation}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-9"
                  onClick={() => deleteCard(card.id)}
                >
                  지우기
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" className="h-10" onClick={() => setReview(null)}>
            확인했어요
          </Button>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <div className="space-y-2">
          <Button type="button" variant="ghost" className="h-10" onClick={() => setShowList(!showList)}>
            {showList ? "카드 목록 닫기" : `카드 목록 보기 (${cards.length})`}
          </Button>
          {showList ? (
            <ul className="space-y-2">
              {cards.map((card) => (
                <li key={card.id} className="rounded-2xl bg-background px-4 py-3 text-sm ring-1 ring-foreground/10">
                  <p className="font-medium">{card.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    정답: {card.options[card.answer]} · 나온 횟수 {card.shown} · 맞힘 {card.correct}
                  </p>
                  {card.explanation ? (
                    <p className="mt-1 text-xs text-muted-foreground">해설: {card.explanation}</p>
                  ) : null}
                  {confirmDelete === card.id ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        className="h-9"
                        onClick={() => {
                          deleteCard(card.id);
                          setConfirmDelete(null);
                        }}
                      >
                        지우기
                      </Button>
                      <Button type="button" variant="outline" className="h-9" onClick={() => setConfirmDelete(null)}>
                        취소
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 text-xs text-muted-foreground underline"
                      onClick={() => setConfirmDelete(card.id)}
                    >
                      이 카드 지우기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
