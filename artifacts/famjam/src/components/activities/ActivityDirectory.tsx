import { MapPin } from "lucide-react";
import { safeHttpUrl } from "../../lib/homeContent";
import type { ActivityChoiceOptionInput } from "@workspace/api-client-react";

export type DirectoryCategory = {
  id: number;
  title: string;
  description?: string | null;
  activities: (ActivityChoiceOptionInput & { id: number })[];
};

export function ActivityDetails({ activity }: { activity: ActivityChoiceOptionInput }) {
  const mapUrl = safeHttpUrl(activity.mapUrl) || (activity.address?.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address.trim())}`
    : null);
  const websiteUrl = safeHttpUrl(activity.websiteUrl);
  return (
    <div className="min-w-0 break-words space-y-2">
      <h3 className="font-medium flex gap-2 items-center"><MapPin aria-hidden="true" className="w-4 h-4 text-primary shrink-0" />{activity.label}</h3>
      {activity.description && <p className="text-sm text-muted-foreground whitespace-pre-line">{activity.description}</p>}
      {activity.address && <p className="text-sm whitespace-pre-line">{activity.address}</p>}
      <div className="flex flex-wrap gap-4 text-sm">
        {mapUrl && <a className="text-primary underline rounded focus-visible:outline focus-visible:outline-2" href={mapUrl} target="_blank" rel="noopener noreferrer" aria-label={`View map for ${activity.label} (opens in new tab)`}>View map<span className="sr-only"> (opens in new tab)</span></a>}
        {websiteUrl && <a className="text-primary underline rounded focus-visible:outline focus-visible:outline-2" href={websiteUrl} target="_blank" rel="noopener noreferrer" aria-label={`Visit website for ${activity.label} (opens in new tab)`}>Visit website<span className="sr-only"> (opens in new tab)</span></a>}
      </div>
    </div>
  );
}
/** Read-only list of things to do, grouped by category. No selection controls. */
export function ActivityDirectory({ categories }: { categories: DirectoryCategory[] }) {
  if (!categories.length) {
    return (
      <div data-testid="activities-empty" className="bg-card border shadow-sm rounded-3xl p-10 text-center">
        <h3 className="font-bold text-lg mb-2">No things to do listed yet</h3>
        <p className="text-muted-foreground">Organizers will add local activities here as plans come together.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {categories.map((category) => (
        <section key={category.id} data-testid="activity-category" className="bg-card border shadow-sm rounded-3xl p-6 sm:p-8 flex flex-col gap-4">
          <div>
            <h2 className="font-serif text-2xl font-bold">{category.title}</h2>
            {category.description && <p className="text-muted-foreground mt-2 whitespace-pre-line">{category.description}</p>}
          </div>
          <ul className="flex flex-col gap-2">
            {category.activities.map((activity) => (
              <li key={activity.id} className="border rounded-xl p-4">
                <ActivityDetails activity={activity} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
