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
insert into public.sai_compare_demo (key, value) values ('v1', '{"byHour": [{"users": 196, "opens": 2845, "shortRate": 0.597, "exitRate": 0.07}, {"users": 197, "opens": 2316, "shortRate": 0.625, "exitRate": 0.07}, {"users": 154, "opens": 1290, "shortRate": 0.632, "exitRate": 0.081}, {"users": 117, "opens": 638, "shortRate": 0.65, "exitRate": 0.086}, {"users": 66, "opens": 121, "shortRate": 0.694, "exitRate": 0.091}, {"users": 58, "opens": 82, "shortRate": 0.549, "exitRate": 0.037}, {"users": 112, "opens": 529, "shortRate": 0.639, "exitRate": 0.095}, {"users": 144, "opens": 1185, "shortRate": 0.694, "exitRate": 0.116}, {"users": 191, "opens": 1549, "shortRate": 0.7, "exitRate": 0.11}, {"users": 190, "opens": 1650, "shortRate": 0.704, "exitRate": 0.088}, {"users": 191, "opens": 1428, "shortRate": 0.686, "exitRate": 0.101}, {"users": 196, "opens": 1970, "shortRate": 0.66, "exitRate": 0.109}, {"users": 194, "opens": 2073, "shortRate": 0.669, "exitRate": 0.104}, {"users": 198, "opens": 2072, "shortRate": 0.653, "exitRate": 0.084}, {"users": 197, "opens": 1738, "shortRate": 0.624, "exitRate": 0.091}, {"users": 193, "opens": 1695, "shortRate": 0.585, "exitRate": 0.076}, {"users": 194, "opens": 1732, "shortRate": 0.568, "exitRate": 0.074}, {"users": 196, "opens": 2420, "shortRate": 0.576, "exitRate": 0.079}, {"users": 195, "opens": 2745, "shortRate": 0.56, "exitRate": 0.069}, {"users": 199, "opens": 3200, "shortRate": 0.553, "exitRate": 0.056}, {"users": 199, "opens": 3260, "shortRate": 0.554, "exitRate": 0.059}, {"users": 200, "opens": 3635, "shortRate": 0.521, "exitRate": 0.053}, {"users": 200, "opens": 3473, "shortRate": 0.534, "exitRate": 0.053}, {"users": 198, "opens": 3140, "shortRate": 0.513, "exitRate": 0.059}], "byGoal": {"≤30": {"users": 35, "avgKeptDays": 1.2}, "31-45": {"users": 104, "avgKeptDays": 1.4}, "46-60": {"users": 45, "avgKeptDays": 1.6}, "61+": null}, "minUsers": 20, "days": 14}'::jsonb)
  on conflict (key) do update set value = excluded.value;

insert into public.sai_clusters (id, name, suggested_goal, centroid, model) values
  ('A_night', '밤에 몰아 보는 편', 45, '{"minutes": 99.4, "morning": 0.056, "day": 0.082, "evening": 0.208, "night": 0.654}'::jsonb, '{"version": "lr-1", "weights": [0.18264, 0.453168, 0.066429, 0.545075, -0.134768, -0.363363, 0.121526, -0.071673, 0.19632, -0.224996, -0.158127, -0.367018, 0.068266, -0.061702, -0.044648], "bias": -2.96527}'::jsonb),
  ('B_habit', '짧게 자주 여는 편', 40, '{"minutes": 97.8, "morning": 0.185, "day": 0.301, "evening": 0.292, "night": 0.222}'::jsonb, '{"version": "lr-1", "weights": [-0.021088, 0.014572, 0.130063, 0.595853, -0.004055, -0.340397, 0.065773, -0.024412, 0.136589, -0.19, -0.116416, -0.341218, 0.082327, -0.043157, -0.038797], "bias": -3.75986}'::jsonb),
  ('C_stress', '기분에 따라 길어지는 편', 60, '{"minutes": 136.1, "morning": 0.078, "day": 0.176, "evening": 0.485, "night": 0.261}'::jsonb, '{"version": "lr-1", "weights": [0.048611, -0.156924, -0.000204, 1.029562, -0.343289, -0.362747, 0.121974, -0.059199, 0.017339, -0.005359, -0.129075, -0.363077, 0.147845, -0.042892, -0.059006], "bias": -3.058383}'::jsonb),
  ('D_weekend', '주말에 길어지는 편', 40, '{"minutes": 90.7, "morning": 0.062, "day": 0.366, "evening": 0.439, "night": 0.133}'::jsonb, '{"version": "lr-1", "weights": [-0.269186, -0.312891, 0.603439, 0.611993, -0.045561, -0.395031, 0.106525, -0.043843, 0.121904, -0.129032, -0.105186, -0.347688, 0.093082, -0.033035, -0.04121], "bias": -3.439033}'::jsonb),
  ('E_trying', '줄이려고 애쓰는 편', 30, '{"minutes": 43.0, "morning": 0.154, "day": 0.236, "evening": 0.376, "night": 0.234}'::jsonb, '{"version": "lr-1", "weights": [-0.027554, 0.072419, 0.186369, 0.67641, -0.149895, -0.279628, 0.010906, -0.057701, 0.247034, -0.131409, -0.15721, -0.405439, 0.032551, -0.049258, -0.08468], "bias": -2.966753}'::jsonb),
  ('F_rebound', '쉬고 나면 몰아 보는 편', 40, '{"minutes": 80.0, "morning": 0.067, "day": 0.121, "evening": 0.442, "night": 0.369}'::jsonb, '{"version": "lr-1", "weights": [0.048608, 0.07629, 0.063835, 0.434625, 0.063684, -0.338332, 0.094927, -0.462751, 0.191277, -0.199702, -0.134205, -0.339224, 0.051016, -0.039088, -0.032574], "bias": -3.221156}'::jsonb)
  on conflict (id) do update set name = excluded.name, suggested_goal = excluded.suggested_goal,
    centroid = excluded.centroid, model = excluded.model;

commit;
