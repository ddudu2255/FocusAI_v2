/**
 * 예측 모델 (v0.11 설계, docs/risk-model/README.md).
 *
 * 쇼츠를 연 순간 "이번에 오래 볼지"(그날 목표의 절반 이상을 한 번에 봄) 확률을 로지스틱 회귀로 낸다.
 * 위험도: 사람별 상대 기준 (bandsFor). 그 사람의 최근 14일 열기 점수 중 상위 15%면 보통, 상위 5%면 높음.
 * 단 확률이 2%·4% 미만이면 걸지 않고, 열기가 50번 쌓이기 전에는 고정 기준(10%·20%)을 쓴다. 무엇을 할지는 밴딧이 정한다 (ai.ts tightenTable).
 *
 * 역할:
 *   - 서비스(Java)가 연 순간 특징값을 재고 점수를 내서 시트에 쓴다. 가중치는 정책표로 받는다.
 *   - 웹은 시청이 끝나 정답이 정해지면 가중치를 조금씩 고친다 (learn). 고친 가중치는 다음 정책표에 실린다.
 * 같은 계산을 Java(GuardRisk)도 한다. START_MODEL.checks로 두 쪽이 같은 값을 내는지 확인한다.
 */
import { firstRecordDate, goalMinutesOn, lastDates, usageSecondsOn } from "./logic.ts";
import { START_MODEL } from "./risk-model.ts";
import type { AppData, OpenLog, RiskBand, RiskModelState } from "./types.ts";

/**
 * 서비스가 재는 날것 특징값의 순서. OpenLog.features와 정책표가 이 순서를 쓴다.
 * 시각(0-23), 주말(0/1), 오늘 본 시간÷목표, 오늘 연 횟수, 마지막으로 닫은 뒤 분, 직전 시청÷목표,
 * 잠금 끝난 뒤 분, 어제 이 시각까지 본 시간÷목표, 최근 7일 약속 지킨 비율, 이유 번호(모르면 -1).
 * "기록 없음"(오늘 처음, 잠금 기록 없음)은 아주 큰 분으로 넘긴다 (CAP에서 잘린다).
 */
export const RAW_FEATURES = [
  "hour",
  "weekend",
  "todayRatio",
  "todayOpens",
  "minSinceClose",
  "prevDurationRatio",
  "minSinceLockEnd",
  "yesterdayByNowRatio",
  "kept7",
  "reason",
] as const;

/**
 * 사람별 상대 기준 (6단계 시뮬레이션으로 정함, 사용자 확인 2026-10-26, docs/risk-model/README.md).
 * 고정 확률 기준은 앱이 오래 보는 일을 줄일수록 모델 확률도 낮아져 거의 걸리지 않게 된다.
 */
export const RELATIVE_BANDS = {
  /** 최근 열기 점수의 이 분위 이상: 보통, 높음 */
  quantiles: [0.85, 0.95],
  /** 상위에 들어도 이 확률 미만이면 걸지 않는다 (평범한 순간까지 끊지 않게) */
  floor: [0.02, 0.04],
  /** 이만큼 열기가 쌓이기 전에는 고정 기준 (START_MODEL.bands) */
  minHistory: 50,
  days: 14,
} as const;

/** 폰에서 학습: 한 번에 고치는 크기, 시작 가중치 쪽으로 당기는 힘 (compare.py online과 같다). */
export const LEARN_RATE = 0.01;
export const LEARN_PULL = 0.002;
/** 최근 약속 기록이 없을 때 쓰는 비율 (가상 데이터와 같다). */
export const DEFAULT_KEPT7 = 0.75;

const REASON_COLUMNS = [1, 2, 3, 4, 5];

/** 날것 특징값 → 모델 입력 (compare.py features·transform_one과 같다). 이유를 모르면 그 칸은 평균. */
export function transform(raw: readonly number[], mean: readonly number[] = START_MODEL.mean): number[] {
  const [hour, weekend, ratio, opens, sinceClose, prev, sinceLock, yesterday, kept7, reason] = raw;
  const cap = START_MODEL.cap;
  const x = [
    Math.sin((2 * Math.PI * hour) / 24),
    Math.cos((2 * Math.PI * hour) / 24),
    weekend,
    Math.min(ratio, 3),
    Math.log1p(opens),
    Math.log1p(Math.min(sinceClose, cap)),
    Math.min(prev, 3),
    Math.log1p(Math.min(sinceLock, cap)),
    Math.min(yesterday, 3),
    kept7,
  ];
  const offset = x.length;
  REASON_COLUMNS.forEach((r, i) => x.push(reason < 0 ? mean[offset + i] : reason === r ? 1 : 0));
  return x;
}

