import { useId } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { ActivityDraft } from "../../lib/activityDetails";

/** Optional description/address/website/map inputs for a single activity. */
export function ActivityDetailFields({ value, onChange, name }: { value: ActivityDraft; onChange: (next: ActivityDraft) => void; name?: string }) {
  const id = useId();
  const set = (k: keyof ActivityDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const suffix = name ? ` for ${name}` : "";
  return (
    <div className="grid gap-2 sm:grid-cols-2 pl-1">
      <div className="sm:col-span-2">
        <Label htmlFor={`${id}-d`} className="mb-1 block text-xs">Description (optional)</Label>
        <textarea id={`${id}-d`} aria-label={`Description${suffix}`} className="border bg-transparent rounded-xl px-3 py-2 w-full min-h-16 text-sm" value={value.description} onChange={set("description")} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${id}-a`} className="mb-1 block text-xs">Address (optional)</Label>
        <Input id={`${id}-a`} aria-label={`Address${suffix}`} value={value.address} onChange={set("address")} />
      </div>
      <div>
        <Label htmlFor={`${id}-w`} className="mb-1 block text-xs">Website URL (optional)</Label>
        <Input id={`${id}-w`} aria-label={`Website URL${suffix}`} type="url" inputMode="url" placeholder="https://" value={value.websiteUrl} onChange={set("websiteUrl")} />
      </div>
      <div>
        <Label htmlFor={`${id}-m`} className="mb-1 block text-xs">Map URL (optional)</Label>
        <Input id={`${id}-m`} aria-label={`Map URL${suffix}`} type="url" inputMode="url" placeholder="https://" value={value.mapUrl} onChange={set("mapUrl")} />
      </div>
    </div>
  );
}
