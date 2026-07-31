-- Vendors: service window can span multiple days.
-- serviceDate is the start (YYYY-MM-DD); service_end_date is the optional end date.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS service_end_date text;
