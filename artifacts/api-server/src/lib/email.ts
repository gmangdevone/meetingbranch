import type { ReunionFee } from "@workspace/db";
import { logger } from "./logger";
import { feeApplies, computeFeeAmount } from "./fees";

const BREVO_API_KEY = process.env.BREVO_API_KEY ?? null;

interface AttendeeInfo {
  name: string;
  shirtSize: string;
  dietaryRestrictions?: string | null;
  age?: number | null;
}

interface ReunionInfo {
  name: string;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  fees: ReunionFee[];
  paymentHandle: string;
  paymentUrl?: string | null;
}

interface SendConfirmationEmailParams {
  toEmail: string;
  toName: string;
  branchName: string;
  attendees: AttendeeInfo[];
  selectedFeeIds: number[];
  registrationId: number;
  registeredAt: Date;
  reunion: ReunionInfo;
}

// Verified sender configured in Brevo — override with BREVO_FROM_EMAIL env var if needed
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL ?? "noreply@famjam.app";
const FROM_NAME = "Meeting Branch";

function formatDateRange(startDate: string, endDate: string): string {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  };
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  };
  const start = parse(startDate);
  const end = parse(endDate);
  const startStr = start.toLocaleDateString("en-US", opts);
  const endSameMonth = start.getUTCMonth() === end.getUTCMonth();
  const endStr = endSameMonth
    ? String(end.getUTCDate())
    : end.toLocaleDateString("en-US", opts);
  return `${startStr}–${endStr}, ${end.getUTCFullYear()}`;
}

function buildEmailHtml(params: SendConfirmationEmailParams): string {
  const { toName, branchName, attendees, selectedFeeIds, registrationId, registeredAt, reunion } =
    params;
  const feeLines = reunion.fees
    .filter((fee) => feeApplies(fee, selectedFeeIds))
    .map((fee) => ({ label: fee.label, amount: computeFeeAmount(fee, attendees) }))
    .filter((line) => line.amount > 0);
  const totalFee = feeLines.reduce((sum, line) => sum + line.amount, 0);
  const dateRange = formatDateRange(reunion.startDate, reunion.endDate);
  const formattedDate = registeredAt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "full",
    timeStyle: "short",
  });
  const payHandle = reunion.paymentHandle;
  const payUrl = reunion.paymentUrl || null;

  const attendeeRows = attendees
    .map(
      (a, i) => `
      <tr style="background:${i % 2 === 0 ? "#f9fafb" : "#ffffff"}">
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">${a.name}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;text-align:center;">${a.shirtSize}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">${a.dietaryRestrictions || "None"}</td>
      </tr>`,
    )
    .join("");

  const payCta = payUrl
    ? `<a href="${payUrl}" style="display:inline-block;background:#00d632;color:#000000;font-weight:bold;font-size:16px;padding:14px 40px;border-radius:50px;text-decoration:none;">
         Pay ${payHandle}
       </a>`
    : `<p style="margin:0;color:#1f2937;font-size:20px;font-weight:bold;">${payHandle}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Meeting Branch Registration Confirmation</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:40px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;letter-spacing:-0.5px;">🎉 Meeting Branch</h1>
              <p style="margin:8px 0 0;color:#e0d7ff;font-size:15px;">${reunion.name} · ${dateRange}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;color:#1f2937;font-size:20px;">You're registered, ${toName}!</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
                Confirmation #${registrationId} &nbsp;·&nbsp; Registered ${formattedDate} (CT)
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:12px 16px;background:#f5f3ff;border-radius:8px;">
                    <span style="color:#7c3aed;font-weight:bold;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Family Branch</span><br/>
                    <span style="color:#1f2937;font-size:18px;font-weight:bold;">${branchName}</span>
                  </td>
                </tr>
              </table>

              <h3 style="margin:0 0 12px;color:#374151;font-size:15px;">Registered Attendees (${attendees.length})</h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:32px;">
                <thead>
                  <tr style="background:#f3f4f6;">
                    <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Name</th>
                    <th style="padding:10px 16px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">T-Shirt</th>
                    <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Dietary</th>
                  </tr>
                </thead>
                <tbody>${attendeeRows}</tbody>
              </table>

              ${
                totalFee > 0
                  ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#fef9ee;border:1px solid #fde68a;border-radius:8px;padding:0;margin-bottom:32px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;color:#92400e;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total Due</p>
                    <p style="margin:0 0 8px;color:#1f2937;font-size:28px;font-weight:bold;">${totalFee.toFixed(2)}</p>
                    ${feeLines
                      .map(
                        (line) =>
                          `<p style="margin:0;color:#6b7280;font-size:13px;">${line.label}: ${line.amount.toFixed(2)}</p>`,
                      )
                      .join("")}
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center" style="padding:20px;background:#f0fdf4;border-radius:8px;">
                    <p style="margin:0 0 4px;color:#166534;font-size:14px;font-weight:600;">Pay your reunion fees</p>
                    <p style="margin:0 0 16px;color:#4b5563;font-size:13px;">Send <strong>$${totalFee.toFixed(2)}</strong> to <strong>${payHandle}</strong></p>
                    ${payCta}
                    <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;">Please include your name and "${reunion.name}" in the payment note</p>
                  </td>
                </tr>
              </table>`
                  : ""
              }

              <p style="margin:0;color:#6b7280;font-size:13px;text-align:center;">
                Questions? Contact your reunion organizer. We can't wait to see you at ${reunion.name}!
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">Meeting Branch · ${reunion.name}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendRegistrationConfirmation(
  params: SendConfirmationEmailParams,
): Promise<void> {
  if (!BREVO_API_KEY) {
    logger.warn("BREVO_API_KEY not set — skipping confirmation email");
    logger.info(
      { to: params.toEmail, registrationId: params.registrationId },
      "Would have sent registration confirmation",
    );
    return;
  }

  const payload = {
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: params.toEmail, name: params.toName }],
    subject: `You're registered for ${params.reunion.name}! 🎉`,
    htmlContent: buildEmailHtml(params),
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { status: res.status, body, to: params.toEmail },
        "Brevo API error sending confirmation email",
      );
    } else {
      const data = (await res.json()) as { messageId?: string };
      logger.info(
        { messageId: data.messageId, to: params.toEmail },
        "Confirmation email sent via Brevo",
      );
    }
  } catch (err) {
    logger.error({ err, to: params.toEmail }, "Failed to send confirmation email via Brevo");
  }
}
