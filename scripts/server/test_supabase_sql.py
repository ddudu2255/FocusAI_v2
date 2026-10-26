"""
supabase/shortsai_v1.sql을 팀원 DB에 넣기 전에 이 PC의 진짜 PostgreSQL로 시험한다.

1. Supabase가 가진 역할(anon, authenticated, service_role)과 요청 헤더 설정을 흉내 낸다.
2. 팀원 원래 표 구조(팀원 저장소 focusai 브랜치의 supabase/schema.sql)를 만든다.
3. shortsai_v1.sql을 두 번 실행한다 (여러 번 실행해도 되는지).
4. anon으로 자기 줄 넣기, 남의 줄 넣기(거절), 읽기(거절), 비교·유형 함수, 지우기를 확인한다.
5. 되돌리기 SQL을 실행하고, 팀원 표와 기록이 그대로인지 확인한다.

6. (선택) 앱이 실제로 만드는 기록 묶음(scripts/server/emit-sample-uploads.ts의 출력)을
   PostgREST처럼 JSON 그대로 anon으로 넣어 본다. 칸 이름·날짜·숫자 형식이 맞는지 확인.

실행: python scripts/server/test_supabase_sql.py <팀원 schema.sql 경로> [uploads.json]
필요: pip install pgserver psycopg2-binary
"""

from __future__ import annotations

import json
import sys
import tempfile
import uuid
from pathlib import Path

import pgserver
import psycopg2

