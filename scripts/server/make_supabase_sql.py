"""
팀원 Supabase에 더할 SQL 만들기 (supabase/shortsai_v1.sql).

팀원 기존 표(sessions, interventions, lock_attempts)와 함수(usage_install_id, delete_own_usage)는
바꾸지 않고 쓰기만 한다. 우리 것은 모두 sai_ 로 시작하는 새 표·함수다.
되돌리기는 supabase/shortsai_v1_rollback.sql (sai_ 표·함수만 지운다).

시연 데이터와 유형별 시작값은 가상 사용자(scripts/risk-model/out/data.npz)로 계산해 넣는다.
실제 사용자에게 진짜처럼 보여 주지 않는다: 시연 비교는 demo = true로만 돌려준다.

실행: python scripts/server/make_supabase_sql.py   (먼저 scripts/risk-model/simulate.py)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "risk-model"))
import compare  # noqa: E402  (같은 특징값 변환을 쓴다)

OUT = ROOT / "supabase" / "shortsai_v1.sql"
# 앱에 넣는 같은 유형 정보: 처음 질문을 폰 안에서 고르게 한다 (서버로 아무것도 보내지 않음)
CLUSTERS_TS = ROOT / "lib" / "clusters.ts"
MIN_USERS = 20
SLOTS = {"morning": range(5, 11), "day": range(11, 17), "evening": range(17, 22), "night": [22, 23, 0, 1, 2, 3, 4]}
GOAL_BUCKETS = [(30, "≤30"), (45, "31-45"), (60, "46-60"), (10_000, "61+")]
NAMES = {
    "A_night": "밤에 몰아 보는 편",
    "B_habit": "짧게 자주 여는 편",
    "C_stress": "기분에 따라 길어지는 편",
    "D_weekend": "주말에 길어지는 편",
    "E_trying": "줄이려고 애쓰는 편",
    "F_rebound": "쉬고 나면 몰아 보는 편",
}


def goal_bucket(goal: float) -> str:
    return next(name for limit, name in GOAL_BUCKETS if goal <= limit)


def model_text() -> dict:
    text = (ROOT / "lib" / "risk-model.ts").read_text(encoding="utf-8")
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


def main() -> None:
    raw = np.load(ROOT / "scripts" / "risk-model" / "out" / "data.npz")
    d = {k: raw[k] for k in raw.files}
    start = model_text()
    days = int(d["day"].max()) + 1

    # --- 시연 비교: 마지막 14일, 시간대별 ---
    recent = d["day"] >= days - 14
    by_hour = []
    for h in range(24):
        m = recent & (d["hour"] == h)
        users = len(np.unique(d["user"][m]))
        if users < MIN_USERS:
            by_hour.append(None)
            continue
        minutes = d["duration"][m] / 60
        by_hour.append(dict(
            users=users,
            opens=int(m.sum()),
            # 앱에서는 "몇 분 볼래요?"에서 3분을 고른 비율, 시트에서 바로 나간 비율이다.
            # 가상 데이터에는 시트가 없어 3분 이하로 끝낸 비율, 1분 안에 끝낸 비율로 대신한다.
            shortRate=round(float(np.mean(minutes <= 3.5)), 3),
            exitRate=round(float(np.mean(minutes < 1)), 3),
        ))

    # --- 시연 비교: 목표 묶음별 지난 7일 지킨 날 ---
    last7 = range(days - 7, days)
    by_goal: dict[str, dict | None] = {}
    per_bucket: dict[str, list[int]] = {}
    for u in np.unique(d["user"]):
        mu = d["user"] == u
        goal = float(d["goal"][mu][0])
        kept = sum(d["duration"][mu & (d["day"] == day)].sum() <= goal * 60 for day in last7)
        per_bucket.setdefault(goal_bucket(goal), []).append(int(kept))
    for _, name in GOAL_BUCKETS:
        rows = per_bucket.get(name, [])
        by_goal[name] = (
            dict(users=len(rows), avgKeptDays=round(float(np.mean(rows)), 1)) if len(rows) >= MIN_USERS else None
        )
    demo = dict(byHour=by_hour, byGoal=by_goal, minUsers=MIN_USERS, days=14)

    # --- 유형(성향)별 중심값과 시작 모델 ---
    X, names = compare.features(d)
    mean, std = np.array(start["mean"]), np.array(start["std"])
    Z = (X - mean) / std
    clusters = []
    for persona in sorted(np.unique(d["persona"])):
        m = d["persona"] == persona
        users = np.unique(d["user"][m])
        daily = [d["duration"][d["user"] == u].sum() / 60 / days for u in users]
        hours = d["hour"][m]
        weights = d["duration"][m]
        share = {slot: float(weights[np.isin(hours, list(hs))].sum() / weights.sum()) for slot, hs in SLOTS.items()}
        lr = LogisticRegression(max_iter=2000, C=1.0).fit(Z[m], d["label"][m])
        goal = float(np.median(d["goal"][m]))
        clusters.append(dict(
            id=str(persona),
            name=NAMES.get(str(persona), str(persona)),
            suggestedGoal=int(round(goal / 5) * 5),
            centroid=dict(minutes=round(float(np.mean(daily)), 1), **{k: round(v, 3) for k, v in share.items()}),
            model=dict(version=start["version"], weights=[round(float(w), 6) for w in lr.coef_[0]],
                       bias=round(float(lr.intercept_[0]), 6)),
        ))

    OUT.write_text(sql(demo, clusters), encoding="utf-8")
    CLUSTERS_TS.write_text(
        "// scripts/server/make_supabase_sql.py가 만든 파일이다. 손으로 고치지 말고 스크립트를 다시 돌린다.\n"
        "// 처음 질문으로 고르는 유형 (가상 사용자 200명으로 계산). supabase/shortsai_v1.sql의 sai_clusters와 같다.\n"
        f"export const CLUSTERS = {json.dumps(clusters, ensure_ascii=False, indent=2)} as const;\n",
        encoding="utf-8",
    )
    print(f"→ {OUT}\n→ {CLUSTERS_TS}")
    for c in clusters:
        print(f"  {c['id']:10s} {c['name']}  하루 {c['centroid']['minutes']}분, 추천 목표 {c['suggestedGoal']}분")


def literal(value) -> str:
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def sql(demo: dict, clusters: list[dict]) -> str:
    seed_clusters = ",\n".join(
        f"  ('{c['id']}', '{c['name']}', {c['suggestedGoal']}, {literal(c['centroid'])}, {literal(c['model'])})"
        for c in clusters
    )
    return f"""-- ShortsAI 추가 표·함수 (v1). scripts/server/make_supabase_sql.py가 만든 파일이다.
