import { useState } from "react";
import { useListReunionSchedule, useCreateScheduleItem, useUpdateScheduleItem, useDeleteScheduleItem, getListReunionScheduleQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Trash2, Edit2, Plus, GripVertical } from "lucide-react";
import { useToast } from "../../hooks/use-toast";
import type { ScheduleItem } from "@workspace/api-client-react";

export function OrganizerSchedule({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const [day, setDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [locationStr, setLocationStr] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  const { data: schedule, isLoading } = useListReunionSchedule(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionScheduleQueryKey(reunionId) }
  });

  const createMutation = useCreateScheduleItem();
  const updateMutation = useUpdateScheduleItem();
  const deleteMutation = useDeleteScheduleItem();

  const resetForm = () => {
    setDay(schedule && schedule.length > 0 ? schedule[0].day : "Friday");
    setStartTime("12:00 PM");
    setEndTime("");
    setTitle("");
    setLocationStr("");
    setDescription("");
    setSortOrder((schedule?.length || 0) * 10);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (s: ScheduleItem) => {
    setDay(s.day);
    setStartTime(s.startTime);
    setEndTime(s.endTime || "");
    setTitle(s.title);
    setLocationStr(s.location || "");
    setDescription(s.description || "");
    setSortOrder(s.sortOrder || 0);
    setEditingId(s.id);
    setIsOpen(true);
  };

  const handleSave = () => {
    if (!day || !startTime || !title) {
      toast({ title: "Validation Error", description: "Day, start time, and title are required.", variant: "destructive" });
      return;
    }

    const payload = { 
      day, 
      startTime, 
      endTime: endTime || undefined, 
      title, 
      location: locationStr || undefined, 
      description: description || undefined,
      sortOrder 
    };

    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReunionScheduleQueryKey(reunionId) });
        setIsOpen(false);
        toast({ title: "Saved" });
      }
    };

    if (editingId) {
      updateMutation.mutate({ reunionId, scheduleId: editingId, data: payload }, opts);
    } else {
      createMutation.mutate({ reunionId, data: payload }, opts);
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this schedule item?")) {
      deleteMutation.mutate({ reunionId, scheduleId: id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReunionScheduleQueryKey(reunionId) });
          toast({ title: "Deleted" });
        }
      });
    }
  };

  const groupedSchedule = schedule?.reduce((acc, item) => {
    if (!acc[item.day]) acc[item.day] = [];
    acc[item.day].push(item);
    return acc;
  }, {} as Record<string, typeof schedule>);
  const days = Object.keys(groupedSchedule || {});

  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="schedule">
      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-center">
          <h1 className="font-serif text-3xl font-bold">Schedule Itinerary</h1>
          <Button onClick={openCreate} className="rounded-full">
            <Plus className="w-4 h-4 mr-2" /> Add Event
          </Button>
        </div>

        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if(!open) resetForm(); }}>
          <DialogContent className="sm:max-w-[500px] rounded-3xl">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">{editingId ? "Edit Event" : "Add Event"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Day Group (e.g. Friday)</Label>
                  <Input value={day} onChange={e => setDay(e.target.value)} className="rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label>Sort Order</Label>
                  <Input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} className="rounded-xl" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="e.g. 2:00 PM" className="rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label>End Time (Optional)</Label>
                  <Input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="e.g. 4:00 PM" className="rounded-xl" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Event Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Family Picnic" className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Location (Optional)</Label>
                <Input value={locationStr} onChange={e => setLocationStr(e.target.value)} placeholder="Park Pavilion 3" className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Description (Optional)</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Bring your own chairs" className="rounded-xl" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="rounded-xl">
                Save Event
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : !schedule || schedule.length === 0 ? (
          <div className="bg-card border border-dashed rounded-3xl p-12 text-center text-muted-foreground">
            No events added yet. Start building the itinerary!
          </div>
        ) : (
          <div className="space-y-8">
            {days.map(d => (
              <div key={d}>
                <h3 className="font-serif text-xl font-bold mb-4 text-secondary border-b pb-2">{d}</h3>
                <div className="space-y-3">
                  {groupedSchedule![d].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)).map(item => (
                    <div key={item.id} className="bg-card border shadow-sm rounded-2xl p-4 flex items-center gap-4 group">
                      <GripVertical className="w-5 h-5 text-muted-foreground/30 cursor-grab" />
                      <div className="w-32 shrink-0 font-bold text-sm">
                        {item.startTime} {item.endTime && <span className="block text-xs text-muted-foreground font-normal">to {item.endTime}</span>}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold">{item.title}</div>
                        {(item.location || item.description) && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {item.location && <span className="mr-2">📍 {item.location}</span>}
                            {item.description}
                          </div>
                        )}
                      </div>
                      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(item)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </OrganizerLayout>
  );
}
