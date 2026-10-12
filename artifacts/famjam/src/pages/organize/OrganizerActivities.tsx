import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  getListManageActivityChoicesQueryKey,
  getListMemberActivityChoicesQueryKey,
  useAddActivityChoiceOption,
  useCreateActivityChoiceGroup,
  useDeleteActivityChoiceGroup,
  useDeleteActivityChoiceOption,
  useListManageActivityChoices,
  useUpdateActivityChoiceGroup,
  useUpdateActivityChoiceOption,
} from "@workspace/api-client-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { OrganizerLayout } from "./OrganizerLayout";

type EditItem = { id?: number; label: string };
type EditTarget = { id: number; title: string; description: string; items: EditItem[]; removed: number[] };
type ConfirmTarget =
  | { kind: "group"; groupId: number; title: string }
  | { kind: "item"; groupId: number; itemId: number; title: string };

const errMsg = (error: any, fallback: string) => error?.data?.error || fallback;

export function OrganizerActivities({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const queryClient = useQueryClient();
  const { data: groups, isLoading, isError, refetch } = useListManageActivityChoices(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListManageActivityChoicesQueryKey(reunionId) },
  });
  const createGroup = useCreateActivityChoiceGroup();
  const updateGroup = useUpdateActivityChoiceGroup();
  const deleteGroup = useDeleteActivityChoiceGroup();
  const addOption = useAddActivityChoiceOption();
  const updateOption = useUpdateActivityChoiceOption();
  const deleteOption = useDeleteActivityChoiceOption();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListManageActivityChoicesQueryKey(reunionId) }),
      queryClient.invalidateQueries({ queryKey: getListMemberActivityChoicesQueryKey(reunionId) }),
    ]);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState([""]);
  const [formError, setFormError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<Record<number, string>>({});
  const [inlineError, setInlineError] = useState<Record<number, string>>({});
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => { setTitle(""); setDescription(""); setItems([""]); setFormError(null); };

  const handleCreate = () => {
    const clean = items.map((i) => i.trim()).filter(Boolean);
    if (!title.trim()) return setFormError("Please enter a category title.");
    if (clean.length < 1) return setFormError("Add at least one activity.");
    createGroup.mutate(
      { reunionId, data: { title: title.trim(), description: description.trim() || null, maxSelectionsPerRegistrant: 1, options: clean } },
      {
        onSuccess: async () => { await invalidate(); setCreateOpen(false); reset(); },
        onError: (error: any) => setFormError(errMsg(error, "Could not create this list.")),
      },
    );
  };

  const handleAddItem = (groupId: number) => {
    const label = (newItem[groupId] || "").trim();
    if (!label) return setInlineError((c) => ({ ...c, [groupId]: "Enter an activity name first." }));
    setInlineError((c) => ({ ...c, [groupId]: "" }));
    addOption.mutate(
      { reunionId, activityChoiceGroupId: groupId, data: { label } },
      {
        onSuccess: async () => { await invalidate(); setNewItem((c) => ({ ...c, [groupId]: "" })); },
        onError: (error: any) => setInlineError((c) => ({ ...c, [groupId]: errMsg(error, "Could not add this activity.") })),
      },
    );
  };

  const handleConfirm = () => {
    if (!confirmTarget) return;
    setConfirmError(null);
    const done = { onSuccess: async () => { await invalidate(); setConfirmTarget(null); }, onError: (e: any) => setConfirmError(errMsg(e, "Could not delete. Please try again.")) };
    if (confirmTarget.kind === "group") deleteGroup.mutate({ reunionId, activityChoiceGroupId: confirmTarget.groupId }, done);
    else deleteOption.mutate({ reunionId, activityChoiceGroupId: confirmTarget.groupId, activityChoiceOptionId: confirmTarget.itemId }, done);
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    const cleanTitle = editTarget.title.trim();
    const clean = editTarget.items.map((i) => ({ ...i, label: i.label.trim() }));
    if (!cleanTitle) return setEditError("Please enter a category title.");
    if (clean.some((i) => !i.label)) return setEditError("Activity names cannot be blank.");
    if (clean.length < 1) return setEditError("Keep at least one activity.");
    setEditError(null);
    setSaving(true);
    const g = editTarget.id;
    try {
      await updateGroup.mutateAsync({ reunionId, activityChoiceGroupId: g, data: { title: cleanTitle, description: editTarget.description.trim() || null } });
      for (const i of clean) {
        if (i.id) await updateOption.mutateAsync({ reunionId, activityChoiceGroupId: g, activityChoiceOptionId: i.id, data: { label: i.label } });
        else {
          const created = await addOption.mutateAsync({ reunionId, activityChoiceGroupId: g, data: { label: i.label } });
          const index = clean.indexOf(i);
          setEditTarget(current => current?.id === g ? {
            ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, id: created.id } : item),
          } : current);
        }
      }
      for (const id of editTarget.removed) {
        await deleteOption.mutateAsync({ reunionId, activityChoiceGroupId: g, activityChoiceOptionId: id });
        setEditTarget(current => current?.id === g ? { ...current, removed: current.removed.filter(item => item !== id) } : current);
      }
      await invalidate();
      setEditTarget(null);
    } catch (error: any) {
      await invalidate();
      setEditError(errMsg(error, "Could not save every change. Please review and try again."));
    } finally {
      setSaving(false);
    }
  };

  const removeEditItem = (index: number) => {
    if (!editTarget || editTarget.items.length <= 1) return;
    const item = editTarget.items[index];
    setEditTarget({
      ...editTarget,
      items: editTarget.items.filter((_, i) => i !== index),
      removed: item.id ? [...editTarget.removed, item.id] : editTarget.removed,
    });
  };

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold">Activities</h1>
            <p className="text-muted-foreground text-sm mt-1">Share things to do in the area, organized by category. Use Polls to ask the family to vote.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="rounded-full">
            <Plus className="w-4 h-4 mr-2" /> New Category
          </Button>
        </div>
        {isLoading ? (
          <div className="bg-card border rounded-3xl p-10 text-center text-muted-foreground">Loading activities…</div>
        ) : isError ? (
          <div className="bg-card border border-destructive/30 rounded-3xl p-10 text-center flex flex-col items-center gap-3">
            <h3 className="font-bold text-lg">We couldn't load activities</h3>
            <Button variant="outline" className="rounded-full" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : !groups?.length ? (
          <div className="bg-card border rounded-3xl p-10 text-center">
            <h3 className="font-bold text-lg mb-2">No things to do listed yet</h3>
            <p className="text-muted-foreground">Create a category, like Outdoors or Places to Eat, and add a few local spots.</p>
          </div>
        ) : groups.map(({ group }) => (
          <div key={group.id} className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-bold">{group.title}</h2>
                {group.description && <p className="text-muted-foreground text-sm mt-1 whitespace-pre-line">{group.description}</p>}
                <p className="text-xs text-muted-foreground mt-2">{group.options.length} {group.options.length === 1 ? "activity" : "activities"}</p>
              </div>
              <div className="flex flex-wrap gap-2 items-start">
                <Button variant="outline" size="sm" onClick={() => { setEditError(null); setEditTarget({ id: group.id, title: group.title, description: group.description || "", items: group.options.map((o) => ({ id: o.id, label: o.label })), removed: [] }); }}>
                  <Pencil className="w-3 h-3 mr-1" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setConfirmError(null); setConfirmTarget({ kind: "group", groupId: group.id, title: group.title }); }}>
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {group.options.map((option) => (
                <li key={option.id} className="border rounded-xl p-3 flex items-center justify-between gap-3">
                  <span className="font-medium flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />{option.label}</span>
                  {group.options.length > 1 && (
                    <button type="button" aria-label={`Remove ${option.label}`} onClick={() => { setConfirmError(null); setConfirmTarget({ kind: "item", groupId: group.id, itemId: option.id, title: option.label }); }}>
                      <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input placeholder="Add another activity…" value={newItem[group.id] || ""} onChange={(e) => setNewItem((c) => ({ ...c, [group.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleAddItem(group.id)} />
              <Button variant="outline" onClick={() => handleAddItem(group.id)} disabled={addOption.isPending}><Plus className="w-4 h-4 mr-1" /> Add</Button>
            </div>
            {inlineError[group.id] && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">{inlineError[group.id]}</div>}
          </div>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) reset(); }}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">New Category</DialogTitle>
            <DialogDescription>Group a few things to do. Add at least one activity.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div><Label className="mb-2 block">Category title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><Label className="mb-2 block">Description (optional)</Label><textarea className="border bg-transparent rounded-xl px-3 py-2 w-full min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div>
              <Label className="mb-2 block">Activities</Label>
              <div className="flex flex-col gap-2">
                {items.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <Input value={item} placeholder={`Activity ${index + 1}`} onChange={(e) => setItems((c) => c.map((v, i) => i === index ? e.target.value : v))} />
                    {items.length > 1 && <Button variant="ghost" size="icon" aria-label="Remove activity" onClick={() => setItems((c) => c.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></Button>}
                  </div>
                ))}
                <Button variant="outline" className="border-dashed" onClick={() => setItems((c) => [...c, ""])}><Plus className="w-4 h-4 mr-1" /> Add Activity</Button>
              </div>
            </div>
            {formError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">{formError}</div>}
            <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={createGroup.isPending}>{createGroup.isPending ? "Creating…" : "Create Category"}</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && !saving && setEditTarget(null)}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Edit Category</DialogTitle>
            <DialogDescription>Rename, add, or remove activities. Each category keeps at least one.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="flex flex-col gap-4">
              <div><Label className="mb-2 block">Category title</Label><Input value={editTarget.title} onChange={(e) => setEditTarget({ ...editTarget, title: e.target.value })} /></div>
              <div><Label className="mb-2 block">Description (optional)</Label><textarea className="border bg-transparent rounded-xl px-3 py-2 w-full min-h-24" value={editTarget.description} onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })} /></div>
              <div>
                <Label className="mb-2 block">Activities</Label>
                <div className="flex flex-col gap-2">
                  {editTarget.items.map((item, index) => (
                    <div key={item.id ?? `new-${index}`} className="flex gap-2">
                      <Input value={item.label} placeholder={`Activity ${index + 1}`} onChange={(e) => setEditTarget({ ...editTarget, items: editTarget.items.map((it, i) => i === index ? { ...it, label: e.target.value } : it) })} />
                      {editTarget.items.length > 1 && <Button variant="ghost" size="icon" aria-label="Remove activity" onClick={() => removeEditItem(index)}><Trash2 className="w-4 h-4" /></Button>}
                    </div>
                  ))}
                  <Button variant="outline" className="border-dashed" onClick={() => setEditTarget({ ...editTarget, items: [...editTarget.items, { label: "" }] })}><Plus className="w-4 h-4 mr-1" /> Add Activity</Button>
                </div>
                {editTarget.removed.length > 0 && <p className="text-xs text-muted-foreground mt-2">{editTarget.removed.length} {editTarget.removed.length === 1 ? "activity" : "activities"} will be removed when you save.</p>}
              </div>
              {editError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">{editError}</div>}
              <div className="flex justify-end gap-3">
                <Button variant="ghost" disabled={saving} onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmTarget)} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmTarget?.kind === "group" ? "Delete this category?" : "Remove this activity?"}</DialogTitle>
            <DialogDescription>
              {confirmTarget ? (confirmTarget.kind === "group" ? `"${confirmTarget.title}" and all of its activities will be permanently removed.` : `"${confirmTarget.title}" will be removed from this category.`) : "The activity list has been updated."}
            </DialogDescription>
          </DialogHeader>
          {confirmError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">{confirmError}</div>}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteGroup.isPending || deleteOption.isPending} onClick={handleConfirm}>{confirmTarget?.kind === "group" ? "Delete Category" : "Remove Activity"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </OrganizerLayout>
  );
}
