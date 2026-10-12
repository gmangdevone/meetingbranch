import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAdminGetSettingsQueryKey, getGetSettingsQueryKey, useAdminUpdateSettings, useGetSettings } from "@workspace/api-client-react";
import { Button } from "./ui/button";

type TextSize = "standard" | "larger" | "largest";
const sizes: TextSize[] = ["standard", "larger", "largest"];

/** Public settings keep signed-out pages and other sessions in sync too. */
export function ContentTextSizeSync() {
  const { data } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 30_000, staleTime: 0, refetchOnWindowFocus: true } });
  useEffect(() => {
    document.documentElement.dataset.contentTextSize = data?.contentTextSize ?? "larger";
  }, [data?.contentTextSize]);
  return null;
}

export function ContentTextSizeSetting({ value }: { value: TextSize }) {
  const [draft, setDraft] = useState<TextSize>(value);
  const [message, setMessage] = useState("");
  const mutation = useAdminUpdateSettings();
  const client = useQueryClient();
  useEffect(() => { setDraft(value); }, [value]);
  async function save(size: TextSize) {
    setMessage("");
    try {
      await mutation.mutateAsync({ data: { contentTextSize: size } });
      document.documentElement.dataset.contentTextSize = size;
      await Promise.all([
        client.invalidateQueries({ queryKey: getAdminGetSettingsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetSettingsQueryKey() }),
      ]);
      setDraft(size);
      setMessage("Content text size saved site-wide.");
    } catch {
      setMessage("Could not save text size. Please try again.");
    }
  }
  return <section className="border-b pb-4 space-y-3">
    <label htmlFor="content-text-size" className="font-medium block">Content text size</label>
    <p className="text-sm text-muted-foreground">Applies to everyone, across the site. Headings stay unchanged.</p>
    <select id="content-text-size" value={draft} disabled={mutation.isPending} onChange={e => { setDraft(e.target.value as TextSize); setMessage(""); }} className="w-full border rounded-md p-2 bg-background">
      {sizes.map(size => <option key={size} value={size}>{size[0].toUpperCase() + size.slice(1)}{size === "larger" ? " (default)" : ""}</option>)}
    </select>
    <div data-content-text-size={draft} className="content-text-preview border rounded-xl p-3 space-y-2">
      <h3 className="text-lg font-semibold">Preview heading</h3>
      <p className="text-base">Family updates and activity details.</p>
      <p className="text-sm">Supporting information stays readable.</p>
      <label className="text-sm block">Example field<input readOnly value="Your family name" className="block w-full border rounded p-2 mt-1 bg-background text-base" /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={mutation.isPending || draft === value} onClick={() => save(draft)}>{mutation.isPending ? "Saving…" : "Save text size"}</Button>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => save("larger")}>Reset to default</Button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
