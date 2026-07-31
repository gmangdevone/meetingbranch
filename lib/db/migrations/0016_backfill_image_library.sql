-- Backfill the image library with images already in use on reunion hub
-- sections (hero banner + card backgrounds), so organizers can reuse them.
INSERT INTO reunion_images (reunion_id, file_name, object_path, uploaded_by)
SELECT r.id, s.file_name, s.object_path, r.organizer_id
FROM reunions r
CROSS JOIN LATERAL (
  VALUES
    ('Hero banner', r.hero_image_url),
    ('Schedule card', r.schedule_card_image_url),
    ('Announcements card', r.announcements_card_image_url),
    ('Family vote card', r.polls_card_image_url)
) AS s(file_name, object_path)
WHERE s.object_path IS NOT NULL
  AND s.object_path LIKE '/objects/%'
ON CONFLICT (reunion_id, object_path) DO NOTHING;
