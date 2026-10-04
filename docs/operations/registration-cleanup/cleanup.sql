-- ONE-TIME REVIEWED DATA CLEANUP. Not a migration; never run at startup/publish.
-- Read README.md first. This single DO statement is atomic in PostgreSQL.
-- Defaults to a rollback-only rehearsal. Does not reset sequences or delete users.
-- Only a human operator should run this in the PRODUCTION Database SQL runner.
DO $cleanup$
DECLARE
  dry_run boolean := true;
  backup_verified boolean := false;
  approval text := '';
  -- APPLY requires dry_run=false, backup_verified=true and the exact approval:
  -- REMOVE 21 TEST REGISTRATIONS, 49 ATTENDEES, 15 CONTRIBUTIONS, AND 5 POLL VOTES
  registration_ids constant integer[] := ARRAY[1,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27];
  attendee_ids constant integer[] := ARRAY[1,12,13,14,15,16,17,18,19,20,21,22,23,24,25,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64];
  contribution_ids constant integer[] := ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  vote_ids constant integer[] := ARRAY[12,13,14,15,16];
  expected_tables constant text[] := ARRAY[
    'activity_choice_groups','activity_choice_options','activity_choice_selections',
    'announcements','app_settings','attendees','payment_submissions','poll_options',
    'poll_votes','polls','registration_fees','registrations','reunion_branches',
    'reunion_fees','reunion_images','reunion_organizers','reunions','schedule_items',
    'sponsorship_allocations','sponsorship_contributions','users','vendor_contracts','vendors'
  ];
  -- Opaque fingerprints of the reviewed full rows; no personal data in this file.
  expected_fingerprints constant jsonb := '{
    "attendees":"96c084879d91a60456292c293fad8cc6",
    "registrations":"37f8a4f39652bc1521e03f74caab6d23",
    "registration_fees":"d751713988987e9331980363e24189ce",
    "payment_submissions":"d751713988987e9331980363e24189ce",
    "sponsorship_allocations":"d751713988987e9331980363e24189ce",
    "sponsorship_contributions":"31c7791e30b15c8c66c0868e6f99d538",
    "poll_votes":"f5e76ef53633d80f9be38bb24beefaf2"
  }';
  expected_fk constant text := '139248782ef685f66e170efe5f58461f';
  actual_tables text[];
  table_name text;
  fingerprint text;
  kept_before jsonb := '{}'::jsonb;
  affected integer;
