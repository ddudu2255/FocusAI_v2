"""C(정답 바꾸기) 시뮬레이션: 앱 코드는 바꾸지 않는다.

지금 정답: 이번 한 번 열기에서 그날 목표의 절반 이상 봄.
C 정답:    이번 열기 시작부터 끝난 뒤 30분까지 본 시간(다른 열기 포함) ≥ 그날 목표 × 비율.

가상 사용자(out/data.npz, simulate.py)를 두 정답으로 다시 채점하고 같은 방법으로 학습해 비교한다.
실행: python scripts/risk-model/window_label.py [data 파일 이름, 기본 data.npz]
     관성 실험판은 simulate_inertia.py가 만든 data_inertia.npz
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

import compare

OUT = Path(__file__).resolve().parent / "out"
WINDOW_MIN = 30
FRACTIONS = [0.5, 1 / 3, 0.25]
SEED = compare.SEED


def recent_opens(d: dict) -> np.ndarray:
    """이번 열기 전 30분 안에 연 횟수 (같은 사용자, 같은 날). 앱에 넣을지 검토 중인 입력."""
    start = d["minute"].astype(float)
    out = np.zeros(len(start))
    key = d["user"].astype(np.int64) * 1000 + d["day"].astype(np.int64)
    order = np.argsort(key, kind="stable")
    for idx in np.split(order, np.flatnonzero(np.diff(key[order])) + 1):
        s = start[idx]
        out[idx] = ((s[None, :] < s[:, None]) & (s[None, :] >= s[:, None] - WINDOW_MIN)).sum(1)
    return out


window_seconds = compare.window_seconds


def split(d: dict) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(SEED)
    test: list[int] = []
    for persona in np.unique(d["persona"]):
        ids = np.unique(d["user"][d["persona"] == persona])
        test.extend(rng.choice(ids, size=max(1, round(len(ids) * 0.2)), replace=False).tolist())
    te = np.isin(d["user"], test)
    return ~te, te


def first_opens(d: dict, mask: np.ndarray, n: int = 50) -> np.ndarray:
    """사용자마다 처음 n번 열기 (새로 설치한 폰이 고정 기준을 쓰는 구간)."""
    out = np.zeros(len(mask), dtype=bool)
    order = np.lexsort((d["minute"], d["day"], d["user"]))
    seen: dict[int, int] = {}
    for i in order:
        if not mask[i]:
            continue
        u = int(d["user"][i])
        if seen.get(u, 0) < n:
            out[i] = True
            seen[u] = seen.get(u, 0) + 1
    return out


def evaluate(d: dict, X: np.ndarray, names: list[str], y: np.ndarray, tr: np.ndarray, te: np.ndarray) -> dict:
    mean, std = X[tr].mean(0), X[tr].std(0) + 1e-9
    Z = (X - mean) / std
    model = LogisticRegression(max_iter=2000).fit(Z[tr], y[tr])
    p = model.predict_proba(Z[te])[:, 1]
    rule = d["rule"][te]
    coef = dict(zip(names, model.coef_[0].round(3).tolist()))
    first = first_opens(d, te)[te]
    pf = p[first]
    # 처음 50번에서 높음 5%, 보통 15%가 되는 확률값 (새 고정 기준 후보)
    fixed = [float(np.quantile(pf, 0.85)), float(np.quantile(pf, 0.95))]
    per_persona = {}
    for persona in np.unique(d["persona"]):
        m = d["persona"][te] == persona
        per_persona[str(persona)] = dict(
            long_rate=round(float(y[te][m].mean()), 3),
            auc=round(float(roc_auc_score(y[te][m], p[m])), 3) if y[te][m].std() > 0 else None,
        )
    return dict(
        long_rate=round(float(y.mean()), 3),
        auc=round(float(roc_auc_score(y[te], p)), 3),
        rule_auc=round(float(roc_auc_score(y[te], rule)), 3) if rule.std() > 0 else 0.5,
        coef_today_opens=coef["log_today_opens"],
        coef_recent30=coef.get("log_recent30"),
        coef_since_close=coef["log_min_since_close"],
        coef_today_ratio=coef["today_ratio"],
        coef_prev=coef["prev_duration_ratio"],
        top=sorted(coef.items(), key=lambda t: -abs(t[1]))[:5],
        fixed_bands=[round(v, 3) for v in fixed],
        old_fixed_share_high=round(float((pf >= 0.2).mean()), 3),
        old_fixed_share_medium=round(float(((pf >= 0.1) & (pf < 0.2)).mean()), 3),
        per_persona=per_persona,
    )


def main() -> None:
    data_file = sys.argv[1] if len(sys.argv) > 1 else "data.npz"
    raw = np.load(OUT / data_file)
    d = {k: raw[k] for k in raw.files}
    X, names = compare.features(d)
    X2 = np.column_stack([X, np.log1p(recent_opens(d))])
    names2 = names + ["log_recent30"]
    tr, te = split(d)
    goal_sec = d["goal"] * 60.0
    win = window_seconds(d)
    old = d["label"].astype(int)

    results = {
        "old (한 번 열기, 절반)": evaluate(d, X, names, old, tr, te),
        "old + 최근30분 입력": evaluate(d, X2, names2, old, tr, te),
    }
    for f in FRACTIONS:
        y = (win >= goal_sec * f).astype(int)
        r = evaluate(d, X, names, y, tr, te)
        r["also_old"] = round(float(old[y == 1].mean()), 3)  # 새 "예" 중 원래도 "예"였던 비율
        results[f"C (30분 묶음, {f:.2f})"] = r
        if f == 0.5:
            results["C (0.50) + 최근30분 입력"] = evaluate(d, X2, names2, y, tr, te)
    (OUT / f"window_label_{Path(data_file).stem}.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, r in results.items():
        print(f"\n== {name}")
        for k, v in r.items():
            if k != "per_persona":
                print(f"  {k}: {v}")
        print("  유형별:", {p: (v['long_rate'], v['auc']) for p, v in r["per_persona"].items()})


if __name__ == "__main__":
    main()
