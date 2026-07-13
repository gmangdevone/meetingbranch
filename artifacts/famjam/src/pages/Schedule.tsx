import { useListScheduleItems } from "@workspace/api-client-react";
import { CalendarDays, MapPin, Clock } from "lucide-react";
import { ScheduleItem } from "@workspace/api-client-react";

export function Schedule() {
  const { data: scheduleItems, isLoading } = useListScheduleItems();

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto pb-12 animate-pulse space-y-8">
        <div className="h-12 w-64 bg-muted rounded-xl" />
        <div className="space-y-4">
          <div className="h-8 w-32 bg-muted rounded-lg" />
          <div className="h-32 bg-muted rounded-2xl" />
          <div className="h-32 bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  // Group by day
  const grouped = scheduleItems?.reduce((acc, item) => {
    if (!acc[item.day]) acc[item.day] = [];
    acc[item.day].push(item);
    return acc;
  }, {} as Record<string, ScheduleItem[]>) || {};

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="mb-10">
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-secondary mb-4 flex items-center gap-4">
          <CalendarDays className="w-10 h-10 text-primary" />
          The Itinerary
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Here is what we have planned for the reunion weekend. Times and locations are subject to change, so check back here as we get closer to the date!
        </p>
      </div>

      <div className="space-y-12">
        {Object.entries(grouped).map(([day, items], dayIdx) => (
          <div key={day} className="animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${dayIdx * 100}ms` }}>
            <div className="sticky top-[72px] md:top-20 z-40 bg-background/90 backdrop-blur-md py-4 mb-4 border-b">
              <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
                {day}
              </h2>
            </div>
            
            <div className="flex flex-col gap-4">
              {items.map((item, idx) => (
                <div key={item.id} className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col md:flex-row md:items-start gap-4 md:gap-8 hover-elevate transition-all">
                  <div className="flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-1 min-w-[140px] text-primary">
                    <Clock className="w-5 h-5 md:hidden" />
                    <span className="font-bold text-xl whitespace-nowrap">{item.startTime}</span>
                    {item.endTime && <span className="text-muted-foreground font-medium text-sm">to {item.endTime}</span>}
                  </div>
                  
                  <div className="flex-1">
                    <h3 className="font-serif text-2xl font-bold text-foreground mb-2">{item.title}</h3>
                    {item.description && (
                      <p className="text-muted-foreground leading-relaxed mb-4">
                        {item.description}
                      </p>
                    )}
                    {item.location && (
                      <div className="inline-flex items-center gap-2 bg-input/40 px-3 py-1.5 rounded-lg text-sm font-medium text-foreground/80">
                        <MapPin className="w-4 h-4 text-primary" />
                        {item.location}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!scheduleItems?.length && (
          <div className="bg-card border shadow-sm rounded-3xl p-12 text-center">
            <CalendarDays className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">Schedule Coming Soon</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              We are still finalizing the details for the reunion. Check back later for the full itinerary!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
