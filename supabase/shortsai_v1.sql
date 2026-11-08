-- ShortsAI 추가 표·함수 (v1). scripts/server/make_supabase_sql.py가 만든 파일이다.
--
-- 팀원 기존 표(sessions, interventions, lock_attempts)와 함수(usage_install_id, delete_own_usage)는
-- 바꾸지 않고 그대로 쓴다. 이 파일이 만드는 것은 모두 sai_ 로 시작한다.
-- 여러 번 실행해도 된다 (if not exists / create or replace).
-- 되돌리기: shortsai_v1_rollback.sql
--
-- 권한은 팀원 설계와 같다: 공개(anon) 키는 자기 설치 번호(x-install-id 헤더)로 넣기만 할 수 있고 읽을 수 없다.
-- 비교 통계·유형 찾기는 계산 결과만 돌려주는 함수로만 열어 둔다. 한 칸 사용자가 20명 미만이면 비운다.

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
  goals jsonb := '{}'::jsonb;
  h integer;
  row_users integer;
  row_opens integer;
  row_short double precision;
  row_exit double precision;
begin
  if p_demo then
    return (select value from public.sai_compare_demo where key = 'v1') || '{"demo": true}'::jsonb;
  end if;
  for h in 0..23 loop
    select count(distinct i.install_id), count(*),
           avg(case when i.commit_minutes > 0 then (i.commit_minutes = 3)::int end),
           avg((i.outcome = 'exit')::int)
      into row_users, row_opens, row_short, row_exit
      from public.interventions i
      join public.sai_intervention_details d on d.event_id = i.event_id
     where i.stage = 'entry' and d.hour = h and i.created_at > now() - interval '14 days';
    if row_users >= 20 then
      hours := hours || jsonb_build_array(jsonb_build_object(
        'users', row_users, 'opens', row_opens,
        'shortRate', round(coalesce(row_short, 0)::numeric, 3), 'exitRate', round(coalesce(row_exit, 0)::numeric, 3)));
    else
      hours := hours || jsonb_build_array(null);
    end if;
  end loop;
  select coalesce(jsonb_object_agg(bucket, case when users >= 20
           then jsonb_build_object('users', users, 'avgKeptDays', round(kept::numeric, 1)) end), '{}'::jsonb)
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
  return jsonb_build_object('demo', false, 'minUsers', 20, 'days', 14, 'byHour', hours, 'byGoal', goals);
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
insert into public.sai_compare_demo (key, value) values ('v1', '{"byHour": [{"users": 196, "opens": 2845, "shortRate": 0.597, "exitRate": 0.5}, {"users": 197, "opens": 2316, "shortRate": 0.625, "exitRate": 0.5}, {"users": 154, "opens": 1290, "shortRate": 0.632, "exitRate": 0.5}, {"users": 117, "opens": 638, "shortRate": 0.65, "exitRate": 0.5}, {"users": 66, "opens": 121, "shortRate": 0.694, "exitRate": 0.5}, {"users": 58, "opens": 82, "shortRate": 0.549, "exitRate": 0.5}, {"users": 112, "opens": 529, "shortRate": 0.639, "exitRate": 0.6}, {"users": 144, "opens": 1185, "shortRate": 0.694, "exitRate": 0.6}, {"users": 191, "opens": 1549, "shortRate": 0.7, "exitRate": 0.6}, {"users": 190, "opens": 1650, "shortRate": 0.704, "exitRate": 0.6}, {"users": 191, "opens": 1428, "shortRate": 0.686, "exitRate": 0.6}, {"users": 196, "opens": 1970, "shortRate": 0.66, "exitRate": 0.6}, {"users": 194, "opens": 2073, "shortRate": 0.669, "exitRate": 0.6}, {"users": 198, "opens": 2072, "shortRate": 0.653, "exitRate": 0.6}, {"users": 197, "opens": 1738, "shortRate": 0.624, "exitRate": 0.6}, {"users": 193, "opens": 1695, "shortRate": 0.585, "exitRate": 0.6}, {"users": 194, "opens": 1732, "shortRate": 0.568, "exitRate": 0.6}, {"users": 196, "opens": 2420, "shortRate": 0.576, "exitRate": 0.6}, {"users": 195, "opens": 2745, "shortRate": 0.56, "exitRate": 0.6}, {"users": 199, "opens": 3200, "shortRate": 0.553, "exitRate": 0.6}, {"users": 199, "opens": 3260, "shortRate": 0.554, "exitRate": 0.6}, {"users": 200, "opens": 3635, "shortRate": 0.521, "exitRate": 0.5}, {"users": 200, "opens": 3473, "shortRate": 0.534, "exitRate": 0.5}, {"users": 198, "opens": 3140, "shortRate": 0.513, "exitRate": 0.5}], "byGoal": {"≤30": {"users": 35, "avgKeptDays": 3.8}, "31-45": {"users": 104, "avgKeptDays": 4.2}, "46-60": {"users": 45, "avgKeptDays": 4.6}, "61+": {"users": 20, "avgKeptDays": 5.0}}, "minUsers": 20, "days": 14}'::jsonb)
  on conflict (key) do update set value = excluded.value;

