import { ExternalLink, Globe, MapPin } from "lucide-react";
import { mapHref, safeHttpUrl, type ActivityDetails } from "../../lib/activityDetails";

export type DirectoryActivity = { id: number; label: string } & ActivityDetails;

export type DirectoryCategory = {
  id: number;
  title: string;
  description?: string | null;
  activities: DirectoryActivity[];
};

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
            {category.activities.map((activity) => {
              const site = safeHttpUrl(activity.websiteUrl);
              const map = mapHref(activity);
              const address = activity.address?.trim();
              return (
                <li key={activity.id} className="border rounded-xl p-4 flex flex-col gap-1.5">
                  <span className="font-medium">{activity.label}</span>
                  {activity.description?.trim() && <p className="text-sm text-muted-foreground whitespace-pre-line">{activity.description}</p>}
                  {address && (
                    <p className="text-sm flex items-start gap-1.5">
                      <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{address}</span>
                    </p>
                  )}
                  {(site || map) && (
                    <div className="flex flex-wrap gap-3 mt-1 text-sm">
                      {site && (
                        <a href={site} target="_blank" rel="noopener noreferrer" aria-label={`Website for ${activity.label} (opens in new tab)`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                          <Globe className="w-4 h-4" aria-hidden="true" /> Website
                        </a>
                      )}
                      {map && (
                        <a href={map} target="_blank" rel="noopener noreferrer" aria-label={`View map for ${activity.label} (opens in new tab)`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                          <ExternalLink className="w-4 h-4" aria-hidden="true" /> View map
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
