/** Blank ages must not become zero, or be priced as adults. */
export function registrationPricingReady(attendees: { name?: string; age?: unknown }[], contribution: unknown) {
  return attendees.length > 0 && attendees.every((a) =>
    !!a.name?.trim() && a.age != null && String(a.age).trim() !== "" &&
    Number.isInteger(Number(a.age)) && Number(a.age) >= 0 && Number(a.age) <= 120
  ) && (contribution == null || contribution === "" ||
    (Number.isInteger(Number(contribution)) && Number(contribution) >= 0));
}