function standardize(raw: readonly number[]): number[] {
  return transform(raw).map((v, i) => (v - START_MODEL.mean[i]) / START_MODEL.std[i]);
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function startState(): RiskModelState {
  return {
    version: START_MODEL.version,
    weights: [...START_MODEL.weights],
    bias: START_MODEL.bias,
    updates: 0,
    updatedAt: null,
  };
}

/** 저장된 학습 상태. 없거나 시작 모델과 형식이 다르면 시작 모델. */
export function modelState(data: Pick<AppData, "riskModel">): RiskModelState {
  const s = data.riskModel;
  if (!s || s.version !== START_MODEL.version || s.weights.length !== START_MODEL.weights.length) {
    return startState();
  }
  return s;
}

/** 오래 볼 확률 (0~1). */
export function riskScore(state: RiskModelState, raw: readonly number[]): number {
  const z = standardize(raw).reduce((sum, v, i) => sum + v * state.weights[i], state.bias);
  return sigmoid(z);
}

/** 정렬된 값의 q 분위 (numpy quantile 기본값과 같은 선형 보간). */
export function quantile(sorted: readonly number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 지금 쓸 위험도 경계 [보통, 높음]. 최근 14일 열기 점수로 사람별로 정한다 (RELATIVE_BANDS).
 * 서비스는 정책표의 model.bands를 그대로 쓴다.
 */
export function bandsFor(data: Pick<AppData, "openLogs">, now = new Date()): [number, number] {
  const since = now.getTime() - RELATIVE_BANDS.days * 86_400_000;
  const scores = data.openLogs
    .filter((open) => {
      const at = new Date(open.createdAt).getTime();
      return at >= since && at <= now.getTime();
    })
    .map((open) => open.score)
    .sort((a, b) => a - b);
  if (scores.length < RELATIVE_BANDS.minHistory) return [START_MODEL.bands[0], START_MODEL.bands[1]];
  const medium = Math.max(RELATIVE_BANDS.floor[0], quantile(scores, RELATIVE_BANDS.quantiles[0]));
  const high = Math.max(RELATIVE_BANDS.floor[1], quantile(scores, RELATIVE_BANDS.quantiles[1]));
  return [medium, Math.max(medium, high)];
}

export function riskBand(score: number, bands: readonly number[] = START_MODEL.bands): RiskBand {
  if (score >= bands[1]) return "high";
  if (score >= bands[0]) return "medium";
  return "low";
}

/**
 * 정답 하나로 가중치를 고친다 (SGD). 예측은 고치기 전 가중치로 이미 했다.
 * 시작 가중치 쪽으로 조금씩 당겨, 몇 번의 기록에 휘둘리지 않게 한다.
 */
export function learn(state: RiskModelState, raw: readonly number[], label: boolean, at: string): RiskModelState {
  const x = standardize(raw);
  const p = riskScore(state, raw);
  const g = (label ? 1 : 0) - p;
  const w0 = START_MODEL.weights;
  return {
    version: state.version,
    weights: state.weights.map((w, i) => w + LEARN_RATE * (g * x[i] - LEARN_PULL * (w - w0[i]))),
    bias: state.bias + LEARN_RATE * g,
    updates: state.updates + 1,
    updatedAt: at,
  };
}

/**
 * 최근 7일(오늘 제외) 약속 지킨 비율 = 약속 끝 시트에서 "약속 지키고 나가기"를 고른 비율.
 * 약속 끝 기록이 없으면 DEFAULT_KEPT7.
 */
export function kept7(data: Pick<AppData, "interventions">, now = new Date()): number {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = end.getTime() - 7 * 86_400_000;
  let kept = 0;
  let total = 0;
  for (const log of data.interventions) {
    if (log.stage !== "commit_end") continue;
    const at = new Date(log.timestamp).getTime();
    if (at < start || at >= end.getTime()) continue;
    total += 1;
    if (log.outcome === "kept") kept += 1;
  }
  return total === 0 ? DEFAULT_KEPT7 : kept / total;
}

/** 열기가 끝났다고 보는 때: 마지막 시청이 끝나고(시청이 없으면 연 뒤) 이만큼 지남. 10분 안 이어 보기보다 길다. */
export const OPEN_DONE_MS = 30 * 60_000;

/** 3분 제한이 걸린 열기 (Java GuardRisk.action이 SHORT). 목표를 지키는 중이면 한 단계 약하게 써서 제한이 없다. */
export function wasLimited(open: Pick<OpenLog, "band" | "tighten" | "keeping">): boolean {
  return open.band === "high" && open.tighten === "full" && !open.keeping;
}

/** "잘 지키는 중"을 보는 기간 (오늘 제외). */
export const KEEPING_DAYS = 7;

/**
 * 최근 7일(오늘 제외) 하루도 빠짐없이 그날 목표 안에서 끝냈는지 (나무의 "지킨 날"과 같은 기준).
 * 그렇다면 위험도 개입을 한 단계 약하게 한다: 높음 → 추천 표시만, 보통 → 없음 (사용자 확인 2026-10-26).
 * 기록이 처음 생긴 지 7일이 안 됐으면 false (원래대로).
 */
export function keepingGoal(data: AppData, now = new Date()): boolean {
  const days = lastDates(KEEPING_DAYS + 1, now).slice(0, KEEPING_DAYS);
  const first = firstRecordDate(data);
  if (!first || first > days[0]) return false;
  return days.every((day) => usageSecondsOn(data, day) <= goalMinutesOn(data, day) * 60);
}

/**
 * 끝난 열기에 정답을 채우고, 시간 순서대로 가중치를 고친다.
 * 이 열기에서 본 시간 = openId가 이 열기인 시청 기록의 합 (연장, 10분 안 이어 보기 포함).
 *   - 본 시간 ≥ 그날 목표의 절반 → 오래 봄. 바로 정한다.
 *   - 아니면 열기가 끝났을 때 오래 안 봄: 다음 열기가 있거나, 지금 보고 있지 않고
 *     마지막 시청(없으면 연 시각)에서 30분이 지났을 때.
 * watching: 서비스가 지금 시청 중인지 (getStatus). 보고 있는 시청은 아직 기록이 오지 않았다.
 *
 * 3분 제한이 걸린 열기(위험 높음 + full)는 정답만 채우고 배우지 않는다. 모델은 "그냥 두면 오래 볼까"를
 * 배워야 하는데, 제한 덕분에 멈춘 것을 배우면 위험을 낮게 보고 제한을 풀게 된다. 제한의 효과는 밴딧이 잰다.
 */
export function settleOpenLogs(
  data: AppData,
  now = Date.now(),
  watching = false,
): { data: AppData; changed: OpenLog[]; modelChanged: boolean } {
  const pending = data.openLogs
    .filter((open) => open.label === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (pending.length === 0) return { data, changed: [], modelChanged: false };
  const watched = new Map<string, { seconds: number; lastEnd: number }>();
  for (const log of data.usageLogs) {
    if (!log.openId) continue;
    const prev = watched.get(log.openId) ?? { seconds: 0, lastEnd: 0 };
    watched.set(log.openId, {
      seconds: prev.seconds + log.duration,
      lastEnd: Math.max(prev.lastEnd, new Date(log.endTime).getTime()),
    });
  }
  const latest = data.openLogs.reduce((max, open) => (open.createdAt > max ? open.createdAt : max), "");
  let state = modelState(data);
  let modelChanged = false;
  const changed = new Map<string, OpenLog>();
  for (const open of pending) {
    const seen = watched.get(open.id) ?? { seconds: 0, lastEnd: 0 };
    const goal = goalMinutesOn(data, open.date) * 60;
    let label: boolean | null = null;
    if (seen.seconds >= goal / 2) {
      label = true;
    } else {
      const later = open.createdAt < latest;
      const quietSince = Math.max(new Date(open.createdAt).getTime(), seen.lastEnd);
      if (later || (!watching && now - quietSince >= OPEN_DONE_MS)) label = false;
    }
    if (label === null) continue;
    changed.set(open.id, { ...open, label, durationSec: seen.seconds });
    if (wasLimited(open)) continue;
    if (open.features.length === RAW_FEATURES.length && open.modelVersion === state.version) {
      state = learn(state, open.features, label, new Date(now).toISOString());
      modelChanged = true;
    }
  }
  if (changed.size === 0) return { data, changed: [], modelChanged: false };
  const openLogs = data.openLogs.map((open) => changed.get(open.id) ?? open);
  return {
    data: { ...data, openLogs, riskModel: modelChanged ? state : data.riskModel },
    changed: [...changed.values()],
    modelChanged,
  };
}
