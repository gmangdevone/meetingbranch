-- 0022: Repair fund solvency after the 0020 pending backfill.
--
-- Before 0020, the fund balance counted EVERY contribution, so organizers may
-- have allocated money that 0020 then reclassified as pending (direct chip-ins
-- backfilled as pending, registration-source chip-ins copied from their
-- registration's status). Left alone, those reunions would start with a
-- negative paid-only balance (allocated more than "received").
--
-- Money that was already spent from the fund was clearly received, so for each
-- reunion whose fund-sourced allocations exceed its paid contributions, promote
-- non-paid contributions to paid (smallest amount first, oldest first as a
-- tiebreaker) until paid contributions cover allocations, in this order:
--   1. pending standalone direct chip-ins;
--   2. pending registration-source chip-ins — promoting their registration to
--      paid in the same step, preserving the rule that registration-source
--      chip-ins always mirror their registration's payment status;
--   3. as a last resort, any remaining non-paid contribution (e.g. waived
--      registration-source rows), again syncing the linked registration.
-- Everything not needed for solvency stays as 0020 left it, preserving the
-- "chip-ins show as due until an organizer confirms them" behavior.

BEGIN;

DO $$
DECLARE
  r RECORD;
  c RECORD;
  deficit integer;
BEGIN
  FOR r IN
    SELECT
      a.reunion_id,
      a.total_allocated - COALESCE(p.total_paid, 0) AS deficit
    FROM (
      SELECT reunion_id, SUM(amount) AS total_allocated
      FROM sponsorship_allocations
      WHERE funded_from = 'fund'
      GROUP BY reunion_id
    ) a
    LEFT JOIN (
      SELECT reunion_id, SUM(amount) AS total_paid
      FROM sponsorship_contributions
      WHERE payment_status = 'paid'
      GROUP BY reunion_id
    ) p ON p.reunion_id = a.reunion_id
    WHERE a.total_allocated - COALESCE(p.total_paid, 0) > 0
  LOOP
    deficit := r.deficit;
    FOR c IN
      SELECT id, amount, registration_id, source
      FROM sponsorship_contributions
      WHERE reunion_id = r.reunion_id
        AND payment_status <> 'paid'
      ORDER BY
        -- Pass 1: pending direct; pass 2: pending registration-source;
        -- pass 3: anything else still not paid.
        CASE
          WHEN payment_status = 'pending' AND source = 'direct' AND registration_id IS NULL THEN 1
          WHEN payment_status = 'pending' AND source = 'registration' THEN 2
          ELSE 3
        END,
        amount ASC,
        created_at ASC
    LOOP
      EXIT WHEN deficit <= 0;
      UPDATE sponsorship_contributions SET payment_status = 'paid' WHERE id = c.id;
      -- Registration-source chip-ins mirror their registration's status.
      IF c.source = 'registration' AND c.registration_id IS NOT NULL THEN
        UPDATE registrations SET payment_status = 'paid' WHERE id = c.registration_id;
      END IF;
      deficit := deficit - c.amount;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