--
-- 팀원 기존 표(sessions, interventions, lock_attempts)와 함수(usage_install_id, delete_own_usage)는
-- 바꾸지 않고 그대로 쓴다. 이 파일이 만드는 것은 모두 sai_ 로 시작한다.
-- 여러 번 실행해도 된다 (if not exists / create or replace).
-- 되돌리기: shortsai_v1_rollback.sql
--
-- 권한은 팀원 설계와 같다: 공개(anon) 키는 자기 설치 번호(x-install-id 헤더)로 넣기만 할 수 있고 읽을 수 없다.
-- 비교 통계·유형 찾기는 계산 결과만 돌려주는 함수로만 열어 둔다. 한 칸 사용자가 {MIN_USERS}명 미만이면 비운다.

begin;

-- 시청 기록이 이어진 열기 (sessions.event_id와 같은 id)
create table if not exists public.sai_session_links (
  event_id text primary key,
  install_id text not null,
  open_id text,
  target text not null
);

-- 예측 모델 기록: 쇼츠·릴스를 열어 시트가 뜬 순간 한 줄 (정답이 정해진 뒤에만 올린다)
create table if not exists public.sai_opens (
  event_id text primary key,
  install_id text not null,
  created_at timestamptz not null,
  target text,
  features jsonb not null,
  score double precision not null,
  band text not null,
  tighten text,
  keeping boolean not null default false,
  label boolean not null,
  watched_sec double precision not null,
  model_version text not null
);

