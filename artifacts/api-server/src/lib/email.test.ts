import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ALLOWED_SENDER_DOMAINS, getFromEmail, isSenderDomainAllowed } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
// Allowlist logic
// ──────────────────────────────────────────────────────────────────────────────
describe("ALLOWED_SENDER_DOMAINS", () => {
  it("includes coppergram.com as the verified Brevo sender domain", () => {
    expect(ALLOWED_SENDER_DOMAINS).toContain("coppergram.com");
  });
});

describe("isSenderDomainAllowed", () => {
  it("accepts an address on the allowlist", () => {
    expect(isSenderDomainAllowed("gigsetapp@coppergram.com")).toBe(true);
  });

  it("accepts any local-part on an allowed domain", () => {
    expect(isSenderDomainAllowed("noreply@coppergram.com")).toBe(true);
  });

  it("rejects the old famjam.app sender address", () => {
    expect(isSenderDomainAllowed("noreply@famjam.app")).toBe(false);
  });

  it("rejects arbitrary domains", () => {
    expect(isSenderDomainAllowed("someone@gmail.com")).toBe(false);
  });

  it("is case-insensitive on the domain portion", () => {
    expect(isSenderDomainAllowed("hello@COPPERGRAM.COM")).toBe(true);
  });

  // Malformed address regression cases
  it("rejects an address with no @ sign", () => {
    expect(isSenderDomainAllowed("no-domain")).toBe(false);
    expect(isSenderDomainAllowed("coppergram.com")).toBe(false);
  });

  it("rejects an empty local-part (@coppergram.com)", () => {
    expect(isSenderDomainAllowed("@coppergram.com")).toBe(false);
  });

  it("rejects multiple @ signs (x@coppergram.com@evil.test)", () => {
    expect(isSenderDomainAllowed("x@coppergram.com@evil.test")).toBe(false);
  });

  it("rejects an address with an empty domain segment", () => {
    expect(isSenderDomainAllowed("user@")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getFromEmail — env-var resolution
// ──────────────────────────────────────────────────────────────────────────────
describe("getFromEmail", () => {
  it("returns the BREVO_FROM_EMAIL override when set", () => {
    vi.stubEnv("BREVO_FROM_EMAIL", "custom@coppergram.com");
    expect(getFromEmail()).toBe("custom@coppergram.com");
  });

  it("falls back to gigsetapp@coppergram.com when BREVO_FROM_EMAIL is empty string", () => {
    // Empty string is treated as unset so misconfigured envs don't slip through.
    vi.stubEnv("BREVO_FROM_EMAIL", "");
    expect(getFromEmail()).toBe("gigsetapp@coppergram.com");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// End-to-end: whatever is configured right now must be on the allowlist.
// ──────────────────────────────────────────────────────────────────────────────
describe("configured sender in the current environment", () => {
  it("FROM_EMAIL domain is on the Brevo-verified allowlist", () => {
    const email = getFromEmail();
    expect(
      isSenderDomainAllowed(email),
      `Configured FROM_EMAIL "${email}" is not on the allowlist. ` +
        `Allowed: ${ALLOWED_SENDER_DOMAINS.join(", ")}. ` +
        `Update BREVO_FROM_EMAIL or add the domain to ALLOWED_SENDER_DOMAINS.`,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// sendRegistrationConfirmation — fetch-level enforcement tests
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal params that satisfy SendConfirmationEmailParams */
function makeParams() {
  return {
    toEmail: "guest@example.com",
    toName: "Guest User",
    branchName: "Branch A",
    attendees: [{ name: "Guest User", shirtSize: "M" }],
    selectedFeeIds: [],
    registrationId: 42,
    registeredAt: new Date("2026-01-01T12:00:00Z"),
    reunion: {
      name: "Reunion 2027",
      startDate: "2027-07-16",
      endDate: "2027-07-19",
      fees: [],
      paymentHandle: "$goudycgp",
      paymentUrl: null,
    },
  };
}

describe("sendRegistrationConfirmation — domain enforcement", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset the module registry so every dynamic import below re-evaluates the
    // module with the currently stubbed env vars (BREVO_API_KEY is a module-level
    // const, so a fresh import is required for env stubs to take effect).
    vi.resetModules();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messageId: "mock-id" }), { status: 200 }),
    );
    // Default: BREVO_API_KEY present so we reach the domain-check branch.
    vi.stubEnv("BREVO_API_KEY", "test-api-key");
  });

  it("sends the request with a valid coppergram.com sender", async () => {
    vi.stubEnv("BREVO_FROM_EMAIL", "gigsetapp@coppergram.com");
    const { sendRegistrationConfirmation } = await import("./email");

    await sendRegistrationConfirmation(makeParams());

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sender.email).toBe("gigsetapp@coppergram.com");
  });

  it("blocks the Brevo request when BREVO_FROM_EMAIL is set to an unverified domain", async () => {
    vi.stubEnv("BREVO_FROM_EMAIL", "noreply@famjam.app");
    const { sendRegistrationConfirmation } = await import("./email");

    await sendRegistrationConfirmation(makeParams());

    // fetch must NOT have been called — unverified sender is blocked before touching the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks the Brevo request for any arbitrary unverified domain", async () => {
    vi.stubEnv("BREVO_FROM_EMAIL", "attacker@evil.example.com");
    const { sendRegistrationConfirmation } = await import("./email");

    await sendRegistrationConfirmation(makeParams());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips email entirely (no fetch) when BREVO_API_KEY is absent", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("BREVO_FROM_EMAIL", "gigsetapp@coppergram.com");
    const { sendRegistrationConfirmation } = await import("./email");

    await sendRegistrationConfirmation(makeParams());

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CI / production guard: BREVO_FROM_EMAIL must be explicitly set so no
// environment accidentally falls through to an unverified or stale default.
// ──────────────────────────────────────────────────────────────────────────────
describe("CI / production environment guard", () => {
  const isNonLocal = Boolean(process.env.CI || process.env.NODE_ENV === "production");

  it.skipIf(!isNonLocal)(
    "BREVO_FROM_EMAIL is explicitly set in CI and production environments",
    () => {
      expect(
        process.env.BREVO_FROM_EMAIL,
        "BREVO_FROM_EMAIL must be set as an environment variable in CI/production " +
          "so emails always originate from a Brevo-verified sender. " +
          "Add it to your deployment secrets or CI environment configuration.",
      ).toBeTruthy();
    },
  );
});
