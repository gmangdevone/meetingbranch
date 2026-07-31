import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { reunionsTable } from "./reunions";

/**
 * Image library: every image an organizer uploads (hero banner, hub cards,
 * or directly into the library) is recorded here so it can be browsed and
 * reused across the site without re-uploading.
 *
 * objectPath is the /objects/... path returned by the upload-URL endpoint;
 * it is unique per reunion so re-registering the same upload is a no-op.
 */
export const reunionImagesTable = pgTable("reunion_images", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  // Clerk user id of the uploader
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
