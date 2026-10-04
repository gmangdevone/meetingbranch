import { useState } from "react";
import { useUpdateMyProfile, type MemberProfile } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { NAME_MAX, usableName, validateName } from "../lib/profile";

type Props = {
  required: boolean;
  profile: MemberProfile | undefined;
  loadError: boolean;
  retrying: boolean;
  onRetryLoad: () => void;
  onSaved: (profile: MemberProfile) => void;
  onClose: () => void;
};

function serverMessage(err: unknown): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return "We couldn't save your name. Please try again.";
}

export function NameDialog({ required, profile, loadError, retrying, onRetryLoad, onSaved, onClose }: Props) {
  const [firstName, setFirstName] = useState(() => usableName(profile?.firstName));
  const [lastName, setLastName] = useState(() => usableName(profile?.lastName));
  const [errors, setErrors] = useState<{ first?: string; last?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const update = useUpdateMyProfile();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const first = validateName(firstName, "First name") ?? undefined;
    const last = validateName(lastName, "Last name") ?? undefined;
    setErrors({ first, last });
    setSaveError(null);
    if (first || last) return;
    update.mutate(
      { data: { firstName: firstName.trim(), lastName: lastName.trim() } },
      { onSuccess: onSaved, onError: (err) => setSaveError(serverMessage(err)) },
    );
  };

  const block = (e: Event) => {
    if (required) e.preventDefault();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !required) onClose(); }}>
      <DialogContent
        className={`w-[calc(100vw-1.5rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl p-6 sm:p-8 ${required ? "[&>button:last-child]:hidden" : ""}`}
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
        onInteractOutside={block}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-3xl font-bold">
            {required ? "What should we call you?" : "Edit your name"}
          </DialogTitle>
          <DialogDescription className="text-base">
            {required
              ? "Add your first and last name so your family knows who's coming. We'll greet you by first name."
              : "Update the name we use for your account. Only your first name appears in greetings."}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div role="alert" className="flex flex-col gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="font-medium text-foreground">We couldn't load your profile.</p>
            <Button type="button" onClick={onRetryLoad} disabled={retrying} className="self-start rounded-full font-bold">
              {retrying ? "Retrying..." : "Try again"}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-first-name" className="font-bold">First name</Label>
              <Input
                id="profile-first-name"
                autoComplete="given-name"
                autoFocus
                required
                maxLength={NAME_MAX + 20}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                aria-invalid={!!errors.first}
                aria-describedby={errors.first ? "profile-first-name-error" : undefined}
                className="h-12 rounded-xl text-base"
              />
              {errors.first && (
                <p id="profile-first-name-error" className="text-sm font-medium text-destructive">{errors.first}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-last-name" className="font-bold">Last name</Label>
              <Input
                id="profile-last-name"
                autoComplete="family-name"
                required
                maxLength={NAME_MAX + 20}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                aria-invalid={!!errors.last}
                aria-describedby={errors.last ? "profile-last-name-error" : undefined}
                className="h-12 rounded-xl text-base"
              />
              {errors.last && (
                <p id="profile-last-name-error" className="text-sm font-medium text-destructive">{errors.last}</p>
              )}
            </div>
            {saveError && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{saveError}</p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {!required && (
                <Button type="button" variant="outline" onClick={onClose} className="rounded-full font-bold">
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={update.isPending} className="rounded-full font-bold">
                {update.isPending ? "Saving..." : saveError ? "Try again" : "Save name"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
