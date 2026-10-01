#!/usr/bin/env python3
"""Exercise cleanup.sql ONLY in a disposable local PostgreSQL cluster.

Uses an explicitly created private Unix socket, with TCP disabled. Never reads
DATABASE_URL, credentials, or project databases. Requires installed PostgreSQL
tools; no dependencies are installed.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "docs/operations/registration-cleanup/cleanup.sql").read_text()
TABLES = [
    "activity_choice_groups", "activity_choice_options", "activity_choice_selections",
    "announcements", "app_settings", "attendees", "payment_submissions",
    "poll_options", "poll_votes", "polls", "registration_fees", "registrations",
    "reunion_branches", "reunion_fees", "reunion_images", "reunion_organizers",
    "reunions", "schedule_items", "sponsorship_allocations",
    "sponsorship_contributions", "users", "vendor_contracts", "vendors",
]
MUTABLE = [
    "registrations", "attendees", "registration_fees", "payment_submissions",
    "sponsorship_contributions", "sponsorship_allocations",
]
REGISTRATIONS = [1, 7, 8, 9, 10, *range(12, 28)]
ATTENDEES = [1, *range(12, 26), *range(31, 65)]
CONTRIBUTIONS = [1, 3, 8, 10, 12, 13, 14, 15]
FK_QUERY = """
SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
  'child', c.conrelid::regclass::text, 'name', c.conname,
  'definition',pg_get_constraintdef(c.oid))
  ORDER BY c.conrelid::regclass::text,c.conname),'[]'::jsonb)::text)
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE c.contype='f' AND n.nspname='public'
"""


def main():
    tools = {name: shutil.which(name) for name in ("initdb", "pg_ctl", "psql")}
    if not all(tools.values()):
        raise SystemExit("Requires local initdb, pg_ctl and psql. No DB accessed.")
    # No inherited PG* variables or secrets. HOME is also isolated below.
    env = {"PATH": os.environ["PATH"], "LANG": "C.UTF-8"}
    with tempfile.TemporaryDirectory(prefix="registration-cleanup-test-") as work:
        base = Path(work)
        data, sock = base / "data", base / "socket"
        sock.mkdir(mode=0o700)
        env["HOME"] = work
        subprocess.run([tools["initdb"], "-D", str(data), "-A", "trust", "-U", "fixture"],
                       env=env, capture_output=True, text=True, check=True)
        subprocess.run([
            tools["pg_ctl"], "-D", str(data), "-l", str(base / "postgres.log"),
            "-o", f"-F -k {sock} -p 55439 -c listen_addresses='' -c timezone=GMT",
            "-w", "start",
        ], env=env, capture_output=True, text=True, check=True)
        try:
            def sql(query, expected_ok=True):
                result = subprocess.run([
                    tools["psql"], "-X", "-h", str(sock), "-p", "55439", "-U",
                    "fixture", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
                ], input=query, env=env, capture_output=True, text=True)
                if expected_ok and result.returncode:
                    raise AssertionError(result.stderr)
                if not expected_ok and not result.returncode:
                    raise AssertionError("Expected guarded failure, but SQL succeeded")
                return result

            def fixture():
                # Destruction is confined to the brand-new socket-only fixture.
                sql("""
                    DROP SCHEMA public CASCADE; CREATE SCHEMA public;
                    CREATE TABLE public.reunions (id integer PRIMARY KEY, code text);
                    CREATE TABLE public.registrations (
                      id integer PRIMARY KEY,
                      reunion_id integer REFERENCES public.reunions(id),
                      status text, payment_status text, created_at timestamptz);
                    CREATE TABLE public.attendees (
                      id integer PRIMARY KEY, registration_id integer NOT NULL, name text);
                    CREATE TABLE public.sponsorship_contributions (
                      id integer PRIMARY KEY, reunion_id integer REFERENCES public.reunions(id),
                      registration_id integer REFERENCES public.registrations(id) ON DELETE SET NULL,
                      source text, amount integer, payment_status text);
                    CREATE TABLE public.sponsorship_allocations (
                      id integer PRIMARY KEY, reunion_id integer,
                      registration_id integer REFERENCES public.registrations(id) ON DELETE CASCADE,
                      funded_from text, amount integer);
                    CREATE TABLE public.registration_fees (
                      id integer PRIMARY KEY,
                      registration_id integer REFERENCES public.registrations(id) ON DELETE CASCADE);
                    CREATE TABLE public.payment_submissions (
                      id integer PRIMARY KEY, reunion_id integer,
                      registration_id integer REFERENCES public.registrations(id) ON DELETE CASCADE,
                      registration_ids integer[], contribution_ids integer[], amount integer);
                    INSERT INTO public.reunions VALUES (1, 'LACEY27FR*');
                """)
                for table in TABLES:
                    if table not in MUTABLE and table != "reunions":
                        sql(f"CREATE TABLE public.{table} (id integer PRIMARY KEY, value text);"
                            f"INSERT INTO public.{table} VALUES (1, 'preserve exactly');")
                sql("INSERT INTO registrations VALUES " + ",".join(
                    f"({i},1,'cancelled','paid','2026-09-01T00:00:00Z')"
                    for i in REGISTRATIONS) + ";")
                sql("INSERT INTO attendees VALUES " + ",".join(
                    f"({i},{REGISTRATIONS[n % len(REGISTRATIONS)]},'Fixture attendee')"
                    for n, i in enumerate(ATTENDEES)) + ";")
                sql("INSERT INTO sponsorship_contributions VALUES " + ",".join(
                    f"({i},1,{REGISTRATIONS[i] if i in CONTRIBUTIONS else 'NULL'},"
                    f"'{'registration' if i in CONTRIBUTIONS or i == 2 else 'direct'}',"
                    "10,'paid')" for i in range(1, 16)) + ";")
                hashes = {}
                for table in MUTABLE:
                    hashes[table] = sql(
                        "SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),"
                        f"'[]'::jsonb)::text) FROM public.{table} t").stdout.strip()
                # Fixture hashes only; never weaken or change the shipped file.
                statement = re.sub(
                    r"(expected_fingerprints constant jsonb := )'.*?';",
                    lambda match: match[1] + "'" + json.dumps(hashes) + "';",
                    SOURCE, count=1, flags=re.S)
                fk = sql(FK_QUERY).stdout.strip()
                statement = re.sub(r"(expected_fk constant text := )'[^']+';",
                                   lambda match: match[1] + f"'{fk}';", statement, count=1)
                return statement

            def snapshot():
                return {
                    table: sql("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),"
                               f"'[]'::jsonb)::text FROM public.{table} t").stdout.strip()
                    for table in TABLES
                }

            def apply(statement):
                return statement.replace("dry_run boolean := true;", "dry_run boolean := false;") \
                    .replace("backup_verified boolean := false;", "backup_verified boolean := true;") \
                    .replace("approval text := '';",
                             "approval text := 'REMOVE 21 TEST REGISTRATIONS, "
                             "49 ATTENDEES, AND 8 LINKED CONTRIBUTIONS';")

            statement = fixture()
            original = snapshot()
            result = sql(statement)
            assert "REHEARSAL PASSED" in result.stderr
            assert snapshot() == original
            print("PASS: default rehearsal rolls back every proposed deletion")

            sql(statement.replace("dry_run boolean := true;", "dry_run boolean := false;"),
                expected_ok=False)
            assert snapshot() == original
            print("PASS: apply requires backup confirmation and exact approval")

            result = sql(apply(statement))
            assert "APPLY PASSED" in result.stderr
            after = snapshot()
            for table in TABLES:
                if table not in MUTABLE:
                    assert after[table] == original[table], table
            for table in MUTABLE:
                if table != "sponsorship_contributions":
                    assert after[table] == "[]", table
            expected_kept = [row for row in json.loads(original["sponsorship_contributions"])
                             if row["id"] not in CONTRIBUTIONS]
            assert json.loads(after["sponsorship_contributions"]) == expected_kept
            sql(apply(statement), expected_ok=False)
            assert snapshot() == after
            print("PASS: apply deletes exact scope, preserves other full rows, and refuses replay")

            # All blocked cases must leave ALL fixture data exactly unchanged.
            cases = [
                ("new active registration",
                 "INSERT INTO registrations VALUES (100,1,'active','pending',now());"),
                ("edited existing registration",
                 "UPDATE registrations SET payment_status='pending' WHERE id=1;"),
                ("new attendee",
                 "INSERT INTO attendees VALUES (100,1,'New fixture');"),
                ("orphan attendee",
                 "UPDATE attendees SET registration_id=999 WHERE id=1;"),
                ("new unlinked contribution",
                 "INSERT INTO sponsorship_contributions VALUES (100,1,NULL,'direct',50,'paid');"),
                ("mixed payment",
                 "INSERT INTO payment_submissions VALUES (1,1,1,ARRAY[1],ARRAY[2],50);"),
                ("new allocation",
                 "INSERT INTO sponsorship_allocations VALUES (1,1,1,'fund',5);"),
                ("changed FK",
                 "ALTER TABLE attendees ADD FOREIGN KEY(registration_id) REFERENCES registrations(id);"),
                ("new table",
                 "CREATE TABLE new_dependent_table (id integer);"),
                ("unreviewed trigger",
                 """CREATE FUNCTION public.noop() RETURNS trigger LANGUAGE plpgsql
                    AS $$ BEGIN RETURN OLD; END $$;
                    CREATE TRIGGER unexpected BEFORE DELETE ON registrations
                    FOR EACH ROW EXECUTE FUNCTION public.noop();"""),
                ("cross-schema cascade",
                 """CREATE SCHEMA extra;
                    CREATE TABLE extra.linked (id integer,
                      registration_id integer REFERENCES registrations(id) ON DELETE CASCADE);"""),
            ]
            for label, mutation in cases:
                statement = fixture()
                sql(mutation)
                before = snapshot()
                sql(apply(statement), expected_ok=False)
                assert snapshot() == before, label
                print(f"PASS: refuses {label}, with no cleanup changes")

            # Inject a late invariant failure in-memory to prove all deletes undo,
            # not just that preflight checks happen before changes.
            statement = fixture()
            before = snapshot()
            failing = apply(statement).replace("IF affected<>21", "IF affected<>999")
            sql(failing, expected_ok=False)
            assert snapshot() == before
            print("PASS: failure after all deletes rolls back the complete operation")
            print("All 15 cleanup safety scenarios passed. No project database accessed.")
        finally:
            subprocess.run([tools["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "stop"],
                           env=env, capture_output=True, text=True, check=True)


if __name__ == "__main__":
    main()