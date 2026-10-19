import { useState } from "react";
import { useListReunionAnnouncements, useCreateAnnouncement, useUpdateAnnouncement, useDeleteAnnouncement, getListReunionAnnouncementsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { AnnouncementEditor } from "../../components/AnnouncementEditor";
import { AnnouncementBody } from "../../components/AnnouncementBody";
import { announcementLinks, safeAnnouncementUrl } from "../../lib/announcementLinks";
import { Switch } from "../../components/ui/switch";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../../components/ui/dialog";
import { Trash2, Edit2, Pin, Plus, Bell } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "../../hooks/use-toast";
import type { Announcement } from "@workspace/api-client-react";

export function OrganizerAnnouncements({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [linkEditing, setLinkEditing] = useState(false);

  const { data: announcements, isLoading } = useListReunionAnnouncements(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionAnnouncementsQueryKey(reunionId) }
  });

  const createMutation = useCreateAnnouncement();
  const updateMutation = useUpdateAnnouncement();
  const deleteMutation = useDeleteAnnouncement();
  const saving = createMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setSaveError("");
    setLinkEditing(false);
    setTitle("");
    setBody("");
    setPinned(false);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setSaveError("");
    setTitle(a.title);
    setBody(a.body);
    setPinned(!!a.pinned);
    setEditingId(a.id);
    setIsOpen(true);
  };

  const handleSave = () => {
    setSaveError("");
    if (!title.trim() || !body.trim()) {
      setSaveError("Title and message are required.");
      return;
    }
    if (announcementLinks(body).some(link => !safeAnnouncementUrl(link.url))) {
      setSaveError("A message link has an invalid URL. Edit or remove it before posting.");
      return;
    }

    const payload = { title, body, pinned };
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReunionAnnouncementsQueryKey(reunionId) });
        setIsOpen(false);
        toast({ title: editingId ? "Announcement updated" : "Announcement created" });
      },
      onError: () => setSaveError("Could not save the announcement. Your edits are still here; please try again."),
    };

    if (editingId) {
      updateMutation.mutate({ reunionId, announcementId: editingId, data: payload }, opts);
    } else {
      createMutation.mutate({ reunionId, data: payload }, opts);
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this announcement?")) {
      deleteMutation.mutate({ reunionId, announcementId: id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReunionAnnouncementsQueryKey(reunionId) });
          toast({ title: "Deleted" });
        }
      });
    }
  };

  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="announcements">
      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-center">
          <h1 className="font-serif text-3xl font-bold">Announcements</h1>
          <Button onClick={openCreate} className="rounded-full">
            <Plus className="w-4 h-4 mr-2" /> New Post
          </Button>
        </div>

        <Dialog open={isOpen} onOpenChange={(open) => { if (saving) return; setIsOpen(open); if(!open) resetForm(); }}>
          <DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-y-auto rounded-3xl">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">{editingId ? "Edit Announcement" : "Create Announcement"}</DialogTitle>
            </DialogHeader>
            <fieldset disabled={saving} className="space-y-4 py-4 min-w-0">
              <div className="space-y-2">
                <Label htmlFor="announcement-title">Title</Label>
                <Input id="announcement-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Important Update" className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <AnnouncementEditor value={body} onChange={setBody} disabled={saving} onLinkEditing={setLinkEditing} />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Switch id="pinned" checked={pinned} onCheckedChange={setPinned} />
                <Label htmlFor="pinned" className="flex items-center gap-1 cursor-pointer">
                  <Pin className="w-4 h-4" /> Pin to top
                </Label>
              </div>
            </fieldset>
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setIsOpen(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleSave} disabled={saving || linkEditing} className="rounded-xl">
                {editingId ? "Save Changes" : "Post Announcement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : !announcements || announcements.length === 0 ? (
          <div className="bg-card border border-dashed rounded-3xl p-12 text-center text-muted-foreground flex flex-col items-center">
            <Bell className="w-12 h-12 mb-4 opacity-20" />
            <p>No announcements published yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {announcements.map((a) => (
              <div key={a.id} className={`bg-card border shadow-sm rounded-3xl p-6 relative group ${a.pinned ? 'border-amber-200' : ''}`}>
                <div className="absolute top-4 right-4 flex opacity-0 group-hover:opacity-100 transition-opacity gap-2">
                  <Button aria-label={`Edit announcement ${a.title}`} size="icon" variant="secondary" className="h-8 w-8 rounded-lg" onClick={() => openEdit(a)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button aria-label={`Delete announcement ${a.title}`} size="icon" variant="destructive" className="h-8 w-8 rounded-lg" onClick={() => handleDelete(a.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="flex items-center gap-3 mb-2">
                  {a.pinned && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded flex items-center"><Pin className="w-3 h-3 mr-1"/> Pinned</span>}
                  <span className="text-xs text-muted-foreground">{format(new Date(a.createdAt), 'MMM d, yyyy - h:mm a')}</span>
                </div>
                <h3 className="font-bold text-xl mb-2 pr-20">{a.title}</h3>
                <p className="text-muted-foreground whitespace-pre-wrap break-words"><AnnouncementBody body={a.body} /></p>
              </div>
            ))}
          </div>
        )}
      </div>
    </OrganizerLayout>
  );
}
