"""
개입 시뮬레이션 (예측 모델 6단계).

가상 사용자(simulate.py와 같은 200명 × 12주)에게 개입을 걸어 네 경우를 비교한다.
  ① 개입 없음      : 원래 보려던 만큼 본다.
  ② 지금 앱        : 위험 시간대(lib/ai.ts riskHours)면 약속 3분만, 연장 1번.
  ⑤ 약속만         : 약속("몇 분 볼래요?")은 있고 위험도 개입은 없다 (AI의 몫을 가르는 비교군).
  ③ 새 방식        : 예측 모델 위험도 + 밴딧(full/soft). 높음 full = 3분씩(연장 제한 없음),
                     보통 full·높음 soft = "3분 · 추천". 3분 제한이 걸린 열기는 배우지 않는다.
  ④ 새 방식(수정 전): ③과 같지만 3분 제한이 걸린 열기에서도 배운다.

개입에 대한 반응은 추정이다 (RESPONSE). 이 결과로 말할 수 있는 건 "설계대로 움직이는지"
(덜 귀찮은지, 학습이 꼬이지 않는지, 밴딧이 사람마다 다르게 고르는지)이고, 사용이 줄어든 정도는 아니다.

실행: python scripts/risk-model/policy_sim.py  → out/policy_results.md
"""

from __future__ import annotations

import bisect
import json
import math
from pathlib import Path

import numpy as np

from simulate import (
    COMMON,
    DAYS,
    NO_VALUE,
    PERSONAS,
    REASON_EFFECT,
    REASONS,
    SEED,
    STRESS,
    USERS,
    make_user,
    rule_risk_hours,
)

OUT = Path(__file__).resolve().parent / "out"
MODEL_TS = Path(__file__).resolve().parents[2] / "lib" / "risk-model.ts"

# 개입 반응 (추정). stop: 약속 시간이 끝날 때 그만둘 확률. follow: "3분 · 추천"을 보고 3분을 고를 확률.
# reopen: 연장이 막혀 나간 뒤 곧 다시 열 확률. B형은 개입이 잘 안 통하는 사람으로 둔다.
RESPONSE = {
    "A_night": dict(stop=0.15, follow=0.30, reopen=0.5),
    "B_habit": dict(stop=0.05, follow=0.10, reopen=0.8),
    "C_stress": dict(stop=0.15, follow=0.25, reopen=0.5),
    "D_weekend": dict(stop=0.25, follow=0.35, reopen=0.4),
    "E_trying": dict(stop=0.50, follow=0.60, reopen=0.2),
    "F_rebound": dict(stop=0.15, follow=0.30, reopen=0.5),
}
LADDER = [10, 5, 3]  # 연장할수록 최대 약속 (GuardPolicy extensionLadder)
LEARN_RATE, LEARN_PULL = 0.01, 0.002  # lib/risk.ts와 같다
TIGHTEN_PRIOR = {"full": (2.0, 1.0), "soft": (1.0, 1.0)}
REWARD_WINDOW, REWARD_CAP = 30.0, 15.0  # 분 (lib/ai.ts gradedReward)
REGIMES = ["none", "plain", "rule", "model", "model_unfixed"]
LABEL = {"none": "① 개입 없음", "plain": "⑤ 약속만", "rule": "② 지금 앱", "model": "③ 새 방식",
         "model_unfixed": "④ 새 방식(수정 전)"}


def load_model() -> dict:
    text = MODEL_TS.read_text(encoding="utf-8")
    body = text[text.index("{"): text.rindex("}") + 1]
    m = json.loads(body)
    return dict(mean=np.array(m["mean"]), std=np.array(m["std"]), weights=np.array(m["weights"]),
                bias=float(m["bias"]), cap=float(m["cap"]), bands=tuple(m["bands"]))


