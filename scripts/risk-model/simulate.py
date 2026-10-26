"""
가상 사용자 데이터 만들기 (예측 모델 2단계).

200명 × 12주. 사람마다 쇼츠를 연 순간 한 줄씩 남긴다.
한 줄 = 그 순간의 특징값 10개 + 정답(이번에 오래 봤는지) + 비교용 규칙 판단.

정답 "오래 봄" = 한 번 열어서 그날 목표의 절반 이상 봄 (docs/HANDOFF.md).
유형과 효과 크기는 추정치다. docs/risk-model/README.md의 성향 표와 같다.
일부 요인(그날 기분, 무작위 잡음)은 특징값에 넣지 않아 모델이 완벽히 맞힐 수 없게 한다.

실행: python scripts/risk-model/simulate.py  → scripts/risk-model/out/data.npz
"""

from __future__ import annotations

import bisect
import json
import math
from pathlib import Path

import numpy as np

SEED = 20261026
USERS = 200
DAYS = 84  # 12주
OUT = Path(__file__).resolve().parent / "out"

REASONS = ["심심해서", "습관적으로", "잠깐 보려고", "스트레스 해소를 위해", "특별한 이유 없이", "기타"]
# 이유가 "오래 봄"에 주는 효과 (로짓)
REASON_EFFECT = {
    "심심해서": 0.35,
    "습관적으로": 0.0,
    "잠깐 보려고": -0.6,
    "스트레스 해소를 위해": 0.6,
    "특별한 이유 없이": 0.15,
    "기타": 0.0,
}
STRESS = REASONS.index("스트레스 해소를 위해")


def profile(peaks: dict[int, float], floor: float = 0.2) -> list[float]:
    """시간대별 여는 무게. 새벽 3~7시는 거의 0."""
    w = [floor] * 24
    for h in range(3, 7):
        w[h] = 0.02
    for h, v in peaks.items():
        w[h] = v
    return w


# 유형별 기본값. 사람마다 이 값 주변에서 조금씩 다르게 뽑는다.
PERSONAS = {
    "A_night": dict(
        share=0.25, goal=45, opens=12, weekend_opens=1.2,
        hours=profile({19: 0.6, 20: 0.8, 21: 1.0, 22: 1.6, 23: 2.0, 0: 1.8, 1: 1.2, 2: 0.5}),
        risk_hours=[23, 0, 1], risk_boost=1.6, weekend_boost=0.2,
        base=-4.9, short_min=3.0, chain=0.15, kept=0.70, lock=0.20, rebound=0.3, mood_sd=0.3,
        reasons=[0.3, 0.3, 0.15, 0.1, 0.1, 0.05],
    ),
    "B_habit": dict(
        share=0.20, goal=40, opens=22, weekend_opens=1.1,
        hours=profile({8: 1.0, 9: 0.8, 12: 1.4, 13: 1.0, 18: 1.2, 19: 1.0, 22: 0.9, 23: 0.6}, floor=0.6),
        risk_hours=[], risk_boost=0.0, weekend_boost=0.2,
        base=-5.6, short_min=1.8, chain=0.35, kept=0.80, lock=0.15, rebound=0.2, mood_sd=0.3,
        reasons=[0.2, 0.45, 0.2, 0.05, 0.08, 0.02],
    ),
    "C_stress": dict(
        share=0.15, goal=60, opens=14, weekend_opens=1.1,
        hours=profile({12: 0.6, 17: 0.8, 18: 1.0, 19: 1.0, 20: 1.1, 21: 1.2, 22: 1.2, 23: 0.8}),
        risk_hours=[], risk_boost=0.0, weekend_boost=0.1,
        base=-5.1, short_min=4.0, chain=0.15, kept=0.65, lock=0.15, rebound=0.3, mood_sd=1.1,
        reasons=[0.2, 0.2, 0.15, 0.3, 0.12, 0.03],
    ),
    "D_weekend": dict(
        share=0.15, goal=40, opens=9, weekend_opens=2.0,
        hours=profile({12: 0.6, 18: 1.0, 19: 1.0, 20: 1.2, 21: 1.2, 22: 0.9, 14: 0.6, 15: 0.6, 16: 0.6}),
        weekend_hours=profile({11: 0.8, 13: 1.4, 14: 1.6, 15: 1.8, 16: 1.8, 17: 1.6, 18: 1.2, 20: 1.0, 21: 1.0, 22: 0.8}),
        risk_hours=[14, 15, 16, 17, 18], risk_boost=1.0, risk_weekend_only=True, weekend_boost=1.1,
        base=-5.3, short_min=3.5, chain=0.15, kept=0.80, lock=0.15, rebound=0.2, mood_sd=0.3,
        reasons=[0.35, 0.25, 0.2, 0.08, 0.1, 0.02],
    ),
    "E_trying": dict(
        share=0.15, goal=30, opens=9, weekend_opens=1.1,
        hours=profile({8: 0.6, 12: 0.8, 18: 0.8, 20: 1.0, 21: 1.0, 22: 0.8}),
        risk_hours=[22], risk_boost=0.5, weekend_boost=0.2,
        base=-4.6, short_min=3.5, chain=0.08, kept=0.93, lock=0.50, rebound=0.1, mood_sd=0.3,
        reasons=[0.15, 0.15, 0.5, 0.05, 0.12, 0.03],
    ),
    "F_rebound": dict(
        share=0.10, goal=40, opens=12, weekend_opens=1.2,
        hours=profile({17: 0.8, 18: 0.9, 19: 1.0, 20: 1.2, 21: 1.4, 22: 1.4, 23: 1.0}),
        risk_hours=[22, 23], risk_boost=0.6, weekend_boost=0.2,
        base=-5.1, short_min=3.5, chain=0.15, kept=0.70, lock=0.40, rebound=1.8, mood_sd=0.4,
        reasons=[0.3, 0.3, 0.15, 0.1, 0.12, 0.03],
    ),
}

