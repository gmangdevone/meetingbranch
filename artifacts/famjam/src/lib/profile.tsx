import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyProfile,
  getGetMyProfileQueryKey,
  useGetMyAccess,
  getGetMyAccessQueryKey,
  type MemberProfile,
} from "@workspace/api-client-react";
import { NameDialog } from "../components/NameDialog";

export const NAME_MAX = 100;

/** Trim and validate one name field. Returns an error message or null. */
export function validateName(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return `${label} is required.`;
  if (v.length > NAME_MAX) return `${label} must be ${NAME_MAX} characters or fewer.`;
  return null;
}

export function usableName(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function needsName(profile: MemberProfile | undefined | null): boolean {
  if (!profile) return false;
  return !usableName(profile.firstName) || !usableName(profile.lastName);
}

/** Greeting text using the first name only, or null when it cannot be shown. */
export function greetingFor(firstName: string | null | undefined, isNew: boolean): string | null {
  const first = usableName(firstName);
  if (!first) return null;
  return isNew ? `Hi ${first}` : `Welcome back ${first}`;
}

export function profileQueryKey(userId: string | null | undefined, sessionId: string | null | undefined) {
  return [...getGetMyProfileQueryKey(), userId ?? "", sessionId ?? ""] as const;
}

/**
 * Freeze the "new account" flag for the duration of a login session so the
 * greeting wording never flips mid-session (e.g. after saving a name).
 */
function stableIsNew(userId: string, sessionId: string, serverValue: boolean): boolean {
  const key = `mb-greeting-new:${userId}:${sessionId}`;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored === "1" || stored === "0") return stored === "1";
    window.sessionStorage.setItem(key, serverValue ? "1" : "0");
  } catch {
    /* storage unavailable: fall back to server value */
  }
  return serverValue;
}

type ProfileContextValue = {
  /** Profile for the current user+session; undefined while signed out/loading. */
  profile: MemberProfile | undefined;
  /** Greeting ("Hi Kelly" / "Welcome back Kelly") or null if not available. */
  greeting: string | null;
  /** Opens the app-owned name editor; null when no provider/signed out. */
  openNameEditor: (() => void) | null;
};

const ProfileContext = createContext<ProfileContextValue>({
  profile: undefined,
  greeting: null,
  openNameEditor: null,
});

export function useProfile() {
  return useContext(ProfileContext);
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const queryClient = useQueryClient();
  const active = !!(isLoaded && isSignedIn && userId && sessionId);
  const queryKey = profileQueryKey(userId, sessionId);
  const [editing, setEditing] = useState(false);

  const profileQuery = useGetMyProfile({
    query: {
      queryKey,
      enabled: active,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  });

  // Respect the platform access gate: never prompt a locked-out account.
  const { data: access } = useGetMyAccess({
    query: { queryKey: getGetMyAccessQueryKey(), enabled: active },
  });

  const profile = active ? profileQuery.data : undefined;
  const allowed = access?.allowed === true;
  const mustOnboard = active && allowed && (profileQuery.isError || needsName(profile));

  const greeting = useMemo(() => {
    if (!active || !profile || !userId || !sessionId) return null;
    return greetingFor(profile.firstName, stableIsNew(userId, sessionId, profile.isNewAccount));
  }, [active, profile, userId, sessionId]);

  const openNameEditor = useCallback(() => setEditing(true), []);

  const onSaved = useCallback(
    (saved: MemberProfile) => {
      queryClient.setQueryData(profileQueryKey(userId, sessionId), saved);
      void queryClient.invalidateQueries({ queryKey: profileQueryKey(userId, sessionId) });
      setEditing(false);
    },
    [queryClient, userId, sessionId],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, greeting, openNameEditor: active ? openNameEditor : null }),
    [profile, greeting, active, openNameEditor],
  );

  const dialogOpen = active && (mustOnboard || editing);

  return (
    <ProfileContext.Provider value={value}>
      {children}
      {dialogOpen && (
        <NameDialog
          key={`${userId}:${sessionId}`}
          required={mustOnboard}
          profile={profile}
          loadError={profileQuery.isError && !profile}
          onRetryLoad={() => void profileQuery.refetch()}
          retrying={profileQuery.isFetching}
          onSaved={onSaved}
          onClose={() => setEditing(false)}
        />
      )}
    </ProfileContext.Provider>
  );
}
