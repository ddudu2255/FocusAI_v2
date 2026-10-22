/**
 * "이번 달의 나무" 단계 계산과 단계 문구. 화면 코드는 없다 (그리기는 components/tree-view.tsx).
 *
 * 단계는 이번 달에 목표를 지킨 날 수로 정한다. 연속(스트릭)이 아니고, 놓쳐도 리셋되지 않는다.
 * 위 두 단계(어른나무, 세계수)는 달이 끝나야(남은 날 0) 나오고, 놓친 날 수로 정한다.
 * 목표를 넘긴 날에도 나무가 시들거나 작아지지 않는다.
 */

export type StageIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Stage = {
  name: string;
  /** 달이 끝났을 때 보여 주는 문구 */
  note: string;
};

export const STAGES: readonly Stage[] = [
  { name: "씨앗", note: "아직 심기 전이에요" },
  { name: "새싹", note: "싹이 났어요" },
  { name: "떡잎", note: "잎이 자리를 잡았어요" },
  { name: "어린나무", note: "제법 나무 같아졌어요" },
  { name: "나무", note: "튼튼하게 자랐어요" },
  { name: "어른나무", note: "열매가 열렸어요" },
  { name: "세계수", note: "한 달 내내 지켰어요" },
];

/** 센 날(설치 전 날짜를 뺀 날)이 이보다 적은 달은 어른나무·세계수가 나오지 않는다. */
export const TOP_STAGE_MIN_DAYS = 14;

/** 비율 단계의 기준 (지킨 날 ÷ 그 달 날짜 수). 소수 오차를 피하려고 10분의 몇으로 둔다. */
const RATIO_TENTHS: Record<2 | 3 | 4, number> = { 2: 3, 3: 5, 4: 7 };

/**
 * 시안의 stageFor 그대로.
 * @param kept 지킨 날 수
 * @param days 그 달 날짜 수 (설치한 달은 센 날 수)
 * @param elapsed 지난 날 수 (지킨 날 + 놓친 날)
 */
export function stageFor(kept: number, days: number, elapsed: number): StageIndex {
  if (days <= 0) return 0;
  const missed = elapsed - kept;
  if (elapsed >= days && missed === 0) return 6;
  if (elapsed >= days && missed <= 2) return 5;
  if (kept * 10 >= days * RATIO_TENTHS[4]) return 4;
  if (kept * 10 >= days * RATIO_TENTHS[3]) return 3;
  if (kept * 10 >= days * RATIO_TENTHS[2]) return 2;
  if (kept >= 1) return 1;
  return 0;
}

/** 센 날이 TOP_STAGE_MIN_DAYS보다 적으면 나무(4)까지만. */
export function stageForMonth(kept: number, counted: number, elapsed: number): StageIndex {
  const stage = stageFor(kept, counted, elapsed);
  if (counted < TOP_STAGE_MIN_DAYS && stage > 4) return 4;
  return stage;
}

/** 비율 단계에 필요한 지킨 날 수 (그 달 날짜 수로 계산). */
export function daysNeeded(stage: 2 | 3 | 4, days: number): number {
  return Math.ceil((days * RATIO_TENTHS[stage]) / 10);
}

export type LadderStep = { index: StageIndex; name: string; cond: string };

/** "단계 기준 보기"를 펼쳤을 때의 단계 목록 (씨앗 제외). */
export function ladder(days: number): LadderStep[] {
  return [
    { index: 1, name: STAGES[1].name, cond: "1일 이상" },
    { index: 2, name: STAGES[2].name, cond: `${daysNeeded(2, days)}일 이상` },
    { index: 3, name: STAGES[3].name, cond: `${daysNeeded(3, days)}일 이상` },
    { index: 4, name: STAGES[4].name, cond: `${daysNeeded(4, days)}일 이상` },
    { index: 5, name: STAGES[5].name, cond: "놓친 날 2일 이하" },
    { index: 6, name: STAGES[6].name, cond: "하루도 안 놓침" },
  ];
}

/** 받침이 있으면 "으로", 없으면 "로". */
export function withRo(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const jong = (last - 0xac00) % 28;
  // ㄹ 받침은 "로"
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

/**
 * 나무 아래 한 줄 안내.
 * 달 중간이고 더 올라갈 수 있으면 "남은 N일을 다 지키면 OOO까지 가요",
 * 더 못 올라가면 "이대로 가면 OOO로 이번 달을 마쳐요", 달이 끝났으면 단계 문구.
 */
export function stageHint(kept: number, counted: number, elapsed: number): string {
  const stage = stageForMonth(kept, counted, elapsed);
  const left = counted - elapsed;
  if (left <= 0) return STAGES[stage].note;
  const best = stageForMonth(kept + left, counted, counted);
  if (best > stage) return `남은 ${left}일을 다 지키면 ${STAGES[best].name}까지 가요`;
  return `이대로 가면 ${withRo(STAGES[stage].name)} 이번 달을 마쳐요`;
}