-- 개입 기록에 더한 칸 (interventions.event_id와 같은 id)
create table if not exists public.sai_intervention_details (
  event_id text primary key,
  install_id text not null,
  hour integer not null,
  target text,
  reason smallint,
  risk_band text,
  tighten text,
  open_id text
);

-- 하루 요약 (목표가 비슷한 사람끼리 비교)
create table if not exists public.sai_daily (
  install_id text not null,
  day date not null,
  goal_minutes integer not null,
  watched_sec double precision not null,
  kept boolean not null,
  primary key (install_id, day)
);

-- 시연용 비교 통계 (가상 사용자로 계산), 유형별 시작값
create table if not exists public.sai_compare_demo (
  key text primary key,
  value jsonb not null
);

create table if not exists public.sai_clusters (
  id text primary key,
  name text not null,
  suggested_goal integer not null,
  centroid jsonb not null,
  model jsonb not null
);

create index if not exists sai_session_links_install on public.sai_session_links (install_id);
create index if not exists sai_opens_install on public.sai_opens (install_id);
create index if not exists sai_opens_created on public.sai_opens (created_at);
create index if not exists sai_details_install on public.sai_intervention_details (install_id);

alter table public.sai_session_links enable row level security;
alter table public.sai_opens enable row level security;
alter table public.sai_intervention_details enable row level security;
alter table public.sai_daily enable row level security;
alter table public.sai_compare_demo enable row level security;
alter table public.sai_clusters enable row level security;

revoke all on table public.sai_session_links, public.sai_opens, public.sai_intervention_details,
  public.sai_daily, public.sai_compare_demo, public.sai_clusters from anon, authenticated;
grant insert on table public.sai_session_links, public.sai_opens, public.sai_intervention_details,
  public.sai_daily to anon, authenticated;
grant all on table public.sai_session_links, public.sai_opens, public.sai_intervention_details,
  public.sai_daily, public.sai_compare_demo, public.sai_clusters to service_role;

drop policy if exists sai_session_links_insert_own on public.sai_session_links;
create policy sai_session_links_insert_own on public.sai_session_links
  for insert to anon, authenticated with check (install_id = public.usage_install_id());
drop policy if exists sai_opens_insert_own on public.sai_opens;
create policy sai_opens_insert_own on public.sai_opens
  for insert to anon, authenticated with check (install_id = public.usage_install_id());
drop policy if exists sai_details_insert_own on public.sai_intervention_details;
create policy sai_details_insert_own on public.sai_intervention_details
  for insert to anon, authenticated with check (install_id = public.usage_install_id());
drop policy if exists sai_daily_insert_own on public.sai_daily;
create policy sai_daily_insert_own on public.sai_daily
  for insert to anon, authenticated with check (install_id = public.usage_install_id());

-- 앱이 이 파일이 실행됐는지 확인한다. 실행 전에는 팀원 기존 표에만 올린다.
create or replace function public.sai_schema_version()
returns integer language sql stable set search_path = public as $$ select 1 $$;

-- 이 설치의 우리 표 줄과 팀원 표 줄을 모두 지운다.
create or replace function public.sai_delete_own()
returns void language plpgsql security definer set search_path = public as $$
declare
  install text := public.usage_install_id();
begin
  if install is null then
    raise exception 'install id required' using errcode = '42501';
  end if;
  delete from public.sai_session_links where install_id = install;
  delete from public.sai_opens where install_id = install;
  delete from public.sai_intervention_details where install_id = install;
  delete from public.sai_daily where install_id = install;
  perform public.delete_own_usage();
end;
$$;

