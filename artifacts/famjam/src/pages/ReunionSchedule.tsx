import { useLocation } from "wouter";
import { useListReunionSchedule, getListReunionScheduleQueryKey, useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, ArrowLeft } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";

export function ReunionSchedule({ params }: { params: { code: string } }) {
  const code = params.code?.toUpperCase();
  const [, setLocation] = useLocation();

  const { data: reunion, isLoading: loadingReunion } = useGetReunionByCode(code, {
    query: {  enabled: !!code, retry: false , queryKey: getGetReunionByCodeQueryKey(code) }
  });

  const { data: schedule, isLoading: loadingSchedule } = useListReunionSchedule(reunion?.id ?? 0, {
    query: {  enabled: !!reunion?.id , queryKey: getListReunionScheduleQueryKey(reunion?.id ?? 0) }
  });

  if (loadingReunion || loadingSchedule) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <Skeleton className="h-10 w-48 mb-8" />
        <Skeleton className="h-32 rounded-3xl mb-4" />
        <Skeleton className="h-32 rounded-3xl mb-4" />
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

  // Group schedule items by day
  const groupedSchedule = schedule?.reduce((acc, item) => {
    if (!acc[item.day]) acc[item.day] = [];
    acc[item.day].push(item);
    return acc;
  }, {} as Record<string, typeof schedule>);

  // Sort days chronologically (assuming they are in format "Thursday July 17" or ISO dates)
  // For simplicity since it's a string day label, we rely on the backend sortOrder or just display in order they appear
  const days = Object.keys(groupedSchedule || {});

  return (
    <div className="max-w-3xl mx-auto py-8">
      <Button 
        variant="ghost" 
        onClick={() => setLocation(`/r/${reunion.code}`)} 
        className="mb-6 -ml-4 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
      </Button>

      <div className="mb-10 text-center">
        <div className="bg-secondary/10 text-secondary w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <CalendarDays className="w-8 h-8" />
        </div>
        <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3 text-foreground">Itinerary</h1>
        <p className="text-lg text-muted-foreground">What's happening at {reunion.name}</p>
      </div>

      {!schedule || schedule.length === 0 ? (
        <div className="bg-card border shadow-sm rounded-3xl p-12 text-center text-muted-foreground">
          The schedule hasn't been posted yet. Check back soon!
        </div>
      ) : (
        <div className="space-y-12">
          {days.map((day, dayIndex) => (
            <div key={day} className="animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: `${dayIndex * 100}ms`, animationFillMode: "both" }}>
              <div className="sticky top-[72px] bg-background/95 backdrop-blur-sm py-4 z-10 border-b mb-6">
                <h2 className="font-serif text-2xl font-bold text-secondary">{day}</h2>
              </div>
              
              <div className="space-y-4">
                {groupedSchedule![day].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((item) => (
                  <div key={item.id} className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col md:flex-row gap-6 hover:shadow-md transition-shadow group relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-2 bg-secondary/20 group-hover:bg-secondary transition-colors" />
                    
                    <div className="md:w-1/3 flex flex-col gap-2">
                      <div className="flex items-center text-foreground font-bold text-lg">
                        <Clock className="w-5 h-5 mr-2 text-secondary" />
                        {item.startTime} {item.endTime && `- ${item.endTime}`}
                      </div>
                      {item.location && (
                        <div className="flex items-start text-muted-foreground text-sm">
                          <MapPin className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                          <span>{item.location}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="md:w-2/3 border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-6">
                      <h3 className="font-bold text-xl mb-2">{item.title}</h3>
                      {item.description && (
                        <p className="text-muted-foreground">{item.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
