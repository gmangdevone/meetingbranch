import { SaveGraduateContentBody, SubmitGraduateApplicationBody } from "@workspace/api-zod";
import type { GraduateSubmissionRow } from "@workspace/db";

export type GraduateContent = ReturnType<typeof SaveGraduateContentBody.parse>;
export const defaultGraduateContent: GraduateContent = {
  revision: 0, background: "#FFFDF6", foreground: "#1E2A33", accent: "#1F5D8C",
  blocks: [{ id: "welcome", kind: "heading", text: "Graduate Dollars", url: "", background: "", foreground: "",
    font: "serif", size: 36, weight: "bold", align: "left", width: "full", spacing: "comfortable" }],
  questions: [],
};
export function safeGraduateUrl(value: string): boolean {
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
}
export function graduateContentError(content: GraduateContent): string | null {
  if (new Set(content.blocks.map(b => b.id)).size !== content.blocks.length ||
      new Set(content.questions.map(q => q.id)).size !== content.questions.length) return "Block and question IDs must be unique.";
  if (content.questions.some(q => !q.label.trim())) return "Every question needs a label.";
  if (content.blocks.some(b => b.kind === "link" && (!b.text.trim() || !safeGraduateUrl(b.url)))) return "Link blocks need a label and a full HTTP(S) URL without credentials.";
  return null;
}
export function graduateApplicationError(input: ReturnType<typeof SubmitGraduateApplicationBody.parse>, content: GraduateContent): string | null {
  if (!input.name.trim()) return "Enter your name.";
  if (input.revision !== content.revision) return "The application requirements changed. Reload the page before submitting.";
  if (input.links.some(l => !l.label.trim() || !safeGraduateUrl(l.url))) return "Profile links need a label and a full HTTP(S) URL without credentials.";
  if (input.zelle && !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.zelle) || /^\+?[\d ().-]{7,25}$/.test(input.zelle))) return "Zelle must be an email address or phone number.";
  if (input.cashApp && !/^\$?[A-Za-z][A-Za-z0-9]{0,19}$/.test(input.cashApp)) return "Enter a valid Cash App tag (up to 20 letters/numbers).";
  if (new Set(input.answers.map(a => a.questionId)).size !== input.answers.length ||
      input.answers.some(a => !content.questions.some(q => q.id === a.questionId))) return "Application answers do not match the questions.";
  for (const q of content.questions) {
    const value = input.answers.find(a => a.questionId === q.id)?.value.trim() ?? "";
    if (q.required && !value) return `Answer required: ${q.label}`;
    if (q.kind === "short" && value.length > 1000) return `Keep ${q.label} under 1,000 characters.`;
    if (q.kind === "url" && value && !safeGraduateUrl(value)) return `Enter a full HTTP(S) URL for ${q.label}.`;
  }
  return null;
}
export function publicGraduateSubmission(s: GraduateSubmissionRow) {
  return { id: s.id, name: s.name, email: s.email, zelle: s.zelle, cashApp: s.cashApp,
    answers: s.answers, links: s.links, createdAt: s.createdAt, emailStatus: s.emailStatus,
    emailAttempts: s.emailAttempts, emailError: s.emailError };
}