-- 다른 사용자와 비교 (계산 결과만). p_demo = true면 시연 데이터를 돌려준다 (demo: true).
-- byHour: 기기 시각 0~23시별 지난 14일, 쇼츠·릴스를 연 사람 중 3분을 고른 비율(shortRate), 시트에서 바로 나간 비율(exitRate).
-- byGoal: 하루 목표 묶음별 지난 7일 평균 지킨 날.
create or replace function public.sai_compare(p_demo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hours jsonb := '[]'::jsonb;
  goals jsonb := '{{}}'::jsonb;
  h integer;
  row_users integer;
  row_opens integer;
  row_short double precision;
  row_exit double precision;
begin
  if p_demo then
    return (select value from public.sai_compare_demo where key = 'v1') || '{{"demo": true}}'::jsonb;
  end if;
  for h in 0..23 loop
    select count(distinct i.install_id), count(*),
           avg(case when i.commit_minutes > 0 then (i.commit_minutes = 3)::int end),
           avg((i.outcome = 'exit')::int)
      into row_users, row_opens, row_short, row_exit
      from public.interventions i
      join public.sai_intervention_details d on d.event_id = i.event_id
     where i.stage = 'entry' and d.hour = h and i.created_at > now() - interval '14 days';
    if row_users >= {MIN_USERS} then
      hours := hours || jsonb_build_array(jsonb_build_object(
        'users', row_users, 'opens', row_opens,
        'shortRate', round(coalesce(row_short, 0)::numeric, 3), 'exitRate', round(coalesce(row_exit, 0)::numeric, 3)));
    else
      hours := hours || jsonb_build_array(null);
    end if;
  end loop;
  select coalesce(jsonb_object_agg(bucket, case when users >= {MIN_USERS}
           then jsonb_build_object('users', users, 'avgKeptDays', round(kept::numeric, 1)) end), '{{}}'::jsonb)
    into goals
    from (
      select bucket, count(*) as users, avg(kept_days) as kept
        from (
          select install_id,
                 case when max(goal_minutes) <= 30 then '≤30' when max(goal_minutes) <= 45 then '31-45'
                      when max(goal_minutes) <= 60 then '46-60' else '61+' end as bucket,
                 sum(kept::int) as kept_days
            from public.sai_daily
           where day >= current_date - 7 and day < current_date
           group by install_id
        ) per_install
       group by bucket
    ) per_bucket;
  return jsonb_build_object('demo', false, 'minUsers', {MIN_USERS}, 'days', 14, 'byHour', hours, 'byGoal', goals);
end;
$$;

-- 처음 설치할 때: 평소 하루 사용(분)과 주로 보는 시간대로 가장 비슷한 유형과 그 시작값.
create or replace function public.sai_onboarding(p_daily_minutes integer, p_slot text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cluster', id, 'name', name, 'suggestedGoal', suggested_goal, 'model', model)
    from public.sai_clusters
   order by power((p_daily_minutes - (centroid->>'minutes')::double precision) / 60.0, 2)
          + power(1 - coalesce((centroid->>p_slot)::double precision, 0), 2)
   limit 1
$$;

revoke all on function public.sai_schema_version(), public.sai_delete_own(), public.sai_compare(boolean),
  public.sai_onboarding(integer, text) from public;
grant execute on function public.sai_schema_version(), public.sai_delete_own(), public.sai_compare(boolean),
  public.sai_onboarding(integer, text) to anon, authenticated, service_role;

-- 시연 데이터와 유형 (가상 사용자 200명 × 12주로 계산)
insert into public.sai_compare_demo (key, value) values ('v1', {literal(demo)})
  on conflict (key) do update set value = excluded.value;

insert into public.sai_clusters (id, name, suggested_goal, centroid, model) values
{seed_clusters}
  on conflict (id) do update set name = excluded.name, suggested_goal = excluded.suggested_goal,
    centroid = excluded.centroid, model = excluded.model;

commit;
"""


if __name__ == "__main__":
    main()