# 모든 유형에 같은 크기로 들어가는 효과 (로짓)
COMMON = dict(
    collapse=0.8,  # 목표 절반을 넘긴 만큼 (최대 2배까지)
    opens=0.15,  # log(1 + 오늘 연 횟수)
    chain=0.7,  # 닫은 지 5분 안에 다시 열면
    prev=0.4,  # 직전 시청 길이 ÷ 목표
    yesterday=0.2,  # 어제 이 시각까지 본 시간 ÷ 목표
    kept=1.0,  # (최근 7일 약속 지킨 비율 − 0.75)만큼 낮춤
    noise=0.7,  # 무작위 잡음 (안 보임)
    novelty=0.5,  # 처음 3주는 앱이 새로워서 덜 봄
)

FEATURES = [
    "hour",
    "weekend",
    "today_ratio",
    "today_opens",
    "min_since_close",
    "prev_duration_ratio",
    "min_since_lock_end",
    "yesterday_by_now_ratio",
    "kept7",
    "reason",
]
NO_VALUE = 1e4  # "기록 없음"(오늘 처음 열기, 잠금 기록 없음)


def jitter(rng: np.random.Generator, value: float, rel: float = 0.25) -> float:
    return float(value * math.exp(rng.normal(0, rel)))


def make_user(rng: np.random.Generator, persona: str) -> dict:
    p = PERSONAS[persona]
    shift = int(rng.integers(-1, 2))  # 위험 시간이 사람마다 한 시간쯤 다르다
    goal = int(max(5, round(jitter(rng, p["goal"], 0.2) / 5) * 5))
    return dict(
        persona=persona,
        goal=goal,
        opens=jitter(rng, p["opens"]),
        weekend_opens=p["weekend_opens"],
        hours=np.roll(p["hours"], shift),
        weekend_hours=np.roll(p.get("weekend_hours", p["hours"]), shift),
        risk_hours={(h + shift) % 24 for h in p["risk_hours"]},
        risk_boost=jitter(rng, p["risk_boost"], 0.2),
        risk_weekend_only=p.get("risk_weekend_only", False),
        weekend_boost=p["weekend_boost"],
        base=p["base"] + rng.normal(0, 0.3),
        short_min=jitter(rng, p["short_min"], 0.2),
        chain=p["chain"],
        kept=min(0.98, jitter(rng, p["kept"], 0.08)),
        lock=p["lock"],
        rebound=jitter(rng, p["rebound"], 0.2),
        mood_sd=p["mood_sd"],
        reasons=np.array(p["reasons"]) / sum(p["reasons"]),
    )


