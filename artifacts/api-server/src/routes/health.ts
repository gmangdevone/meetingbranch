import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getFromEmail, isSenderDomainAllowed, ALLOWED_SENDER_DOMAINS } from "../lib/email";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Smoke-check that the configured FROM_EMAIL sender domain is on the verified
 * Brevo allowlist.  Returns 200 when healthy, 500 when the domain would cause
 * email to bounce (unverified sender).
 */
router.get("/healthz/email-sender", (_req, res) => {
  const fromEmail = getFromEmail();
  const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
  const ok = isSenderDomainAllowed(fromEmail);

  res.status(ok ? 200 : 500).json({
    ok,
    fromEmail,
    domain,
    allowedDomains: ALLOWED_SENDER_DOMAINS,
    ...(ok ? {} : { error: `Sender domain "${domain}" is not in the Brevo-verified allowlist` }),
  });
});

export default router;
