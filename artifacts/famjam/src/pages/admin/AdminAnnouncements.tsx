import { useState } from "react";
import { useListAnnouncements, useAdminCreateAnnouncement, useAdminUpdateAnnouncement, useAdminDeleteAnnouncement } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Bell, Plus, Edit, Trash2, Pin, Loader2 } from "lucide-react";
import { queryClient } from "../../lib/queryClient";

export function AdminAnnouncements() {
  const { data: announcements, isLoading } = useListAnnouncements();
  
  const createAnn = useAdminCreateAnnouncement();
  const updateAnn = useAdminUpdateAnnouncement();
  const deleteAnn = useAdminDeleteAnnouncement();

  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);

  const resetForm = () => {
    setIsEditing(false);
    setEditId(null);
    setTitle("");
    setBody("");
    setIsPinned(false);
  };

  const handleEdit = (ann: any) => {
    setEditId(ann.id);
    setTitle(ann.title);
    setBody(ann.body);
    setIsPinned(ann.pinned ?? false);
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this announcement?")) {
      await deleteAnn.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    if (editId) {
      await updateAnn.mutateAsync({ id: editId, data: { title, body, pinned: isPinned } });
    } else {
      await createAnn.mutateAsync({ data: { title, body, pinned: isPinned } });
    }
    
    queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
    resetForm();
  };

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary p-3 rounded-2xl">
            <Bell className="w-8 h-8" />
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-secondary">Announcements</h1>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="bg-primary text-primary-foreground px-5 py-2.5 rounded-full font-bold text-sm md:text-base shadow-sm hover:bg-primary/90 flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <Plus className="w-4 h-4" />
            New Announcement
          </button>
        )}
      </div>

      {isEditing && (
        <div className="bg-card border shadow-lg rounded-3xl p-6 mb-4 animate-in fade-in slide-in-from-top-4">
          <h2 className="font-bold text-xl mb-4">{editId ? "Edit Announcement" : "Create Announcement"}</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-bold mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="E.g. Schedule Update for Friday"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-1">Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full bg-muted/50 border rounded-xl px-4 py-3 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                placeholder="Write your announcement here..."
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPinned"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="w-5 h-5 rounded border-muted text-primary focus:ring-primary"
              />
              <label htmlFor="isPinned" className="text-sm font-medium cursor-pointer flex items-center gap-1">
                <Pin className="w-4 h-4 text-primary" /> Pin to top
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-5 py-2.5 rounded-full font-bold text-foreground/70 hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createAnn.isPending || updateAnn.isPending}
                className="bg-primary text-primary-foreground px-6 py-2.5 rounded-full font-bold shadow-md hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-70 flex items-center gap-2"
              >
                {(createAnn.isPending || updateAnn.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                {editId ? "Save Changes" : "Post Announcement"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card border shadow-sm rounded-3xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b">
              <tr>
                <th className="px-6 py-4 font-bold">Title</th>
                <th className="px-6 py-4 font-bold">Date</th>
                <th className="px-6 py-4 font-bold text-center">Status</th>
                <th className="px-6 py-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </td>
                </tr>
              ) : !announcements?.length ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                    No announcements posted yet.
                  </td>
                </tr>
              ) : (
                announcements.map((ann) => (
                  <tr key={ann.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-base text-foreground mb-1">{ann.title}</div>
                      <div className="text-muted-foreground line-clamp-1 max-w-md">{ann.body}</div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                      {format(new Date(ann.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {ann.pinned && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                          <Pin className="w-3 h-3" /> Pinned
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleEdit(ann)}
                          className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(ann.id)}
                          className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
