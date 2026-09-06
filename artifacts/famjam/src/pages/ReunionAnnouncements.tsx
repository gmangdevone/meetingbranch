import { useLocation } from "wouter";
import { useListReunionAnnouncements, getListReunionAnnouncementsQueryKey, useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Bell, Pin, ArrowLeft, Info } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { eventCodePath } from "../lib/eventCode";

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
        onClick={() => setLocation(eventCodePath(reunion.code))}
        className="mb-6 -ml-4 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
      </Button>

      <div className="mb-10 flex items-center gap-4 rounded-3xl border border-[#e5e0d5] bg-[#F7F4ED] p-6 shadow-sm">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm">
          <Bell className="w-8 h-8" />
        </div>
        <div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-slate-950">Announcements</h1>
          <p className="text-slate-600">News and updates for {reunion.name}</p>
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
              className={`relative overflow-hidden rounded-3xl border p-6 shadow-sm animate-in slide-in-from-bottom-4 ${
                idx % 2 === 0
                  ? 'border-[#a63b3b] bg-gradient-to-br from-[#BF4646] to-[#8f3030] text-white'
                  : 'border-[#6898a2] bg-gradient-to-br from-[#7EACB5] to-[#a8cbd1] text-slate-950'
              } ${
                announcement.pinned ? 'ring-2 ring-amber-300/80' : ''
              }`}
              style={{ animationDelay: `${idx * 50}ms`, animationFillMode: "both" }}
            >
              {announcement.pinned && (
                <div className="absolute top-0 right-0 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-500 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-bl-xl flex items-center">
                  <Pin className="w-3 h-3 mr-1" /> Pinned
                </div>
              )}
              
              <div className="mb-2">
                <span className={`text-xs font-medium uppercase tracking-widest ${
                  idx % 2 === 0 ? 'text-white/80' : 'text-slate-800/75'
                }`}>
                  {format(new Date(announcement.createdAt), 'MMM d, yyyy')}
                </span>
              </div>
              <h3 className="font-bold text-xl mb-3 pr-16">{announcement.title}</h3>
              <div className={`prose prose-sm max-w-none whitespace-pre-wrap ${
                idx % 2 === 0 ? 'prose-invert text-white/90' : 'text-slate-900/85'
              }`}>
                {announcement.body}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
