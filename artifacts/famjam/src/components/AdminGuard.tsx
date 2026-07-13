import { useAuth } from "@clerk/react";
import { useAdminGetReports, getAdminGetReportsQueryKey } from "@workspace/api-client-react";
import { Loader2, ShieldAlert } from "lucide-react";
import { ReactNode } from "react";
import { Redirect } from "wouter";
import { AdminLayout } from "./AdminLayout";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  
  const { data, isLoading, error } = useAdminGetReports({
    query: {
      queryKey: getAdminGetReportsQueryKey(),
      retry: false,
      enabled: !!isSignedIn,
    }
  });

  if (!isLoaded || (isSignedIn && isLoading)) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-background text-foreground">
        <ShieldAlert className="w-16 h-16 text-destructive mb-4" />
        <h1 className="font-serif text-3xl font-bold mb-2">Not Authorized</h1>
        <p className="text-muted-foreground mb-6">You do not have permission to view the admin dashboard.</p>
        <a href="/" className="bg-primary text-primary-foreground px-6 py-2 rounded-full font-bold">Return Home</a>
      </div>
    );
  }

  return <AdminLayout>{children}</AdminLayout>;
}
