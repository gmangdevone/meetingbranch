import { useListAnnouncements } from "@workspace/api-client-react";
import { Bell, Pin, MessageSquare } from "lucide-react";
import { format } from "date-fns";

export function Announcements() {
  const { data: announcements, isLoading } = useListAnnouncements();

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto pb-12 animate-pulse space-y-6">
        <div className="h-12 w-64 bg-muted rounded-xl" />
        {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-muted rounded-3xl" />)}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="mb-10 flex items-center gap-4">
        <div className="bg-primary text-primary-foreground w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg">
          <Bell className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground">Family News</h1>
          <p className="text-muted-foreground font-medium mt-1">Updates and announcements from the committee</p>
        </div>
      </div>

      <div className="space-y-6">
        {announcements?.map((announcement, idx) => (
          <div 
            key={announcement.id} 
            className={`bg-card border shadow-sm rounded-3xl p-6 md:p-8 hover-elevate transition-all relative overflow-hidden ${
              announcement.pinned ? 'border-primary/40 ring-1 ring-primary/20' : ''
            }`}
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            {announcement.pinned && (
              <div className="absolute top-0 right-0 bg-primary/10 text-primary px-4 py-1.5 rounded-bl-2xl rounded-tr-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Pin className="w-3.5 h-3.5" /> Pinned
              </div>
            )}
            
            <div className="flex items-start gap-4 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${announcement.pinned ? 'bg-primary/20 text-primary' : 'bg-input/50 text-muted-foreground'}`}>
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className={announcement.pinned ? 'pr-20' : ''}>
                <h3 className="font-serif text-2xl font-bold text-foreground">{announcement.title}</h3>
                <span className="text-sm font-medium text-muted-foreground">
                  {format(new Date(announcement.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            </div>
            
            <div className="pl-14 prose prose-neutral prose-p:leading-relaxed text-foreground/80 max-w-none">
              {announcement.body.split('\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>
        ))}

        {!announcements?.length && (
          <div className="bg-card border shadow-sm rounded-3xl p-12 text-center">
            <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">No News Yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              We'll post important updates and announcements here as the reunion approaches.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
