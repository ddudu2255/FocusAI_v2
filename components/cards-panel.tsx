"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/components/store";
import { CARD_PROMPT, parseCardImport } from "@/lib/policy";
import { cn } from "@/lib/utils";

const EMPTY_OPTIONS = ["", "", "", ""];

/**
 * 내 공부 카드. 쇼츠 개입의 중간 강도에서 문제 1개로 나온다.
 * 직접 입력하거나, ChatGPT·Gemini 무료 채팅에서 만든 결과를 붙여넣는다 (서버 없음).
 */
export function CardsPanel() {
  const { data, addCards, deleteCard } = useStore();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
  const [answer, setAnswer] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  if (!data) return null;
  const cards = data.cards;

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
    const result = parseCardImport(pasted);
    if (result.cards.length > 0) {
      addCards(result.cards);
      setPasted("");
    }
    setMessage(
      result.error ??
        `${result.cards.length}개를 가져왔어요.${result.skipped > 0 ? ` 형식이 틀린 ${result.skipped}개는 건너뛰었어요.` : ""}`,
    );
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CARD_PROMPT);
      setMessage("질문 문장을 복사했어요. ChatGPT나 Gemini에 붙여넣고, 그 아래에 공부 자료를 붙여 주세요.");
    } catch {
      setMessage("복사하지 못했어요. 아래 문장을 길게 눌러 직접 복사해 주세요.");
    }
  }

  return (
    <section className="space-y-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <div>
        <h2 className="text-base font-medium">내 공부 카드</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          오늘 목표의 절반을 넘긴 뒤 쇼츠를 열면, 가끔 쇼츠 대신 이 문제 하나가 나와요. 지금{" "}
          {cards.length}장 있어요.
        </p>
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
          <li>ChatGPT나 Gemini 무료 채팅에 붙여넣고, 그 아래에 공부 자료를 붙여요.</li>
          <li>나온 결과를 통째로 복사해서 아래 칸에 붙여넣어요.</li>
        </ol>
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
