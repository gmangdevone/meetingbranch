import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { reunionsTable } from "./reunions";

/**
 * Vendors: venues, parks, caterers, suppliers, etc. that organizers evaluate
 * for a reunion. Organizers compare quoted costs across prospects, upload
 * contracts, and mark a vendor "approved" once selected. Approved vendors carry
 * the contracted service date/times and full contact info.
 *
 * quotedCost is whole dollars, matching the rest of the money model.
 * serviceDate is YYYY-MM-DD; serviceStartTime/serviceEndTime are HH:MM (24h).
 */
export const vendorCategoryEnum = pgEnum("vendor_category", [
  "venue",
  "park",
  "caterer",
  "supplier",
  "entertainment",
  "other",
]);

export const vendorStatusEnum = pgEnum("vendor_status", [
  "prospect",
  "approved",
  "rejected",
]);

export const vendorsTable = pgTable("vendors", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: vendorCategoryEnum("category").notNull(),
  status: vendorStatusEnum("status").notNull().default("prospect"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  quotedCost: integer("quoted_cost"),
  notes: text("notes"),
  serviceDate: text("service_date"),
  serviceStartTime: text("service_start_time"),
  serviceEndTime: text("service_end_time"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendorContractsTable = pgTable("vendor_contracts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  // Clerk user id of the uploader
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vendor = typeof vendorsTable.$inferSelect;
export type VendorContract = typeof vendorContractsTable.$inferSelect;
