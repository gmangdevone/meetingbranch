-- Vendors area: organizers evaluate venues/parks/caterers/suppliers, compare
-- quoted costs, upload contracts, and approve a vendor of choice with the
-- contracted service date/times and full contact info.

DO $$ BEGIN
  CREATE TYPE vendor_category AS ENUM ('venue', 'park', 'caterer', 'supplier', 'entertainment', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vendor_status AS ENUM ('prospect', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS vendors (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  name text NOT NULL,
  category vendor_category NOT NULL,
  status vendor_status NOT NULL DEFAULT 'prospect',
  contact_name text,
  phone text,
  email text,
  website text,
  address text,
  quoted_cost integer,
  notes text,
  service_date text,
  service_start_time text,
  service_end_time text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_quoted_cost_nonnegative CHECK (quoted_cost IS NULL OR quoted_cost >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS vendor_contracts (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vendor_id integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  object_path text NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
