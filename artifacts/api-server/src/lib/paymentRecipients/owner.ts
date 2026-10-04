/**
 * Platform payment-owner authorization. The owner is a single, explicitly
 * configured Clerk user id (PAYMENT_OWNER_USER_ID) and is deliberately
 * independent of users.is_admin, reunion ownership, ADMIN_USER_ID and any
 * first-user bootstrap. If the variable is missing or malformed, nobody is the
 * owner and every recipient write is denied (fail closed).
 */
const CLERK_USER_ID = /^user_[A-Za-z0-9]{10,64}$/;

export function getConfiguredPaymentOwnerId(): string | null {
  const raw = process.env.PAYMENT_OWNER_USER_ID;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return CLERK_USER_ID.test(id) ? id : null;
}

export function isPaymentOwner(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const owner = getConfiguredPaymentOwnerId();
  return owner !== null && userId === owner;
}
