import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, LockOpen, Pencil, Plus, Radio, Trash2, Users, X } from "lucide-react";
import {
  getListManageActivityChoicesQueryKey,
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

export function OrganizerActivities({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useListManageActivityChoices(reunionId, {
    query: {
      enabled: !isNaN(reunionId),
      queryKey: getListManageActivityChoicesQueryKey(reunionId),
      refetchInterval: 3000,
      refetchIntervalInBackground: false,
    },
  });
  const createGroup = useCreateActivityChoiceGroup();
  const updateGroup = useUpdateActivityChoiceGroup();
  const deleteGroup = useDeleteActivityChoiceGroup();
  const addOption = useAddActivityChoiceOption();
  const updateOption = useUpdateActivityChoiceOption();
  const deleteOption = useDeleteActivityChoiceOption();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListManageActivityChoicesQueryKey(reunionId) });

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [limit, setLimit] = useState(1);
  const [options, setOptions] = useState(["", ""]);
  const [formError, setFormError] = useState<string | null>(null);
  const [newOption, setNewOption] = useState<Record<number, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{
    id: number;
    title: string;
    description: string;
    limit: number;
    options: { id: number; label: string }[];
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setLimit(1);
    setOptions(["", ""]);
    setFormError(null);
  };
  const handleCreate = () => {
    const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
    if (!title.trim()) return setFormError("Please enter a title or question.");
    if (cleanOptions.length < 2) return setFormError("Add at least two options.");
    createGroup.mutate(
      {
        reunionId,
        data: {
          title: title.trim(),
          description: description.trim() || null,
          maxSelectionsPerRegistrant: limit,
          options: cleanOptions,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setCreateOpen(false);
          reset();
        },
        onError: (error: any) => setFormError(error?.data?.error || "Could not create this group."),
      },
    );
  };
  const setFlag = (
    activityChoiceGroupId: number,
    data: { isOpen?: boolean; resultsRevealed?: boolean; liveResults?: boolean },
  ) =>
    updateGroup.mutate({ reunionId, activityChoiceGroupId, data }, { onSuccess: invalidate });
  const handleAddOption = (activityChoiceGroupId: number) => {
    const label = (newOption[activityChoiceGroupId] || "").trim();
    if (!label) return;
    addOption.mutate(
      { reunionId, activityChoiceGroupId, data: { label } },
      {
        onSuccess: () => {
          invalidate();
          setNewOption((current) => ({ ...current, [activityChoiceGroupId]: "" }));
        },
      },
    );
  };
  const handleEdit = async () => {
    if (!editTarget) return;
    const cleanTitle = editTarget.title.trim();
    const cleanOptions = editTarget.options.map((option) => ({ ...option, label: option.label.trim() }));
    if (!cleanTitle) return setEditError("Please enter a title or question.");
    if (cleanOptions.some((option) => !option.label)) return setEditError("Option labels cannot be blank.");
    setEditError(null);
    try {
      await updateGroup.mutateAsync({
        reunionId,
        activityChoiceGroupId: editTarget.id,
        data: {
          title: cleanTitle,
          description: editTarget.description.trim() || null,
          maxSelectionsPerRegistrant: editTarget.limit,
        },
      });
      await Promise.all(
        cleanOptions.map((option) =>
          updateOption.mutateAsync({
            reunionId,
            activityChoiceGroupId: editTarget.id,
            activityChoiceOptionId: option.id,
            data: { label: option.label },
          }),
        ),
      );
      await invalidate();
      setEditTarget(null);
    } catch (error: any) {
      setEditError(error?.data?.error || "Could not update this choice group.");
    }
  };

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold">Activities &amp; Choices</h1>
            <p className="text-muted-foreground text-sm mt-1">Gather activity preferences from every actively registered household.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="rounded-full">
            <Plus className="w-4 h-4 mr-2" /> New Choice Group
          </Button>
        </div>
        {isLoading ? (
          <div className="bg-card border rounded-3xl p-10 text-center text-muted-foreground">Loading choices…</div>
        ) : !groups?.length ? (
          <div className="bg-card border rounded-3xl p-10 text-center">
            <h3 className="font-bold text-lg mb-2">No activity choices yet</h3>
            <p className="text-muted-foreground">Create a group to start gathering family preferences.</p>
          </div>
        ) : groups.map(({ group, totalRegistrants, results }) => {
          const total = results.reduce((sum, result) => sum + result.selectionCount, 0);
          return (
            <div key={group.id} className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl font-bold">{group.title}</h2>
                  {group.description && <p className="text-muted-foreground text-sm mt-1">{group.description}</p>}
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                    <span className="px-2 py-1 rounded-md bg-muted font-bold">{group.isOpen ? "Selections open" : "Selections closed"}</span>
                    <span className="px-2 py-1 rounded-md bg-muted font-bold">{group.resultsRevealed ? "Results visible" : "Results hidden"}</span>
                    {group.liveResults && <span className="px-2 py-1 rounded-md bg-red-100 text-red-600 font-bold flex items-center gap-1"><Radio className="w-3 h-3" /> Live</span>}
                    <span className="text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> {totalRegistrants} selected · up to {group.maxSelectionsPerRegistrant}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditError(null);
                      setEditTarget({
                        id: group.id,
                        title: group.title,
                        description: group.description || "",
                        limit: group.maxSelectionsPerRegistrant,
                        options: group.options.map((option) => ({ id: option.id, label: option.label })),
                      });
                    }}
                  >
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setFlag(group.id, { isOpen: !group.isOpen })}>
                    {group.isOpen ? <Lock className="w-3 h-3 mr-1" /> : <LockOpen className="w-3 h-3 mr-1" />}{group.isOpen ? "Close" : "Reopen"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setFlag(group.id, { resultsRevealed: !group.resultsRevealed })}>
                    {group.resultsRevealed ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}{group.resultsRevealed ? "Hide results" : "Reveal results"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setFlag(group.id, { liveResults: !group.liveResults })}>
                    <Radio className="w-3 h-3 mr-1" />{group.liveResults ? "Stop live" : "Go live"}
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: group.id, title: group.title })}>
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {results.map((result) => {
                  const percent = total ? Math.round((result.selectionCount / total) * 100) : 0;
                  return (
                    <div key={result.optionId} className="border rounded-xl p-3">
                      <div className="flex justify-between gap-3">
                        <span className="font-medium">{result.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{result.selectionCount}</span>
                          <span className="text-xs text-muted-foreground">{percent}%</span>
                          {group.options.length > 2 && (
                            <button onClick={() => deleteOption.mutate({ reunionId, activityChoiceGroupId: group.id, activityChoiceOptionId: result.optionId }, { onSuccess: invalidate })} title="Remove option">
                              <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div>
                      {!!result.registrants?.length && <p className="text-xs text-muted-foreground mt-2">{result.registrants.join(", ")}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input placeholder="Add another option…" value={newOption[group.id] || ""} onChange={(event) => setNewOption((current) => ({ ...current, [group.id]: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && handleAddOption(group.id)} />
                <Button variant="outline" onClick={() => handleAddOption(group.id)} disabled={addOption.isPending}><Plus className="w-4 h-4 mr-1" /> Add</Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) reset(); }}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">New Choice Group</DialogTitle>
            <DialogDescription>Offer at least two choices. Selections open immediately.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div><Label className="mb-2 block">Title or question</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} /></div>
            <div><Label className="mb-2 block">Description (optional)</Label><textarea className="border bg-transparent rounded-xl px-3 py-2 w-full min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
            <div><Label className="mb-2 block">Selections allowed per registrant</Label><Input className="w-28" type="number" min={1} max={20} value={limit} onChange={(event) => setLimit(Math.max(1, Math.min(20, parseInt(event.target.value, 10) || 1)))} /></div>
            <div>
              <Label className="mb-2 block">Options</Label>
              <div className="flex flex-col gap-2">
                {options.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <Input value={option} placeholder={`Option ${index + 1}`} onChange={(event) => setOptions((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} />
                    {options.length > 2 && <Button variant="ghost" size="icon" onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="w-4 h-4" /></Button>}
                  </div>
                ))}
                <Button variant="outline" className="border-dashed" onClick={() => setOptions((current) => [...current, ""])}><Plus className="w-4 h-4 mr-1" /> Add Option</Button>
              </div>
            </div>
            {formError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">{formError}</div>}
            <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={createGroup.isPending}>{createGroup.isPending ? "Creating…" : "Create Group"}</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Edit Choice Group</DialogTitle>
            <DialogDescription>Update the group details or option names. Existing selections remain attached to their options.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="flex flex-col gap-4">
              <div><Label className="mb-2 block">Title or question</Label><Input value={editTarget.title} onChange={(event) => setEditTarget({ ...editTarget, title: event.target.value })} /></div>
              <div><Label className="mb-2 block">Description (optional)</Label><textarea className="border bg-transparent rounded-xl px-3 py-2 w-full min-h-24" value={editTarget.description} onChange={(event) => setEditTarget({ ...editTarget, description: event.target.value })} /></div>
              <div><Label className="mb-2 block">Selections allowed per registrant</Label><Input className="w-28" type="number" min={1} max={20} value={editTarget.limit} onChange={(event) => setEditTarget({ ...editTarget, limit: Math.max(1, Math.min(20, parseInt(event.target.value, 10) || 1)) })} /></div>
              <div>
                <Label className="mb-2 block">Options</Label>
                <div className="flex flex-col gap-2">
                  {editTarget.options.map((option, index) => (
                    <Input
                      key={option.id}
                      value={option.label}
                      onChange={(event) => setEditTarget({
                        ...editTarget,
                        options: editTarget.options.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item),
                      })}
                    />
                  ))}
                </div>
              </div>
              {editError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">{editError}</div>}
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button onClick={handleEdit} disabled={updateGroup.isPending || updateOption.isPending}>
                  {updateGroup.isPending || updateOption.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader><DialogTitle>Delete this choice group?</DialogTitle><DialogDescription>"{deleteTarget?.title}" and all selections will be permanently removed.</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" disabled={deleteGroup.isPending} onClick={() => deleteTarget && deleteGroup.mutate({ reunionId, activityChoiceGroupId: deleteTarget.id }, { onSuccess: () => { invalidate(); setDeleteTarget(null); } })}>Delete Group</Button></div>
        </DialogContent>
      </Dialog>
    </OrganizerLayout>
  );
}