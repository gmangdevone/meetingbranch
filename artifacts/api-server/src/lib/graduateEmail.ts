import { getFromEmail, isSenderDomainAllowed } from "./email";
import type { GraduateSubmissionRow } from "@workspace/db";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function graduateEmailHtml(eventName: string, s: GraduateSubmissionRow) {
  const lines = [
    ["Candidate", s.name], ["Contact email", s.email], ["Zelle (reference only)", s.zelle || "Not supplied"],
    ["Cash App (reference only)", s.cashApp || "Not supplied"],
    ...s.answers.map(a => [a.label, a.value]), ...s.links.map(l => [l.label, l.url]),
  ];
  return `<h1>Graduate Dollars</h1><p>${escape(eventName)} — Application #${s.id}</p>` +
    lines.map(([label, value]) => `<h2>${escape(label)}</h2><p style="white-space:pre-wrap">${escape(value)}</p>`).join("") +
    "<p>Private scholarship application. No funds are collected or transferred through Meeting Branch.</p>";
}
export async function sendGraduateEmail(to: string, eventName: string, s: GraduateSubmissionRow): Promise<string | null> {
  const key = process.env.BREVO_API_KEY;
  if (!key || !isSenderDomainAllowed(getFromEmail())) throw new Error("Email service is not configured. Contact an administrator.");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Meeting Branch", email: getFromEmail() }, to: [{ email: to }],
      subject: `Graduate Dollars application #${s.id}`, htmlContent: graduateEmailHtml(eventName, s) }),
  });
  if (!response.ok) throw new Error("Email provider did not accept this message. An organizer can retry.");
  const result = await response.json() as { messageId?: string };
  return result.messageId ?? null;
}
