-- Image library: reusable images uploaded by organizers, per reunion.
CREATE TABLE IF NOT EXISTS reunion_images (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  object_path text NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reunion_images_reunion_object_unique UNIQUE (reunion_id, object_path)
);
CREATE INDEX IF NOT EXISTS reunion_images_reunion_idx ON reunion_images (reunion_id);