START = load_model()
BANDS = START["bands"]  # 앱과 같은 경계. 바꿔 보려면: python policy_sim.py 0.08 0.15
# 사람별 상대 경계 (앱과 같다, lib/risk.ts RELATIVE_BANDS): 그 사람의 최근 14일 열기 점수 중 이 분위 이상이면
# 보통·높음. 열기가 50번 쌓이기 전에는 BANDS(고정 확률). None이면 늘 BANDS (python policy_sim.py 0.1 0.2).
QUANTILES: tuple[float, float] | None = (0.85, 0.95)
FLOOR = (0.02, 0.04)  # 상대 경계라도 이 확률 미만이면 걸지 않는다
KEEPING_RULE = True  # 최근 7일 목표를 다 지켰으면 한 단계 약하게 (lib/risk.ts keepingGoal)


def transform(raw: list[float]) -> np.ndarray:
    """lib/risk.ts transform과 같다."""
    hour, weekend, ratio, opens, since_close, prev, since_lock, yesterday, kept7, reason = raw
    cap = START["cap"]
    x = [
        math.sin(2 * math.pi * hour / 24),
        math.cos(2 * math.pi * hour / 24),
        weekend,
        min(ratio, 3.0),
        math.log1p(opens),
        math.log1p(min(since_close, cap)),
        min(prev, 3.0),
        math.log1p(min(since_lock, cap)),
        min(yesterday, 3.0),
        kept7,
    ]
    for i, r in enumerate(range(1, 6)):
        x.append(START["mean"][10 + i] if reason < 0 else float(reason == r))
    return (np.array(x) - START["mean"]) / START["std"]


def natural_choice(minutes: float) -> int:
    """보고 싶은 만큼에 맞춰 고르는 약속 시간."""
    return 3 if minutes <= 3.5 else 5 if minutes <= 6 else 10