def rule_risk_hours(daily_hours: list[np.ndarray], day: int) -> set[int]:
    """앱의 지금 규칙 (lib/ai.ts riskHours): 지난 14일(오늘 제외) 기록이 5일 이상일 때만,
    시간대 평균 5분 이상이고 평균의 1.5배 이상인 시간 중 상위 3개."""
    window = [daily_hours[d] for d in range(max(0, day - 14), day)]
    used = [h for h in window if h.sum() > 0]
    if len(used) < 5:
        return set()
    avg = np.mean(used, axis=0)
    active = avg[avg > 0]
    if active.size == 0:
        return set()
    mean = active.mean()
    cand = [(v, h) for h, v in enumerate(avg) if v >= 300 and v >= mean * 1.5]
    cand.sort(reverse=True)
    return {h for _, h in cand[:3]}


def simulate_user(rng: np.random.Generator, uid: int, user: dict) -> list[dict]:
    rows: list[dict] = []
    goal_sec = user["goal"] * 60
    daily_hours: list[np.ndarray] = []  # 날마다 시간대별 시청 초
    daily_kept: list[tuple[int, int]] = []  # 날마다 (지킨 수, 약속 수)
    lock_end_abs: float | None = None  # 마지막 잠금이 끝난 시각 (분, 첫날 0시 기준)
    last_close_abs: float | None = None
    last_duration = 0.0

    for day in range(DAYS):
        weekend = day % 7 in (5, 6)
        day0 = day * 1440
        mood = rng.normal(0, user["mood_sd"])  # 그날 기분 (안 보임)
        hours = user["weekend_hours"] if weekend else user["hours"]
        weights = np.asarray(hours) / np.sum(hours)
        n = rng.poisson(user["opens"] * (user["weekend_opens"] if weekend else 1.0) * math.exp(0.15 * mood))
        planned = sorted(
            float(h * 60 + rng.uniform(0, 60)) for h in rng.choice(24, size=n, p=weights)
        )
        rule_hours = rule_risk_hours(daily_hours, day)
        by_hour = np.zeros(24)
        kept_n = commits = 0
        watched = 0.0
        opens_today = 0
        # 분, 그날 0시 기준. 어젯밤 시청이 자정을 넘었으면 그 끝부터.
        busy_until = max(0.0, last_close_abs - day0) if last_close_abs is not None else 0.0
        locked_until = -1.0
        i = 0
        while i < len(planned):
            t = planned[i]
            i += 1
            if t < busy_until:
                t = busy_until + rng.uniform(0.5, 3)
            if t >= 1440:
                break
            if t < locked_until:
                continue  # 잠금 중에 연 것: 시청 없음
            hour = int(t // 60)
            now_abs = day0 + t

            # --- 특징값 (그 순간 앱이 알 수 있는 것만) ---
            since_close = now_abs - last_close_abs if last_close_abs is not None else NO_VALUE
            since_lock = now_abs - lock_end_abs if lock_end_abs is not None and lock_end_abs <= now_abs else NO_VALUE
            if day > 0:
                y = daily_hours[day - 1]
                yesterday_by_now = y[:hour].sum() + y[hour] * ((t % 60) / 60)
            else:
                yesterday_by_now = 0.0
            past = daily_kept[max(0, day - 7):day]
            k, c = sum(a for a, _ in past), sum(b for _, b in past)
            kept7 = k / c if c else 0.75
            weights_r = user["reasons"].copy()
            if mood > 0.5:
                weights_r[STRESS] *= 1 + mood
            weights_r /= weights_r.sum()
            reason = int(rng.choice(len(REASONS), p=weights_r))
            today_ratio = watched / goal_sec

            # --- "오래 볼" 확률 (진짜 규칙, 모델은 모른다) ---
            risky = hour in user["risk_hours"] and (weekend or not user["risk_weekend_only"])
            logit = (
                user["base"]
                + (user["risk_boost"] if risky else 0.0)
                + (user["weekend_boost"] if weekend else 0.0)
                + COMMON["collapse"] * min(2.0, max(0.0, today_ratio - 0.5))
                + COMMON["opens"] * math.log1p(opens_today)
                + (COMMON["chain"] if since_close < 5 else 0.0)
                + COMMON["prev"] * min(2.0, last_duration / goal_sec)
                + (user["rebound"] if since_lock < 30 else 0.0)
                + COMMON["yesterday"] * min(3.0, yesterday_by_now / goal_sec)
                - COMMON["kept"] * (kept7 - 0.75)
                + REASON_EFFECT[REASONS[reason]]
                + mood
                + rng.normal(0, COMMON["noise"])
                - COMMON["novelty"] * max(0.0, 1 - day / 21)
            )
            long = rng.random() < 1 / (1 + math.exp(-logit))
            if long:
                minutes = user["goal"] * 0.5 * (1 + rng.exponential(0.5))
                minutes = min(minutes, user["goal"] * 3)
            else:
                minutes = math.exp(math.log(user["short_min"]) + rng.normal(0, 0.6))
                minutes = min(max(minutes, 0.2), user["goal"] * 0.49)
            duration = minutes * 60

            rows.append(
                dict(
                    user=uid,
                    persona=user["persona"],
                    goal=user["goal"],
                    day=day,
                    minute=t,
                    hour=hour,
                    weekend=int(weekend),
                    today_ratio=today_ratio,
                    today_opens=opens_today,
                    min_since_close=min(since_close, NO_VALUE),
                    prev_duration_ratio=last_duration / goal_sec,
                    min_since_lock_end=min(since_lock, NO_VALUE),
                    yesterday_by_now_ratio=yesterday_by_now / goal_sec,
                    kept7=kept7,
                    reason=reason,
                    rule=int(hour in rule_hours),
                    label=int(long),
                    duration=duration,
                )
            )

            # --- 시청 반영 ---
            end = t + minutes
            # 시간대별 누적 (자정을 넘는 부분은 그날 마지막 시간에 넣는다)
            cursor = t
            while cursor < end:
                h = min(23, int(cursor // 60))
                nxt = min(end, (h + 1) * 60) if h < 23 else end
                by_hour[h] += (nxt - cursor) * 60
                cursor = nxt
            watched += duration
            opens_today += 1
            busy_until = end
            last_close_abs = day0 + end
            last_duration = duration
            commits += 1
            if not long and rng.random() < user["kept"]:
                kept_n += 1

            # 연쇄 열기: 닫자마자 다시 연다
            if rng.random() < user["chain"]:
                bisect.insort(planned, end + rng.exponential(2.0), lo=i)
            # 목표를 넘기면 가끔 잠근다
            if watched >= goal_sec and rng.random() < user["lock"]:
                length = float(rng.choice([10, 20, 30, 60]))
                locked_until = end + length
                lock_end_abs = day0 + locked_until
                rebound_open = 0.6 if user["rebound"] > 1 else 0.2
                if rng.random() < rebound_open:
                    bisect.insort(planned, locked_until + rng.exponential(5.0), lo=i)

        daily_hours.append(by_hour)
        daily_kept.append((kept_n, commits))
    return rows


def main() -> None:
    rng = np.random.default_rng(SEED)
    names = list(PERSONAS)
    shares = np.array([PERSONAS[n]["share"] for n in names])
    counts = np.round(shares * USERS).astype(int)
    counts[0] += USERS - counts.sum()
    personas = [n for n, c in zip(names, counts) for _ in range(c)]
    rows: list[dict] = []
    for uid, persona in enumerate(personas):
        user = make_user(rng, persona)
        rows.extend(simulate_user(rng, uid, user))

    OUT.mkdir(exist_ok=True)
    columns = list(rows[0].keys())
    arrays = {}
    for col in columns:
        values = [r[col] for r in rows]
        arrays[col] = np.array(values) if col != "persona" else np.array(values, dtype="U16")
    np.savez_compressed(OUT / "data.npz", **arrays)
    (OUT / "meta.json").write_text(
        json.dumps(dict(seed=SEED, users=USERS, days=DAYS, features=FEATURES, reasons=REASONS), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    label = arrays["label"]
    print(f"열기 {len(rows):,}줄, 사용자 {USERS}명, {DAYS}일")
    print(f"오래 봄 비율 전체 {label.mean():.1%}")
    for name in names:
        m = arrays["persona"] == name
        per_day = m.sum() / (counts[names.index(name)] * DAYS)
        minutes = arrays["duration"][m].sum() / 60 / (counts[names.index(name)] * DAYS)
        print(f"  {name:10s} 오래 봄 {label[m].mean():5.1%}  하루 열기 {per_day:4.1f}  하루 시청 {minutes:5.1f}분")


if __name__ == "__main__":
    main()
