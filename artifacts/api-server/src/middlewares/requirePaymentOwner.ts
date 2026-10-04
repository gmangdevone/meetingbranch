import type { Request, Response, NextFunction } from "express";
import { getClerkUserId } from "./requireAuth";
import { isPaymentOwner } from "../lib/paymentRecipients/owner";

/**
 * Gate for owner-only payment recipient routes. Uses ONLY the verified Clerk
 * session id compared against PAYMENT_OWNER_USER_ID. It intentionally ignores
 * users.is_admin, ADMIN_USER_ID and reunion ownership, so promoting or
 * demoting ordinary admins never changes owner authority.
 */
export function requirePaymentOwner(req: Request, res: Response, next: NextFunction): void {
  const userId = getClerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isPaymentOwner(userId)) {
    res.status(403).json({ error: "Only the platform owner can manage payment recipients." });
    return;
  }
  (req as any).userId = userId;
  next();
}