insert into public.sai_clusters (id, name, suggested_goal, centroid, model) values
  ('A_night', '밤에 몰아 보는 편', 45, '{"minutes": 110.2, "morning": 0.053, "day": 0.082, "evening": 0.185, "night": 0.681}'::jsonb, '{"version": "lr-2", "weights": [0.144696, 0.57821, 0.10949, 0.516144, -0.285262, -0.459602, 0.135586, -0.089365, 0.06752, -0.23832, -0.080139, -0.142032, 0.057098, -0.014053, -0.036498], "bias": -2.158132}'::jsonb),
  ('B_habit', '짧게 자주 여는 편', 45, '{"minutes": 124.6, "morning": 0.164, "day": 0.3, "evening": 0.304, "night": 0.231}'::jsonb, '{"version": "lr-2", "weights": [0.124552, -0.060649, 0.089669, 0.895264, -0.348739, -0.402854, 0.163887, 0.029394, 0.268871, -0.196985, -0.048901, -0.131291, 0.055719, -0.026064, -0.022678], "bias": -2.389225}'::jsonb),
  ('C_stress', '기분에 따라 길어지는 편', 60, '{"minutes": 152.9, "morning": 0.071, "day": 0.167, "evening": 0.482, "night": 0.28}'::jsonb, '{"version": "lr-2", "weights": [-0.079644, -0.123781, 0.031589, 1.102552, -0.364763, -0.397313, 0.196006, 0.033236, 0.110329, -0.12773, -0.082332, -0.142164, 0.12385, -0.027538, -0.023915], "bias": -2.279753}'::jsonb),
  ('D_weekend', '주말에 길어지는 편', 40, '{"minutes": 95.4, "morning": 0.058, "day": 0.365, "evening": 0.446, "night": 0.131}'::jsonb, '{"version": "lr-2", "weights": [-0.391279, -0.364241, 0.569413, 0.534539, -0.093288, -0.418474, 0.154069, 0.005772, 0.179894, -0.171424, -0.033014, -0.148762, 0.031227, -0.052932, -0.00843], "bias": -2.043135}'::jsonb),
  ('E_trying', '줄이려고 애쓰는 편', 25, '{"minutes": 49.8, "morning": 0.163, "day": 0.234, "evening": 0.391, "night": 0.212}'::jsonb, '{"version": "lr-2", "weights": [0.055962, -0.016649, 0.027347, 0.435479, -0.136367, -0.227632, 0.149598, 0.021433, 0.291507, -0.026891, -0.045105, -0.123674, 0.080026, 0.004292, -0.038743], "bias": -1.992964}'::jsonb),
  ('F_rebound', '쉬고 나면 몰아 보는 편', 40, '{"minutes": 90.0, "morning": 0.062, "day": 0.119, "evening": 0.452, "night": 0.367}'::jsonb, '{"version": "lr-2", "weights": [-0.188575, 0.16865, 0.064548, 0.480803, -0.127804, -0.275392, 0.129777, -0.32924, 0.208812, -0.1611, -0.096722, -0.20922, 0.021858, -0.056106, 0.008104], "bias": -2.222349}'::jsonb)
  on conflict (id) do update set name = excluded.name, suggested_goal = excluded.suggested_goal,
    centroid = excluded.centroid, model = excluded.model;

commit;
