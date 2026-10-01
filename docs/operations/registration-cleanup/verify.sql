-- Read-only. Run before and after; immediately after APPLY expected_remaining
-- should match actual for every row (before accepting new traffic).
SELECT 'registrations' AS entity, count(*) AS actual, 0 AS expected_remaining FROM public.registrations
UNION ALL SELECT 'attendees',count(*),0 FROM public.attendees
UNION ALL SELECT 'registration_fees',count(*),0 FROM public.registration_fees
UNION ALL SELECT 'payment_submissions',count(*),0 FROM public.payment_submissions
UNION ALL SELECT 'sponsorship_allocations',count(*),0 FROM public.sponsorship_allocations
UNION ALL SELECT 'sponsorship_contributions',count(*),7 FROM public.sponsorship_contributions
UNION ALL SELECT 'users',count(*),13 FROM public.users
UNION ALL SELECT 'app_settings',count(*),1 FROM public.app_settings
UNION ALL SELECT 'reunions',count(*),1 FROM public.reunions
UNION ALL SELECT 'poll_votes',count(*),5 FROM public.poll_votes
UNION ALL SELECT 'activity_choice_selections',count(*),0 FROM public.activity_choice_selections
ORDER BY entity;

-- The seven preserved contributions (including already-detached ID 2).
SELECT id,reunion_id,registration_id,source,amount,payment_status
FROM public.sponsorship_contributions ORDER BY id;

-- Expected balance for reunion 1 immediately after cleanup: $6,635, not zero.
SELECT r.id AS reunion_id,
  COALESCE((SELECT sum(amount) FROM public.sponsorship_contributions c
            WHERE c.reunion_id=r.id AND c.payment_status='paid'),0)
  - COALESCE((SELECT sum(amount) FROM public.sponsorship_allocations a
             WHERE a.reunion_id=r.id AND a.funded_from='fund'),0) AS fund_balance
FROM public.reunions r ORDER BY r.id;