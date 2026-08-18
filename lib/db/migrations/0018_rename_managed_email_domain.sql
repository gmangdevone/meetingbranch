-- Rename synthetic managed-account email domain from @famjam.cg to @coppergram.com
-- These rows are organizer-created users with no real Clerk identity; the email
-- is a synthetic placeholder and is never used for delivery.
UPDATE users
SET email = replace(email, '@famjam.cg', '@coppergram.com')
WHERE is_managed = true
  AND email LIKE '%@famjam.cg';
