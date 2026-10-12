import { MapPin } from "lucide-react";

export type DirectoryCategory = {
  id: number;
  title: string;
  description?: string | null;
  activities: { id: number; label: string }[];
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
            {category.activities.map((activity) => (
              <li key={activity.id} className="border rounded-xl p-4 flex items-center gap-3">
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                <span className="font-medium">{activity.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