BEGIN
  PERFORM set_config('TimeZone', 'GMT', true);
  PERFORM set_config('search_path', 'public, pg_catalog', true);
  PERFORM set_config('lock_timeout', '5s', true);
  -- Fail rather than silently process only rows visible through row-level security.
  PERFORM set_config('row_security', 'off', true);

  IF NOT dry_run AND (NOT backup_verified OR approval IS DISTINCT FROM
    'REMOVE 21 TEST REGISTRATIONS, 49 ATTENDEES, 15 CONTRIBUTIONS, AND 5 POLL VOTES') THEN
    RAISE EXCEPTION 'Apply blocked: verify a restorable production backup and enter the exact approval phrase.';
  END IF;

  SELECT array_agg(t.table_name::text ORDER BY t.table_name)
    INTO actual_tables FROM information_schema.tables t
    WHERE t.table_schema='public' AND t.table_type='BASE TABLE';
  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'Public table inventory changed or access is incomplete. Stop and request a new review.';
  END IF;

  -- Block all application writes for this short transaction; normal SELECTs still work.
  -- App traffic must already be paused and in-flight writes drained (see README).
  FOREACH table_name IN ARRAY expected_tables LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', table_name);
  END LOOP;

  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'child', c.conrelid::regclass::text, 'name', c.conname,
    'definition', pg_get_constraintdef(c.oid))
    ORDER BY c.conrelid::regclass::text,c.conname),'[]'::jsonb)::text)
    INTO fingerprint FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE c.contype='f' AND n.nspname='public';
  IF fingerprint IS DISTINCT FROM expected_fk THEN
    RAISE EXCEPTION 'Foreign keys changed. Stop and review cascading effects.';
  END IF;
  -- Also guard inbound FKs from other schemas, not just known public relations.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_class child ON child.oid=c.conrelid
    JOIN pg_namespace cn ON cn.oid=child.relnamespace
    WHERE c.contype='f' AND pn.nspname='public' AND cn.nspname<>'public'
      AND parent.relname IN ('registrations','attendees','sponsorship_contributions','poll_votes')
  ) THEN
    RAISE EXCEPTION 'Unreviewed cross-schema dependency. Stop.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname='public'
  ) OR EXISTS (
    SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND r.rulename<>'_RETURN'
  ) THEN
    RAISE EXCEPTION 'Unreviewed trigger/rule exists. Stop; do not disable it.';
  END IF;

  FOR table_name IN SELECT jsonb_object_keys(expected_fingerprints) LOOP
    EXECUTE format(
      'SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), ''[]''::jsonb)::text) FROM public.%I t',
      table_name) INTO fingerprint;
    IF fingerprint IS DISTINCT FROM expected_fingerprints->>table_name THEN
      RAISE EXCEPTION 'Reviewed data changed in %. No records removed; refresh the inventory, not the guard.', table_name;
    END IF;
  END LOOP;
  IF (SELECT array_agg(id ORDER BY id) FROM public.registrations) IS DISTINCT FROM registration_ids
    OR EXISTS (SELECT 1 FROM public.registrations WHERE reunion_id<>1)
    OR NOT EXISTS (SELECT 1 FROM public.reunions WHERE id=1 AND code='LACEY27FR*') THEN
    RAISE EXCEPTION 'Registration manifest/reunion mismatch. Stop.';
  END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.attendees
      WHERE registration_id=ANY(registration_ids)) IS DISTINCT FROM attendee_ids
    OR (SELECT array_agg(id ORDER BY id) FROM public.sponsorship_contributions) IS DISTINCT FROM contribution_ids
    OR (SELECT array_agg(id ORDER BY id) FROM public.poll_votes) IS DISTINCT FROM vote_ids THEN
    RAISE EXCEPTION 'Dependent record manifest mismatch. Stop.';
  END IF;
  -- These were empty at review. Any new payment, array reference, selected fee,
  -- or allocation requires a fresh review, not an automatic cascade.
  IF EXISTS (SELECT 1 FROM public.payment_submissions)
    OR EXISTS (SELECT 1 FROM public.registration_fees)
    OR EXISTS (SELECT 1 FROM public.sponsorship_allocations) THEN
    RAISE EXCEPTION 'New payment/fee/allocation records need review. Stop.';
  END IF;

  -- Snapshot every preserved table inside the locked transaction. Hashes only,
  -- never emit/store names, emails, identity credentials, or other personal data.
  FOREACH table_name IN ARRAY expected_tables LOOP
    IF NOT (expected_fingerprints ? table_name) THEN
      EXECUTE format(
        'SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb)::text) FROM public.%I t',
        table_name) INTO fingerprint;
      kept_before := kept_before || jsonb_build_object(table_name, fingerprint);
    END IF;
  END LOOP;

  -- Subtransaction allows the default rehearsal to test actual deletes and
  -- invariants, then undo them without committing any data changes.
  BEGIN
    DELETE FROM public.poll_votes WHERE id=ANY(vote_ids);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>5 THEN RAISE EXCEPTION 'Expected 5 poll votes, got %', affected; END IF;
    DELETE FROM public.sponsorship_contributions
      WHERE id=ANY(contribution_ids);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>15 THEN RAISE EXCEPTION 'Expected 15 contributions, got %', affected; END IF;
    DELETE FROM public.attendees
      WHERE id=ANY(attendee_ids) AND registration_id=ANY(registration_ids);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>49 THEN RAISE EXCEPTION 'Expected 49 attendees, got %', affected; END IF;
    DELETE FROM public.registrations WHERE id=ANY(registration_ids) AND reunion_id=1;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>21 THEN RAISE EXCEPTION 'Expected 21 registrations, got %', affected; END IF;

    IF EXISTS (SELECT 1 FROM public.registrations)
      OR EXISTS (SELECT 1 FROM public.attendees)
      OR EXISTS (SELECT 1 FROM public.registration_fees)
      OR EXISTS (SELECT 1 FROM public.payment_submissions)
      OR EXISTS (SELECT 1 FROM public.sponsorship_allocations)
      OR EXISTS (SELECT 1 FROM public.sponsorship_contributions)
      OR EXISTS (SELECT 1 FROM public.poll_votes) THEN
      RAISE EXCEPTION 'Residual registration data. Rolling back.';
    END IF;
    IF EXISTS (
      SELECT r.id FROM public.reunions r
      WHERE COALESCE((SELECT sum(amount) FROM public.sponsorship_contributions c
                     WHERE c.reunion_id=r.id AND c.payment_status='paid'),0)
          - COALESCE((SELECT sum(amount) FROM public.sponsorship_allocations a
                     WHERE a.reunion_id=r.id AND a.funded_from='fund'),0) < 0
    ) THEN
      RAISE EXCEPTION 'Fund would be overdrawn. Rolling back.';
    END IF;
    FOR table_name IN SELECT jsonb_object_keys(kept_before) LOOP
      EXECUTE format(
        'SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb)::text) FROM public.%I t',
        table_name) INTO fingerprint;
      IF fingerprint IS DISTINCT FROM kept_before->>table_name THEN
        RAISE EXCEPTION 'Preserved table % changed. Rolling back.', table_name;
      END IF;
    END LOOP;
    IF dry_run THEN
      RAISE EXCEPTION USING ERRCODE='Z0001', MESSAGE='Rehearsal passed; intentionally rolling back.';
    END IF;
    RAISE NOTICE 'APPLY PASSED: removed 21 registrations, 49 attendees, 15 contributions, 5 poll votes. All preserved tables unchanged.';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN
    RAISE NOTICE 'REHEARSAL PASSED: all proposed deletes rolled back. Nothing removed.';
  END;
END
$cleanup$;