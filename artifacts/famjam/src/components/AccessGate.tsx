import { useClerk } from "@clerk/react";
import { useGetMyAccess, getGetMyAccessQueryKey } from "@workspace/api-client-react";
import { Layout } from "./Layout";

/**
 * Gates signed-in pages on GET /me/access. The server decides exemption
 * (admins, organizers, testers, and the platform payment owner); the UI only
 * honors `allowed`, never re-deriving it from admin/organizer flags.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  const { data: access, isLoading } = useGetMyAccess({
    query: { queryKey: getGetMyAccessQueryKey() }
  });

  if (isLoading) {
    return <Layout><div className="flex justify-center py-20 text-muted-foreground">Checking access...</div></Layout>;
  }

  if (access && !access.allowed) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto py-20 text-center flex flex-col items-center">
          <div className="bg-destructive/10 text-destructive w-20 h-20 rounded-full flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <h1 className="font-serif text-4xl font-bold mb-4">Temporarily Closed</h1>
          <p className="text-lg text-muted-foreground mb-8">
            The platform is currently locked down for testing and maintenance. Only organizers and testing accounts are permitted right now. Please check back later!
          </p>
          <button 
            onClick={() => signOut()} 
            className="text-primary font-bold hover:underline"
          >
            Sign out
          </button>
        </div>
      </Layout>
    );
  }

  return <>{children}</>;
}