ROOT = Path(__file__).resolve().parents[2]
SUPABASE_ROLES = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
"""


def as_anon(cur, install: str) -> None:
    """PostgREST가 공개 키 요청을 처리하는 방식: anon 역할 + 요청 헤더 JSON."""
    cur.execute("reset role")
    cur.execute("select set_config('request.headers', %s, false)", (json.dumps({"x-install-id": install}),))
    cur.execute("set role anon")


def expect_error(cur, sql: str, args=()) -> str:
    try:
        cur.execute(sql, args)
    except psycopg2.Error as e:  # autocommit이라 실패한 문장만 취소된다
        return e.pgerror.splitlines()[0] if e.pgerror else str(e)
    raise AssertionError(f"오류가 나야 하는데 성공함: {sql}")


def insert_uploads(cur, uploads: list[dict]) -> None:
    """PostgREST가 POST 본문(JSON 배열)을 표에 넣는 방식과 같게 json_populate_recordset으로 넣는다."""
    install = uploads[0]["row"]["install_id"]
    as_anon(cur, install)
    for table in dict.fromkeys(u["table"] for u in uploads):
        rows = [u["row"] for u in uploads if u["table"] == table]
        cols = list(rows[0].keys())
        names = ", ".join(cols)
        cur.execute(
            f"insert into public.{table} ({names}) select {names} from json_populate_recordset(null::public.{table}, %s)",
            (json.dumps(rows),),
        )
        print(f"  앱 기록 넣기 OK: {table} {len(rows)}줄")
    cur.execute("reset role")
    cur.execute("select features, keeping, label from public.sai_opens")
    print("  저장된 열기:", cur.fetchone())


def main(teammate_schema: Path, uploads_path: Path | None = None) -> None:
    ours = (ROOT / "supabase" / "shortsai_v1.sql").read_text(encoding="utf-8")
    rollback = (ROOT / "supabase" / "shortsai_v1_rollback.sql").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        server = pgserver.get_server(tmp, cleanup_mode="stop")
        conn = psycopg2.connect(server.get_uri())
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(SUPABASE_ROLES)
        cur.execute(teammate_schema.read_text(encoding="utf-8"))
        print("팀원 원래 표 만듦")

        me, other = str(uuid.uuid4()), str(uuid.uuid4())
        # 팀원 표에 기존 기록이 있는 상태를 흉내 낸다
        as_anon(cur, me)
        cur.execute("insert into public.sessions values (%s, %s, 'youtube', 'native', now(), now(), 60, 1)",
                    (str(uuid.uuid4()), me))
        cur.execute("reset role")

        cur.execute(ours)
        cur.execute(ours)
        print("우리 SQL 두 번 실행 OK")

        as_anon(cur, me)
        cur.execute("select public.sai_schema_version()")
        assert cur.fetchone()[0] == 1
        open_id = str(uuid.uuid4())
        cur.execute(
            "insert into public.sai_opens values (%s, %s, now(), 'youtube', %s, 0.12, 'medium', 'full', false, true, 900, 'lr-1')",
            (open_id, me, json.dumps([22, 0, 0.5, 3, 2, 0.2, 10000, 0.3, 0.75, 0])))
        cur.execute("insert into public.sai_session_links values (%s, %s, %s, 'youtube')", (str(uuid.uuid4()), me, open_id))
        ev = str(uuid.uuid4())
        cur.execute("insert into public.interventions (event_id, install_id, created_at, weekday, intensity, stage, method, commit_minutes, outcome) values (%s, %s, now(), 1, 2, 'entry', 'pause', 3, 'watch')", (ev, me))
        cur.execute("insert into public.sai_intervention_details values (%s, %s, 23, 'youtube', 0, 'medium', 'full', %s)", (ev, me, open_id))
        cur.execute("insert into public.sai_daily values (%s, current_date - 1, 40, 1800, true)", (me,))
        print("자기 줄 넣기 OK")

        print("  남의 설치 번호로 넣기:", expect_error(cur, "insert into public.sai_daily values (%s, current_date - 2, 40, 1, true)", (other,)))
        print("  읽기:", expect_error(cur, "select * from public.sai_opens"))
        print("  시연 표 읽기:", expect_error(cur, "select * from public.sai_compare_demo"))
        print("  표 만들기:", expect_error(cur, "create table public.sai_x (a int)"))

        cur.execute("select public.sai_compare(true)")
        demo = cur.fetchone()[0]
        assert demo["demo"] is True and len(demo["byHour"]) == 24
        cur.execute("select public.sai_compare(false)")
        real = cur.fetchone()[0]
        assert real["demo"] is False and real["byHour"] == [None] * 24, real
        print("비교 함수 OK (시연: 23시", demo["byHour"][23], "/ 실제: 사용자 20명 미만이라 비어 있음)")

        cur.execute("select public.sai_onboarding(150, 'night')")
        print("유형 찾기 OK:", {k: v for k, v in cur.fetchone()[0].items() if k != "model"})

        if uploads_path:
            insert_uploads(cur, json.loads(uploads_path.read_text(encoding="utf-8")))
            as_anon(cur, me)

        cur.execute("select public.sai_delete_own()")
        cur.execute("reset role")
        for table in ("sai_opens", "sai_session_links", "sai_intervention_details", "sai_daily", "sessions", "interventions"):
            cur.execute(f"select count(*) from public.{table} where install_id = %s", (me,))
            assert cur.fetchone()[0] == 0, table
        print("지우기 OK (우리 표와 팀원 표 모두)")

        # 되돌리기 전 팀원 표에 다른 사람 기록을 하나 둔다
        as_anon(cur, other)
        cur.execute("insert into public.sessions values (%s, %s, 'youtube', 'native', now(), now(), 30, 1)", (str(uuid.uuid4()), other))
        cur.execute("reset role")
        cur.execute(rollback)
        cur.execute("select count(*) from information_schema.tables where table_name like 'sai\\_%'")
        assert cur.fetchone()[0] == 0
        cur.execute("select count(*) from public.sessions where install_id = %s", (other,))
        assert cur.fetchone()[0] == 1
        cur.execute("select public.usage_install_id() is null")
        print("되돌리기 OK: sai_ 표·함수만 지워지고 팀원 표·기록·함수는 그대로")
        conn.close()
        server.cleanup()


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
