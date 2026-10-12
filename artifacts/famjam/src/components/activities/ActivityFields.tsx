import { useId } from "react";
import type { ActivityChoiceOptionInput } from "@workspace/api-client-react";
import { Input } from "../ui/input";
import { safeHttpUrl } from "../../lib/homeContent";

export const emptyActivity = (): ActivityChoiceOptionInput => ({ label: "", description: "", address: "", mapUrl: "", websiteUrl: "" });
export function activityPayload(item: ActivityChoiceOptionInput): ActivityChoiceOptionInput {
  return { label: item.label.trim(), description: item.description?.trim() || null, address: item.address?.trim() || null, mapUrl: item.mapUrl?.trim() || null, websiteUrl: item.websiteUrl?.trim() || null };
}
export function activityError(items: ActivityChoiceOptionInput[]) {
  if (items.some(i => !i.label.trim())) return "Activity names cannot be blank.";
  if (items.some(i => [i.mapUrl, i.websiteUrl].some(url => url?.trim() && (!/^https?:\/\//i.test(url.trim()) || !safeHttpUrl(url))))) return "Map and website links must start with http:// or https:// and be valid URLs.";
  return null;
}

export function ActivityFields({ value, onChange, disabled = false }: { value: ActivityChoiceOptionInput; onChange: (value: ActivityChoiceOptionInput) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 flex-1 space-y-3 border rounded-xl p-3">
      <legend className="px-1 text-sm font-medium">Activity details</legend>
      {([
        ["label", "Activity name", false],
        ["description", "Description (optional)", false],
        ["address", "Address (optional)", false],
        ["mapUrl", "Map link (optional)", true],
        ["websiteUrl", "Website (optional)", true],
      ] as const).map(([key, label, isUrl]) => (
        <div key={key}>
          <label htmlFor={`${id}-${key}`} className="block text-sm mb-1">{label}</label>
          {key === "description" ? (
            <textarea id={`${id}-${key}`} className="border bg-transparent rounded-xl px-3 py-2 w-full min-h-20" value={value[key] ?? ""} onChange={e => onChange({ ...value, [key]: e.target.value })} />
          ) : (
            <Input id={`${id}-${key}`} type={isUrl ? "url" : "text"} placeholder={isUrl ? "https://…" : undefined} value={value[key] ?? ""} onChange={e => onChange({ ...value, [key]: e.target.value })} />
          )}
        </div>
      ))}
    </fieldset>
  );
}
