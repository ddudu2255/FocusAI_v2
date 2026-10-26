"""
규칙 · 로지스틱 회귀 · 랜덤 포레스트 비교 (예측 모델 2단계).

simulate.py가 만든 out/data.npz를 읽는다.

평가 세 가지:
  1. 새 사용자: 160명으로 학습, 처음 보는 40명으로 평가. APK에 넣을 시작 모델이 처음 설치한 사람에게 맞는지.
  2. 같은 사용자의 미래: 1~8주로 학습, 9~12주로 평가.
  3. 폰에서 조금씩 학습: 새 사용자 40명에게 시작 모델을 주고, 시청이 끝날 때마다 로지스틱 가중치를 고친다.
     시작 모델 그대로일 때와 주별로 비교한다.

멈춤 기준 (실행 전에 정함): 평가 1에서 로지스틱 AUC가 규칙보다 0.05 이상 높지 않으면 멈춘다.

실행: python scripts/risk-model/compare.py  → out/results.json, out/results.md
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

OUT = Path(__file__).resolve().parent / "out"
SEED = 7
STOP_MARGIN = 0.05
BANDS = (0.4, 0.7)  # 위험도 경계값 초안 (HANDOFF)
ALT_BANDS = (0.1, 0.2)  # 앱이 쓰는 경계 (6단계 시뮬레이션으로 정함, 사용자 확인 2026-10-26)
CAP = 720.0  # 12시간 넘게 지난 것은 같은 값으로 본다


def features(d: dict) -> tuple[np.ndarray, list[str]]:
    """로지스틱용 특징값. 앱(TypeScript)에서도 같은 계산을 한다."""
    hour = d["hour"].astype(float)
    since_close = np.minimum(d["min_since_close"], CAP)
    since_lock = np.minimum(d["min_since_lock_end"], CAP)
    cols = [
        ("hour_sin", np.sin(2 * np.pi * hour / 24)),
        ("hour_cos", np.cos(2 * np.pi * hour / 24)),
        ("weekend", d["weekend"].astype(float)),
        ("today_ratio", np.minimum(d["today_ratio"], 3.0)),
        ("log_today_opens", np.log1p(d["today_opens"])),
        ("log_min_since_close", np.log1p(since_close)),
        ("prev_duration_ratio", np.minimum(d["prev_duration_ratio"], 3.0)),
        ("log_min_since_lock_end", np.log1p(since_lock)),
        ("yesterday_by_now_ratio", np.minimum(d["yesterday_by_now_ratio"], 3.0)),
        ("kept7", d["kept7"]),
    ]
    for r in range(1, 6):  # 이유 6개 중 첫째(심심해서)를 기준으로 5개
        cols.append((f"reason_{r}", (d["reason"] == r).astype(float)))
    names = [n for n, _ in cols]
    return np.column_stack([c for _, c in cols]), names


def raw_features(d: dict) -> np.ndarray:
    """랜덤 포레스트용: 가공 없이 그대로 (나무는 구간을 스스로 나눈다)."""
    return np.column_stack(
        [
            d["hour"],
            d["weekend"],
            d["today_ratio"],
            d["today_opens"],
            np.minimum(d["min_since_close"], CAP),
            d["prev_duration_ratio"],
            np.minimum(d["min_since_lock_end"], CAP),
            d["yesterday_by_now_ratio"],
            d["kept7"],
            d["reason"],
        ]
    ).astype(float)


def scores(y: np.ndarray, p: np.ndarray) -> dict:
    return dict(
        auc=float(roc_auc_score(y, p)),
        ap=float(average_precision_score(y, p)),
        brier=float(brier_score_loss(y, np.clip(p, 0, 1))),
    )


def rule_scores(y: np.ndarray, flag: np.ndarray) -> dict:
    s = scores(y, flag.astype(float))
    hit = flag == 1
    s["flag_share"] = float(hit.mean())
    s["precision"] = float(y[hit].mean()) if hit.any() else 0.0
    s["recall"] = float(flag[y == 1].mean())
    return s


def band_table(y: np.ndarray, p: np.ndarray, bands: tuple[float, float] = BANDS) -> list[dict]:
    low, high = bands
    out = []
    for name, m in (("낮음", p < low), ("보통", (p >= low) & (p < high)), ("높음", p >= high)):
        out.append(dict(band=name, share=float(m.mean()), long_rate=float(y[m].mean()) if m.any() else None,
                        caught=float(m[y == 1].mean())))
    return out


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-z))


def online(X: np.ndarray, y: np.ndarray, users: np.ndarray, w0: np.ndarray, b0: float,
           lr: float = 0.01, pull: float = 0.002) -> np.ndarray:
    """사용자마다 시작 가중치에서 출발해, 한 번 볼 때마다 정답을 보고 고친다 (SGD).
    pull: 시작 가중치 쪽으로 조금씩 당겨, 몇 번의 기록에 휘둘리지 않게 한다.
    예측은 고치기 전에 한다 (그 순간에는 정답을 모른다)."""
    p = np.empty(len(y))
    for u in np.unique(users):
        idx = np.flatnonzero(users == u)  # 이미 시간 순서
        w, b = w0.copy(), b0
        for i in idx:
            z = X[i] @ w + b
            p[i] = 1 / (1 + np.exp(-z))
            g = y[i] - p[i]
            w += lr * (g * X[i] - pull * (w - w0))
            b += lr * g
    return p


def main() -> None:
    raw = np.load(OUT / "data.npz")
    d = {k: raw[k] for k in raw.files}
    y = d["label"]
    X, names = features(d)
    R = raw_features(d)
    users = d["user"]
    week = d["day"] // 7

    # --- 평가 1: 새 사용자 (유형 비율을 맞춰 40명을 뺀다) ---
    rng = np.random.default_rng(SEED)
    test_users: list[int] = []
    for persona in np.unique(d["persona"]):
        ids = np.unique(users[d["persona"] == persona])
        test_users.extend(rng.choice(ids, size=max(1, round(len(ids) * 0.2)), replace=False).tolist())
    is_test = np.isin(users, test_users)
    tr, te = ~is_test, is_test

    mean, std = X[tr].mean(0), X[tr].std(0) + 1e-9
    Z = (X - mean) / std
    lr_model = LogisticRegression(max_iter=2000, C=1.0).fit(Z[tr], y[tr])
    rf_model = RandomForestClassifier(n_estimators=200, min_samples_leaf=50, n_jobs=-1, random_state=SEED).fit(R[tr], y[tr])
    p_lr = lr_model.predict_proba(Z[te])[:, 1]
    p_rf = rf_model.predict_proba(R[te])[:, 1]
    eval1 = dict(
        users=len(test_users),
        rows=int(te.sum()),
        base_rate=float(y[te].mean()),
        rule=rule_scores(y[te], d["rule"][te]),
        logistic=scores(y[te], p_lr),
        forest=scores(y[te], p_rf),
        logistic_bands=band_table(y[te], p_lr),
        logistic_bands_alt=band_table(y[te], p_lr, ALT_BANDS),
    )
    per_persona = {}
    for persona in np.unique(d["persona"]):
        m = d["persona"][te] == persona
        per_persona[str(persona)] = dict(
            base_rate=float(y[te][m].mean()),
            rule=float(roc_auc_score(y[te][m], d["rule"][te][m])) if d["rule"][te][m].std() > 0 else 0.5,
            logistic=float(roc_auc_score(y[te][m], p_lr[m])),
            forest=float(roc_auc_score(y[te][m], p_rf[m])),
        )
    eval1["per_persona"] = per_persona

    # --- 평가 2: 같은 사용자의 미래 ---
    past, future = week < 8, week >= 8
    m2, s2 = X[past].mean(0), X[past].std(0) + 1e-9
    Z2 = (X - m2) / s2
    lr2 = LogisticRegression(max_iter=2000).fit(Z2[past], y[past])
    rf2 = RandomForestClassifier(n_estimators=200, min_samples_leaf=50, n_jobs=-1, random_state=SEED).fit(R[past], y[past])
    eval2 = dict(
        rows=int(future.sum()),
        base_rate=float(y[future].mean()),
        rule=rule_scores(y[future], d["rule"][future]),
        logistic=scores(y[future], lr2.predict_proba(Z2[future])[:, 1]),
        forest=scores(y[future], rf2.predict_proba(R[future])[:, 1]),
    )

    # --- 평가 3: 폰에서 조금씩 학습 (새 사용자) ---
    w0, b0 = lr_model.coef_[0].astype(float), float(lr_model.intercept_[0])
    p_on = online(Z[te], y[te], users[te], w0, b0)
    weekly = []
    for wk in range(12):
        m = week[te] == wk
        if y[te][m].std() == 0:
            continue
        weekly.append(dict(
            week=wk + 1,
            start_model=float(roc_auc_score(y[te][m], p_lr[m])),
            on_device=float(roc_auc_score(y[te][m], p_on[m])),
            rule=float(roc_auc_score(y[te][m], d["rule"][te][m])) if d["rule"][te][m].std() > 0 else 0.5,
        ))
    late = week[te] >= 8
    eval3 = dict(
        weekly=weekly,
        weeks_9_12=dict(start_model=scores(y[te][late], p_lr[late]), on_device=scores(y[te][late], p_on[late])),
    )

    importance = dict(
        logistic={n: float(c) for n, c in sorted(zip(names, lr_model.coef_[0]), key=lambda t: -abs(t[1]))},
        forest={n: float(v) for n, v in sorted(zip(
            ["hour", "weekend", "today_ratio", "today_opens", "min_since_close", "prev_duration_ratio",
             "min_since_lock_end", "yesterday_by_now_ratio", "kept7", "reason"],
            rf_model.feature_importances_), key=lambda t: -t[1])},
    )

    margin = eval1["logistic"]["auc"] - eval1["rule"]["auc"]
    verdict = dict(margin=margin, stop_margin=STOP_MARGIN, go=bool(margin >= STOP_MARGIN))
    results = dict(eval1_new_users=eval1, eval2_future=eval2, eval3_on_device=eval3,
                   importance=importance, verdict=verdict,
                   start_model=dict(features=names, mean=mean.tolist(), std=std.tolist(),
                                    weights=w0.tolist(), bias=b0))
    (OUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "results.md").write_text(report(results), encoding="utf-8")
    print(report(results))
    export_start_model(d, X, y, names)


def export_start_model(d: dict, X: np.ndarray, y: np.ndarray, names: list[str]) -> None:
    """APK에 넣을 시작 모델: 200명 전체로 다시 학습해 lib/risk-model.ts로 쓴다.
    checks는 앱(TypeScript·Java)이 같은 계산을 하는지 확인하는 예시 (날것 특징값 → 확률).
    이유를 모르면(-1) 이유 칸을 학습 평균으로 둔다 → 표준화하면 0."""
    mean, std = X.mean(0), X.std(0) + 1e-9
    Z = (X - mean) / std
    model = LogisticRegression(max_iter=2000, C=1.0).fit(Z, y)
    w, b = model.coef_[0], float(model.intercept_[0])
    raw_cols = ["hour", "weekend", "today_ratio", "today_opens", "min_since_close", "prev_duration_ratio",
                "min_since_lock_end", "yesterday_by_now_ratio", "kept7", "reason"]
    rng = np.random.default_rng(SEED)
    picks = rng.choice(len(y), size=6, replace=False)
    checks = []
    for n, i in enumerate(picks):
        raw = [float(d[c][i]) for c in raw_cols]
        z = Z[i].copy()
        if n == len(picks) - 1:  # 마지막 예시: 이유를 모르는 경우
            raw[-1] = -1.0
            z[[names.index(f"reason_{r}") for r in range(1, 6)]] = 0.0
        checks.append(dict(raw=raw, p=float(1 / (1 + np.exp(-(z @ w + b))))))
    model_json = dict(
        version="lr-1",
        features=names,
        mean=[round(float(v), 6) for v in mean],
        std=[round(float(v), 6) for v in std],
        weights=[round(float(v), 6) for v in w],
        bias=round(b, 6),
        bands=list(ALT_BANDS),
        cap=CAP,
    )
    # 반올림한 숫자로 다시 계산해, 앱이 쓰는 값과 checks가 정확히 맞게 한다.
    W, B = np.array(model_json["weights"]), model_json["bias"]
    M, S = np.array(model_json["mean"]), np.array(model_json["std"])
    for c in checks:
        x = transform_one(c["raw"], M, names)
        c["p"] = round(float(1 / (1 + np.exp(-(((x - M) / S) @ W + B)))), 6)
    model_json["checks"] = checks
    body = json.dumps(model_json, ensure_ascii=False, indent=2)
    path = Path(__file__).resolve().parents[2] / "lib" / "risk-model.ts"
    path.write_text(
        "// scripts/risk-model/compare.py가 만든 파일이다. 손으로 고치지 말고 스크립트를 다시 돌린다.\n"
        "// 가상 사용자 200명으로 학습한 시작 모델 (docs/risk-model/README.md).\n"
        f"export const START_MODEL = {body} as const;\n",
        encoding="utf-8",
    )
    print(f"시작 모델 → {path}")


def transform_one(raw: list[float], mean: np.ndarray, names: list[str]) -> np.ndarray:
    """날것 특징값 한 줄 → features()와 같은 변환. 이유가 -1이면 이유 칸은 평균."""
    hour, weekend, ratio, opens, since_close, prev, since_lock, yesterday, kept7, reason = raw
    x = [
        np.sin(2 * np.pi * hour / 24),
        np.cos(2 * np.pi * hour / 24),
        weekend,
        min(ratio, 3.0),
        np.log1p(opens),
        np.log1p(min(since_close, CAP)),
        min(prev, 3.0),
        np.log1p(min(since_lock, CAP)),
        min(yesterday, 3.0),
        kept7,
    ]
    for r in range(1, 6):
        x.append(mean[names.index(f"reason_{r}")] if reason < 0 else float(reason == r))
    return np.array(x, dtype=float)


def report(r: dict) -> str:
    e1, e2, e3, v = r["eval1_new_users"], r["eval2_future"], r["eval3_on_device"], r["verdict"]
    f = lambda x: f"{x:.3f}"
    lines = [
        "# 예측 모델 비교 결과 (가상 데이터)",
        "",
        f"## 1. 새 사용자 ({e1['users']}명, 열기 {e1['rows']:,}번, 오래 봄 {e1['base_rate']:.1%})",
        "",
        "| 모델 | AUC | AP | Brier |",
        "|---|---|---|---|",
        f"| 규칙 (지금 위험 시간) | {f(e1['rule']['auc'])} | {f(e1['rule']['ap'])} | {f(e1['rule']['brier'])} |",
        f"| 로지스틱 회귀 | {f(e1['logistic']['auc'])} | {f(e1['logistic']['ap'])} | {f(e1['logistic']['brier'])} |",
        f"| 랜덤 포레스트 | {f(e1['forest']['auc'])} | {f(e1['forest']['ap'])} | {f(e1['forest']['brier'])} |",
        "",
        f"규칙이 위험 시간이라고 한 열기: {e1['rule']['flag_share']:.1%}, 그중 실제 오래 봄 {e1['rule']['precision']:.1%}, "
        f"오래 본 열기 중 잡은 비율 {e1['rule']['recall']:.1%}",
    ]
    for key, (low, high) in (("logistic_bands", BANDS), ("logistic_bands_alt", ALT_BANDS)):
        lines += [
            "",
            f"로지스틱 위험도 (경계 {low:.0%} · {high:.0%}):",
            "",
            "| 위험도 | 열기 비율 | 그중 실제 오래 봄 | 오래 본 열기 중 이 칸 |",
            "|---|---|---|---|",
        ]
        for b in e1[key]:
            rate = "-" if b["long_rate"] is None else f"{b['long_rate']:.1%}"
            lines.append(f"| {b['band']} | {b['share']:.1%} | {rate} | {b['caught']:.1%} |")
    lines += ["", "유형별 AUC:", "", "| 유형 | 오래 봄 | 규칙 | 로지스틱 | 포레스트 |", "|---|---|---|---|---|"]
    for name, p in e1["per_persona"].items():
        lines.append(f"| {name} | {p['base_rate']:.1%} | {f(p['rule'])} | {f(p['logistic'])} | {f(p['forest'])} |")
    lines += [
        "",
        f"## 2. 같은 사용자의 미래 (1~8주 학습 → 9~12주, 오래 봄 {e2['base_rate']:.1%})",
        "",
        "| 모델 | AUC | AP | Brier |",
        "|---|---|---|---|",
        f"| 규칙 | {f(e2['rule']['auc'])} | {f(e2['rule']['ap'])} | {f(e2['rule']['brier'])} |",
        f"| 로지스틱 회귀 | {f(e2['logistic']['auc'])} | {f(e2['logistic']['ap'])} | {f(e2['logistic']['brier'])} |",
        f"| 랜덤 포레스트 | {f(e2['forest']['auc'])} | {f(e2['forest']['ap'])} | {f(e2['forest']['brier'])} |",
        "",
        "## 3. 폰에서 조금씩 학습 (새 사용자, 주별 AUC)",
        "",
        "| 주 | 규칙 | 시작 모델 그대로 | 폰에서 학습 |",
        "|---|---|---|---|",
    ]
    for w in e3["weekly"]:
        lines.append(f"| {w['week']} | {f(w['rule'])} | {f(w['start_model'])} | {f(w['on_device'])} |")
    s, o = e3["weeks_9_12"]["start_model"], e3["weeks_9_12"]["on_device"]
    lines += [
        "",
        f"9~12주: 시작 모델 AUC {f(s['auc'])} / AP {f(s['ap'])}, 폰에서 학습 AUC {f(o['auc'])} / AP {f(o['ap'])}",
        "",
        "## 특징값 중요도",
        "",
        "로지스틱 (표준화 계수, 클수록 영향 큼): "
        + ", ".join(f"{k} {v:+.2f}" for k, v in list(r["importance"]["logistic"].items())[:8]),
        "",
        "랜덤 포레스트: " + ", ".join(f"{k} {v:.2f}" for k, v in r["importance"]["forest"].items()),
        "",
        "## 판정",
        "",
        f"로지스틱 AUC − 규칙 AUC = {v['margin']:+.3f} (기준 +{v['stop_margin']:.2f}) → "
        + ("**계속 진행**" if v["go"] else "**멈춤**"),
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
