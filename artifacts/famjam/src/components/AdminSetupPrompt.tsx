import { useAuth } from "@clerk/react";
import {
  adminSetup,
  useGetAdminSetupStatus,
  getGetAdminSetupStatusQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

/**
 * First-run bootstrap prompt. Shows a one-click "Set up admin access" card only
 * while no administrator exists yet. Clicking it claims admin via the setup
 * route and unlocks the admin dashboard. Once any admin exists, the prompt
 * disappears for everyone.
 */
export function AdminSetupPrompt() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetAdminSetupStatus({
    query: {
      queryKey: getGetAdminSetupStatusQueryKey(),
      enabled: !!isSignedIn,
      retry: false,
    },
  });

  const setupMutation = useMutation({
    mutationFn: () => adminSetup(),
    onSuccess: async () => {
      // Reload every cached query so the admin dashboard's own gate (which
      // reads /admin/reports) re-evaluates with the freshly granted role.
      await queryClient.invalidateQueries();
      setLocation("/admin");
    },
    onError: () => {
      // Setup may have been claimed by someone else in the meantime — refresh
      // the status so the prompt hides if an admin now exists.
      queryClient.invalidateQueries({
        queryKey: getGetAdminSetupStatusQueryKey(),
      });
    },
  });

  // Hide while loading, when signed out, or once an admin already exists.
  if (!isSignedIn || isLoading || !data || data.adminExists) {
    return null;
  }

  return (
    <div className="bg-secondary/5 border border-secondary/20 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="p-3 bg-secondary/10 rounded-2xl text-secondary shrink-0 w-fit">
        <ShieldCheck className="w-6 h-6" />
      </div>
      <div className="flex-1">
        <h3 className="font-serif text-xl font-bold text-secondary">
          Set up admin access
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          No administrator has been set up yet. Claim it now to unlock the admin
          dashboard for managing registrations, announcements, and the schedule.
        </p>
        {setupMutation.isError && (
          <p className="text-sm text-destructive font-medium mt-2">
            Couldn't set up admin access — it may already be complete. Please
            refresh and try again.
          </p>
        )}
      </div>
      <button
        onClick={() => setupMutation.mutate()}
        disabled={setupMutation.isPending}
        className="bg-secondary text-secondary-foreground px-6 py-3 rounded-full font-bold shadow-sm hover:bg-secondary/90 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
      >
        {setupMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Setting up…
          </>
        ) : (
          "Become the administrator"
        )}
      </button>
    </div>
  );
}
