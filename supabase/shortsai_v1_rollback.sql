-- ShortsAI 추가 표·함수(v1) 되돌리기. shortsai_v1.sql이 만든 sai_ 표·함수만 지운다.
-- 팀원 기존 표(sessions, interventions, lock_attempts)와 함수(usage_install_id, delete_own_usage)와
-- 그 안의 기록은 건드리지 않는다. sai_ 표에 쌓인 기록은 지워진다.

begin;

drop function if exists public.sai_onboarding(integer, text);
drop function if exists public.sai_compare(boolean);
drop function if exists public.sai_delete_own();
drop function if exists public.sai_schema_version();

drop table if exists public.sai_clusters;
drop table if exists public.sai_compare_demo;
drop table if exists public.sai_daily;
drop table if exists public.sai_intervention_details;
drop table if exists public.sai_opens;
drop table if exists public.sai_session_links;

commit;
