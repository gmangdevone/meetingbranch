import { useAuth } from "@clerk/react";
import { AlertTriangle, ArrowLeft, ClipboardList } from "lucide-react";
import { Link } from "wouter";
import {
  getGetReunionByCodeQueryKey,
  getListMemberActivityChoicesQueryKey,
  useGetReunionByCode,
  useListMemberActivityChoices,
} from "@workspace/api-client-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { ActivityDirectory } from "../components/activities/ActivityDirectory";
import { eventCodePath } from "../lib/eventCode";

export function ReunionActivities({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  const { isSignedIn } = useAuth();
  const { data: reunion, isLoading: loadingReunion, isError } = useGetReunionByCode(code, {
    query: { queryKey: getGetReunionByCodeQueryKey(code) },
  });
  const reunionId = reunion?.id ?? 0;
  const groupsQuery = useListMemberActivityChoices(reunionId, {
    query: {
      enabled: Boolean(reunion?.id && isSignedIn),
      queryKey: getListMemberActivityChoicesQueryKey(reunionId),
    },
  });

  if (loadingReunion || (isSignedIn && groupsQuery.isLoading)) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-6 py-8">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }
  if (isError || !reunion) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold mb-4">Reunion not found</h1>
        <Link href="/join" className="text-primary font-bold hover:underline">Try another code</Link>
      </div>
    );
  }

  const categories = (groupsQuery.data?.groups ?? []).map(({ group }) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    activities: group.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description ?? null,
      address: option.address ?? null,
      websiteUrl: option.websiteUrl ?? null,
      mapUrl: option.mapUrl ?? null,
    })),
  }));

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8 py-8 pb-16">
      <div>
        <Link href={eventCodePath(reunion.code)} className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to {reunion.name}
        </Link>
        <h1 className="font-serif text-4xl font-bold flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-primary" /> Activities
        </h1>
        <p className="text-muted-foreground mt-2">Things to do in the area while the family is in town.</p>
      </div>

      {!isSignedIn ? (
        <div className="bg-card border shadow-sm rounded-3xl p-10 text-center">
          <h3 className="font-bold text-lg mb-2">Sign in to see things to do</h3>
          <p className="text-muted-foreground mb-4">Sign in to browse the activities organizers have gathered.</p>
          <Link href="/sign-in" className="text-primary font-bold hover:underline">Sign In</Link>
        </div>
      ) : groupsQuery.isError ? (
        <div className="bg-card border border-destructive/30 shadow-sm rounded-3xl p-10 text-center flex flex-col items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-destructive" />
          <h3 className="font-bold text-lg">We couldn't load activities</h3>
          <p className="text-muted-foreground">Something went wrong on our end. Please try again.</p>
          <Button variant="outline" className="rounded-full" onClick={() => groupsQuery.refetch()}>Try again</Button>
        </div>
      ) : (
        <ActivityDirectory categories={categories} />
      )}
    </div>
  );
}
