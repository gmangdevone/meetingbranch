import { useId } from "react";
import { ExternalLink } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { PlainText } from "../PlainText";
import { DESCRIPTION_MAX, LINK_MAX, type OptionDraftErrors, type PollOptionDraft, visibleDetails } from "../../lib/pollOptions";

interface Props {
  value: PollOptionDraft;
  onChange: (next: PollOptionDraft) => void;
  errors?: OptionDraftErrors;
  labelText: string;
  placeholder?: string;
  onLabelEnter?: () => void;
  trailing?: React.ReactNode;
}

/** Shared option editor used for poll creation, editing, and adding options. */
export function PollOptionFields({ value, onChange, errors = {}, labelText, placeholder, onLabelEnter, trailing }: Props) {
  const id = useId();
  const set = (patch: Partial<PollOptionDraft>) => onChange({ ...value, ...patch });
  const errId = (k: string) => `${id}-${k}-err`;
  return (
    <div className="border rounded-xl p-3 flex flex-col gap-3 min-w-0">
      <div className="flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <Label htmlFor={`${id}-label`} className="sr-only">{labelText}</Label>
          <Input
            id={`${id}-label`}
            className="rounded-xl"
            placeholder={placeholder ?? labelText}
            value={value.label}
            aria-invalid={!!errors.label}
            aria-describedby={errors.label ? errId("label") : undefined}
            onChange={(e) => set({ label: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && onLabelEnter) { e.preventDefault(); onLabelEnter(); } }}
          />
          {errors.label && <p id={errId("label")} className="text-xs text-destructive mt-1">{errors.label}</p>}
        </div>
        {trailing}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Switch
          id={`${id}-toggle`}
          checked={value.detailsEnabled}
          onCheckedChange={(c) => set({ detailsEnabled: c })}
          aria-label={`Show description and link for ${labelText}`}
        />
        <Label htmlFor={`${id}-toggle`} className="text-sm font-normal text-muted-foreground cursor-pointer">
          Add description or link
        </Label>
      </div>
      {value.detailsEnabled && (
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor={`${id}-desc`} className="mb-1 block text-xs">Description (optional)</Label>
            <Textarea
              id={`${id}-desc`}
              className="rounded-xl min-h-[72px]"
              maxLength={DESCRIPTION_MAX}
              value={value.description}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? errId("desc") : undefined}
              onChange={(e) => set({ description: e.target.value })}
            />
            {errors.description && <p id={errId("desc")} className="text-xs text-destructive mt-1">{errors.description}</p>}
          </div>
          <div>
            <Label htmlFor={`${id}-link`} className="mb-1 block text-xs">Link (optional)</Label>
            <Input
              id={`${id}-link`}
              type="url"
              inputMode="url"
              className="rounded-xl"
              placeholder="https://"
              maxLength={LINK_MAX}
              value={value.linkUrl}
              aria-invalid={!!errors.linkUrl}
              aria-describedby={errors.linkUrl ? errId("link") : undefined}
              onChange={(e) => set({ linkUrl: e.target.value })}
            />
            {errors.linkUrl && <p id={errId("link")} className="text-xs text-destructive mt-1">{errors.linkUrl}</p>}
          </div>
          {errors.details && <p role="alert" className="text-xs text-destructive">{errors.details}</p>}
        </div>
      )}
    </div>
  );
}

/** Read-only rendering of option details for members and organizers. Lives outside any vote button. */
export function PollOptionDetails({ option, className = "" }: { option: { detailsEnabled?: boolean; description?: string | null; linkUrl?: string | null; label: string }; className?: string }) {
  const d = visibleDetails(option);
  if (!d) return null;
  return (
    <div className={`text-sm text-muted-foreground flex flex-col gap-1 min-w-0 break-words ${className}`}>
      {d.description && <PlainText text={d.description} />}
      {d.linkUrl && (
        <a
          href={d.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-primary font-medium hover:underline break-all w-fit"
          aria-label={`Open link for ${option.label} (opens in a new tab)`}
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {(() => { try { return new URL(d.linkUrl).hostname; } catch { return d.linkUrl; } })()}
        </a>
      )}
    </div>
  );
}
