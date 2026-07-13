import { useLocation } from "wouter";
import { useListReunionAnnouncements, getListReunionAnnouncementsQueryKey, useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Bell, Pin, ArrowLeft, Info } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";

export function ReunionAnnouncements({ params }: { params: { code: string } }) {
  const code = params.code?.toUpperCase();
  const [, setLocation] = useLocation();

  const { data: reunion, isLoading: loadingReunion } = useGetReunionByCode(code, {
    query: {  enabled: !!code, retry: false , queryKey: getGetReunionByCodeQueryKey(code) }
  });

  const { data: announcements, isLoading: loadingAnnouncements } = useListReunionAnnouncements(reunion?.id ?? 0, {
    query: {  enabled: !!reunion?.id , queryKey: getListReunionAnnouncementsQueryKey(reunion?.id ?? 0) }
  });

  if (loadingReunion || loadingAnnouncements) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Skeleton className="h-10 w-48 mb-8" />
        <Skeleton className="h-40 rounded-3xl mb-4" />
        <Skeleton className="h-32 rounded-3xl mb-4" />
      </div>
    );
  }

  if (!reunion) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold">Reunion Not Found</h1>
        <Button onClick={() => setLocation("/dashboard")} className="mt-4">Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <Button 
        variant="ghost" 
        onClick={() => setLocation(`/r/${reunion.code}`)} 
        className="mb-6 -ml-4 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
      </Button>

      <div className="mb-10 flex items-center gap-4">
        <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 w-16 h-16 rounded-full flex items-center justify-center shrink-0">
          <Bell className="w-8 h-8" />
        </div>
        <div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground">Announcements</h1>
          <p className="text-muted-foreground">News and updates for {reunion.name}</p>
        </div>
      </div>

      {!announcements || announcements.length === 0 ? (
        <div className="bg-card border shadow-sm rounded-3xl p-12 text-center flex flex-col items-center">
          <Info className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="font-bold text-lg mb-2">No announcements yet</h3>
          <p className="text-muted-foreground">Check back later for updates from the organizers.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {announcements.map((announcement, idx) => (
            <div 
              key={announcement.id} 
              className={`bg-card border shadow-sm rounded-3xl p-6 relative overflow-hidden animate-in slide-in-from-bottom-4 ${
                announcement.pinned ? 'border-amber-200 dark:border-amber-900/50 shadow-amber-100/50 dark:shadow-none' : ''
              }`}
              style={{ animationDelay: `${idx * 50}ms`, animationFillMode: "both" }}
            >
              {announcement.pinned && (
                <div className="absolute top-0 right-0 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-500 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-bl-xl flex items-center">
                  <Pin className="w-3 h-3 mr-1" /> Pinned
                </div>
              )}
              
              <div className="mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                  {format(new Date(announcement.createdAt), 'MMM d, yyyy')}
                </span>
              </div>
              <h3 className="font-bold text-xl mb-3 pr-16">{announcement.title}</h3>
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 whitespace-pre-wrap">
                {announcement.body}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