def simulate_user(uid: int, persona: str, regime: str) -> dict:
    # 같은 사람은 네 경우 모두 같은 성향으로 시작한다 (사람 뽑기와 행동의 난수를 나눈다).
    user = make_user(np.random.default_rng([SEED, uid]), persona)
    rng = np.random.default_rng([SEED, uid, 1])
    resp = RESPONSE[persona]
    goal_sec = user["goal"] * 60
    w, b = START["weights"].copy(), START["bias"]
    tighten = {band: {arm: list(TIGHTEN_PRIOR[arm]) for arm in TIGHTEN_PRIOR} for band in ("medium", "high")}
    daily_hours: list[np.ndarray] = []
    daily_kept: list[tuple[int, int]] = []
    lock_end_abs: float | None = None
    last_close_abs: float | None = None
    last_duration = 0.0
    stats = dict(minutes=[], long=[], limited=[], suggested=[], high_share=[], opens=[], learned=0)
    recent_scores: list[list[float]] = []  # 날마다 그날의 열기 점수

    for day in range(DAYS):
        weekend = day % 7 in (5, 6)
        day0 = day * 1440
        mood = rng.normal(0, user["mood_sd"])
        hours = user["weekend_hours"] if weekend else user["hours"]
        weights_h = np.asarray(hours) / np.sum(hours)
        n = rng.poisson(user["opens"] * (user["weekend_opens"] if weekend else 1.0) * math.exp(0.15 * mood))
        planned = sorted(float(h * 60 + rng.uniform(0, 60)) for h in rng.choice(24, size=n, p=weights_h))
        rule_hours = rule_risk_hours(daily_hours, day)
        by_hour = np.zeros(24)
        kept_n = commits = 0
        watched = 0.0
        opens_today = long_today = limited_today = suggested_today = high_today = 0
        busy_until = max(0.0, last_close_abs - day0) if last_close_abs is not None else 0.0
        locked_until = -1.0
        picks: dict[str, str] = {}  # 위험도별 오늘의 밴딧 선택 (하루 고정)
        # 최근 7일 목표를 다 지켰으면 한 단계 약하게 (lib/risk.ts keepingGoal)
        keeping = KEEPING_RULE and day >= 7 and all(m <= user["goal"] for m in stats["minutes"][-7:])
        today_scores: list[float] = []
        if QUANTILES is not None:
            history = [v for day_scores in recent_scores[-14:] for v in day_scores]
            if len(history) >= 50:
                cut = (max(FLOOR[0], float(np.quantile(history, QUANTILES[0]))),
                       max(FLOOR[1], float(np.quantile(history, QUANTILES[1]))))
            else:
                cut = BANDS
        else:
            cut = BANDS
        rewards: list[tuple[float, str, str]] = []  # (연 시각, 위험도, 선택)
        spans: list[tuple[float, float]] = []  # 오늘 본 구간 (분)
        i = 0
        while i < len(planned):
            t = planned[i]
            i += 1
            if t < busy_until:
                t = busy_until + rng.uniform(0.5, 3)
            if t >= 1440:
                break
            if t < locked_until:
                continue
            hour = int(t // 60)
            now_abs = day0 + t
            since_close = now_abs - last_close_abs if last_close_abs is not None else NO_VALUE
            since_lock = now_abs - lock_end_abs if lock_end_abs is not None and lock_end_abs <= now_abs else NO_VALUE
            if day > 0:
                y = daily_hours[day - 1]
                yesterday_by_now = y[:hour].sum() + y[hour] * ((t % 60) / 60)
            else:
                yesterday_by_now = 0.0
            past = daily_kept[max(0, day - 7):day]
            k, c = sum(a for a, _ in past), sum(b_ for _, b_ in past)
            kept7 = k / c if c else 0.75
            weights_r = user["reasons"].copy()
            if mood > 0.5:
                weights_r[STRESS] *= 1 + mood
            weights_r /= weights_r.sum()
            reason = int(rng.choice(len(REASONS), p=weights_r))
            today_ratio = watched / goal_sec

            # 원래 보려던 시간 (simulate.py와 같은 규칙)
            risky_true = hour in user["risk_hours"] and (weekend or not user["risk_weekend_only"])
            logit = (
                user["base"]
                + (user["risk_boost"] if risky_true else 0.0)
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
            wants_long = rng.random() < 1 / (1 + math.exp(-logit))
            if wants_long:
                desire = min(user["goal"] * 0.5 * (1 + rng.exponential(0.5)), user["goal"] * 3)
            else:
                desire = min(max(math.exp(math.log(user["short_min"]) + rng.normal(0, 0.6)), 0.2), user["goal"] * 0.49)

            # --- 위험도와 동작 ---
            action = "none"
            band_r = None
            x = None
            if regime in ("model", "model_unfixed"):
                raw = [hour, int(weekend), today_ratio, opens_today, min(since_close, NO_VALUE),
                       last_duration / goal_sec, min(since_lock, NO_VALUE), yesterday_by_now / goal_sec, kept7, reason]
                x = transform(raw)
                p = 1 / (1 + math.exp(-(x @ w + b)))
                today_scores.append(p)
                band_r = "high" if p >= cut[1] else "medium" if p >= cut[0] else None
                if band_r:
                    if band_r not in picks:
                        draws = {arm: rng.beta(*tighten[band_r][arm]) for arm in ("full", "soft")}
                        picks[band_r] = max(draws, key=draws.get)
                    soft = keeping or picks[band_r] == "soft"
                    action = ("suggest" if soft else "short") if band_r == "high" else ("none" if soft else "suggest")
                    if band_r == "high":
                        high_today += 1
            rule_risky = regime == "rule" and hour in rule_hours
            if action == "short" or rule_risky:
                limited_today += 1
            if action == "suggest":
                suggested_today += 1

            # --- 보기 (약속 단위로 끊어 보고, 약속이 끝날 때마다 그만둘지 정한다) ---
            reopen_soon = False
            if regime == "none":
                minutes = desire
            elif today_ratio >= 1:
                # 강함: 잠금 또는 "3분만 더"를 3분씩
                if rng.random() < user["lock"]:
                    minutes = 0.0
                    length = float(rng.choice([10, 20, 30, 60]))
                    locked_until = t + length
                    lock_end_abs = day0 + locked_until
                else:
                    minutes = 0.0
                    while minutes < desire:
                        step = min(3.0, desire - minutes)
                        minutes += step
                        if minutes < desire and rng.random() < resp["stop"] + 0.1:
                            break
            else:
                short = action == "short" or rule_risky
                follow = action == "suggest" and rng.random() < resp["follow"]
                chunk = 3 if short or follow else natural_choice(desire)
                minutes, ext = 0.0, 0
                while True:
                    step = min(chunk, desire - minutes)
                    minutes += step
                    if minutes >= desire - 1e-9:
                        kept_n += 1  # 약속 안에서 끝냄
                        commits += 1
                        break
                    commits += 1
                    if rng.random() < resp["stop"]:
                        kept_n += 1  # 약속 지키고 나가기
                        break
                    if rule_risky and ext >= 1:
                        kept_n += 1  # 연장 버튼이 없어 나감
                        reopen_soon = rng.random() < resp["reopen"]
                        break
                    cap = LADDER[min(ext, len(LADDER) - 1)]
                    chunk = 3 if short else min(cap, natural_choice(desire - minutes))
                    ext += 1

            duration = minutes * 60
            is_long = duration >= goal_sec / 2
            if band_r is not None and not keeping:
                rewards.append((t, band_r, picks[band_r]))
            if x is not None and not (regime == "model" and action == "short"):
                p = 1 / (1 + math.exp(-(x @ w + b)))
                g = (1.0 if is_long else 0.0) - p
                w = w + LEARN_RATE * (g * x - LEARN_PULL * (w - START["weights"]))
                b = b + LEARN_RATE * g
                stats["learned"] += 1

            end = t + minutes
            if minutes > 0:
                spans.append((t, end))
                cursor = t
                while cursor < end:
                    h = min(23, int(cursor // 60))
                    nxt = min(end, (h + 1) * 60) if h < 23 else end
                    by_hour[h] += (nxt - cursor) * 60
                    cursor = nxt
                last_close_abs = day0 + end
                last_duration = duration
            watched += duration
            opens_today += 1
            long_today += int(is_long)
            busy_until = max(busy_until, end)

            if rng.random() < user["chain"] or reopen_soon:
                bisect.insort(planned, end + rng.exponential(2.0), lo=i)

        # 밴딧 보상: 연 뒤 30분 동안 본 시간 (다음 날로 넘어간 부분은 뺀다)
        for at, band_r, arm in rewards:
            seen = sum(max(0.0, min(e, at + REWARD_WINDOW) - max(s, at)) for s, e in spans)
            r = max(0.0, 1 - seen / REWARD_CAP)
            tighten[band_r][arm][0] += r
            tighten[band_r][arm][1] += 1 - r

        daily_hours.append(by_hour)
        daily_kept.append((kept_n, commits))
        recent_scores.append(today_scores)
        stats["minutes"].append(watched / 60)
        stats["long"].append(long_today)
        stats["limited"].append(limited_today)
        stats["suggested"].append(suggested_today)
        stats["opens"].append(opens_today)
        stats["high_share"].append(high_today / opens_today if opens_today else 0.0)

    stats["soft_mean"] = {band: tighten[band]["soft"][0] / sum(tighten[band]["soft"])
                          - tighten[band]["full"][0] / sum(tighten[band]["full"]) for band in tighten}
    return stats


def main() -> None:
    global BANDS, QUANTILES
    import sys
    if len(sys.argv) == 4 and sys.argv[1] == "q":
        QUANTILES = (float(sys.argv[2]), float(sys.argv[3]))
        print(f"사람별 상대 경계: 상위 {1 - QUANTILES[0]:.0%} 보통 이상, 상위 {1 - QUANTILES[1]:.0%} 높음")
    elif len(sys.argv) == 3:
        QUANTILES = None
        BANDS = (float(sys.argv[1]), float(sys.argv[2]))
        print(f"경계 {BANDS}")
    names = list(PERSONAS)
    shares = np.array([PERSONAS[n]["share"] for n in names])
    counts = np.round(shares * USERS).astype(int)
    counts[0] += USERS - counts.sum()
    personas = [n for n, c in zip(names, counts) for _ in range(c)]

    results: dict[str, list[dict]] = {}
    for regime in REGIMES:
        results[regime] = [simulate_user(uid, persona, regime) for uid, persona in enumerate(personas)]
        print(f"{LABEL[regime]} 완료")

    late = slice(56, DAYS)  # 9~12주
    report = ["# 개입 시뮬레이션 결과 (가상 데이터, 반응은 추정)", ""]
    report += ["## 전체 (9~12주 평균)", "",
               "| 경우 | 하루 시청(분) | 하루 오래 본 열기 | 일주일 3분 제한 | 일주일 추천 표시 |",
               "|---|---|---|---|---|"]
    summary = {}
    for regime in REGIMES:
        rows = results[regime]
        minutes = np.mean([np.mean(s["minutes"][late]) for s in rows])
        long = np.mean([np.mean(s["long"][late]) for s in rows])
        limited = np.mean([np.mean(s["limited"][late]) * 7 for s in rows])
        suggested = np.mean([np.mean(s["suggested"][late]) * 7 for s in rows])
        summary[regime] = dict(minutes=minutes, long=long, limited=limited, suggested=suggested)
        report.append(f"| {LABEL[regime]} | {minutes:.1f} | {long:.2f} | {limited:.1f} | {suggested:.1f} |")

    report += ["", "## 유형별 하루 시청(분, 9~12주)", "",
               "| 유형 | " + " | ".join(LABEL[r] for r in REGIMES) + " | ③ 일주일 3분 제한 | ② 일주일 3분 제한 |",
               "|---|" + "---|" * (len(REGIMES) + 2)]
    for name in names:
        idx = [i for i, p in enumerate(personas) if p == name]
        cells = [f"{np.mean([np.mean(results[r][i]['minutes'][late]) for i in idx]):.1f}" for r in REGIMES]
        lim3 = np.mean([np.mean(results["model"][i]["limited"][late]) * 7 for i in idx])
        lim2 = np.mean([np.mean(results["rule"][i]["limited"][late]) * 7 for i in idx])
        report.append(f"| {name} | " + " | ".join(cells) + f" | {lim3:.1f} | {lim2:.1f} |")

    report += ["", "## 학습이 꼬이는지: 주별 위험 높음 비율과 하루 시청(분)", "",
               "| 주 | ③ 높음 비율 | ③ 시청 | ④ 높음 비율 | ④ 시청 |", "|---|---|---|---|---|"]
    for wk in range(12):
        days = slice(wk * 7, wk * 7 + 7)
        cell = []
        for regime in ("model", "model_unfixed"):
            hs = np.mean([np.mean(s["high_share"][days]) for s in results[regime]])
            mn = np.mean([np.mean(s["minutes"][days]) for s in results[regime]])
            cell += [f"{hs:.1%}", f"{mn:.1f}"]
        report.append(f"| {wk + 1} | " + " | ".join(cell) + " |")

    report += ["", "## 밴딧: 12주 뒤 soft − full 평균 점수 (③, 양수면 약하게 쪽이 낫다고 배움)", "",
               "| 유형 | 보통 | 높음 |", "|---|---|---|"]
    for name in names:
        idx = [i for i, p in enumerate(personas) if p == name]
        med = np.mean([results["model"][i]["soft_mean"]["medium"] for i in idx])
        high = np.mean([results["model"][i]["soft_mean"]["high"] for i in idx])
        report.append(f"| {name} | {med:+.2f} | {high:+.2f} |")

    OUT.mkdir(exist_ok=True)
    text = "\n".join(report) + "\n"
    (OUT / "policy_results.md").write_text(text, encoding="utf-8")
    (OUT / "policy_results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
