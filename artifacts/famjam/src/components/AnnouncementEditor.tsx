import { useEffect, useRef, useState } from "react";
import { announcementLinks, encodeAnnouncementLink, safeAnnouncementUrl } from "../lib/announcementLinks";
import { AnnouncementBody } from "./AnnouncementBody";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

export function AnnouncementEditor({ value, onChange, disabled, onLinkEditing }: {
  value: string; onChange: (value: string) => void; disabled: boolean; onLinkEditing?: (editing: boolean) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<{ start: number; end: number; label: string; url: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { onLinkEditing?.(!!draft); }, [draft, onLinkEditing]);
  const links = announcementLinks(value);
  function replace(start: number, end: number, text: string) {
    onChange(value.slice(0, start) + text + value.slice(end));
    setDraft(null);
    setError("");
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  function insert() {
    const start = textarea.current?.selectionStart ?? value.length;
    const end = textarea.current?.selectionEnd ?? start;
    const existing = links.find(link => start >= link.start && start < link.end);
    setDraft(existing ?? { start, end, label: value.slice(start, end), url: "" });
    setError("");
  }
  function apply() {
    if (!draft) return;
    const url = safeAnnouncementUrl(draft.url);
    if (!draft.label.trim() || /[\r\n]/.test(draft.label)) {
      setError("Enter a word or phrase on one line."); return;
    }
    if (!url) { setError("Enter a full http:// or https:// URL without spaces or login credentials."); return; }
    replace(draft.start, draft.end, encodeAnnouncementLink(draft.label.trim(), url));
  }
  return <div className="space-y-3">
    <Label htmlFor="announcement-message">Message</Label>
    <Textarea id="announcement-message" ref={textarea} value={value}
      disabled={disabled || !!draft} onChange={e => onChange(e.target.value)}
      placeholder="Type your message here..." className="min-h-[150px] rounded-xl" />
    <p className="text-xs text-muted-foreground">Select a word or place your cursor, then insert a link. Links appear as [text](URL) here; the preview shows what members see.</p>
    <Button type="button" variant="outline" disabled={disabled || !!draft} onClick={insert}>Insert Link</Button>
    {draft && <fieldset disabled={disabled} className="rounded-xl border p-3 space-y-3">
      <legend className="px-1 font-semibold">Link details</legend>
      <Label htmlFor="announcement-link-text">Display text</Label>
      <Input id="announcement-link-text" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} />
      <Label htmlFor="announcement-link-url">Destination URL</Label>
      <Input id="announcement-link-url" type="url" placeholder="https://..." value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={apply}>Apply Link</Button>
        <Button type="button" variant="outline" onClick={() => { setDraft(null); setError(""); }}>Cancel Link</Button>
      </div>
    </fieldset>}
    {links.length > 0 && <ul className="space-y-2" aria-label="Message links">
      {links.map(link => <li key={link.start} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="break-all flex-1">{link.label}</span>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !!draft} onClick={() => { setDraft(link); setError(""); }} aria-label={`Edit link ${link.label}`}>Edit link</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !!draft} onClick={() => replace(link.start, link.end, link.label)} aria-label={`Remove link ${link.label}`}>Remove link</Button>
      </li>)}
    </ul>}
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="text-xs font-bold mb-2">Member preview</p>
      <div className="whitespace-pre-wrap break-words text-sm"><AnnouncementBody body={value} /></div>
    </div>
    {draft && <p className="text-xs text-muted-foreground">Apply Link before posting to include your link changes.</p>}
  </div>;
}
