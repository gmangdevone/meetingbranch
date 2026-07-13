import { useState } from "react";
import { useListScheduleItems, useAdminCreateScheduleItem, useAdminUpdateScheduleItem, useAdminDeleteScheduleItem } from "@workspace/api-client-react";
import { Calendar, Plus, Edit, Trash2, Loader2, MapPin, Clock } from "lucide-react";
import { queryClient } from "../../lib/queryClient";

export function AdminSchedule() {
  const { data: scheduleItems, isLoading } = useListScheduleItems();
  
  const createItem = useAdminCreateScheduleItem();
  const updateItem = useAdminUpdateScheduleItem();
  const deleteItem = useAdminDeleteScheduleItem();

  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  
  const [day, setDay] = useState("Friday");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState<number>(0);

  const resetForm = () => {
    setIsEditing(false);
    setEditId(null);
    setDay("Friday");
    setStartTime("");
    setEndTime("");
    setTitle("");
    setLocation("");
    setDescription("");
    setSortOrder(0);
  };

  const handleEdit = (item: any) => {
    setEditId(item.id);
    setDay(item.day);
    setStartTime(item.startTime);
    setEndTime(item.endTime || "");
    setTitle(item.title);
    setLocation(item.location || "");
    setDescription(item.description || "");
    setSortOrder(item.sortOrder || 0);
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this schedule item?")) {
      await deleteItem.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !day.trim() || !startTime.trim()) return;

    const data = {
      day,
      startTime,
      endTime: endTime || undefined,
      title,
      location: location || undefined,
      description: description || undefined,
      sortOrder,
    };

    if (editId) {
      await updateItem.mutateAsync({ id: editId, data });
    } else {
      await createItem.mutateAsync({ data });
    }
    
    queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
    resetForm();
  };

  // Group items by day
  const groupedItems = scheduleItems?.reduce((acc: any, item) => {
    if (!acc[item.day]) acc[item.day] = [];
    acc[item.day].push(item);
    return acc;
  }, {}) || {};

  const days = Object.keys(groupedItems).sort();

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary p-3 rounded-2xl">
            <Calendar className="w-8 h-8" />
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-secondary">Schedule Manager</h1>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="bg-primary text-primary-foreground px-5 py-2.5 rounded-full font-bold text-sm md:text-base shadow-sm hover:bg-primary/90 flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        )}
      </div>

      {isEditing && (
        <div className="bg-card border shadow-lg rounded-3xl p-6 mb-4 animate-in fade-in slide-in-from-top-4">
          <h2 className="font-bold text-xl mb-4">{editId ? "Edit Session" : "Create Session"}</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold mb-1">Day</label>
                <input
                  type="text"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. Friday"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. Family BBQ"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">Start Time</label>
                <input
                  type="text"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. 5:00 PM"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">End Time <span className="text-muted-foreground font-normal">(Optional)</span></label>
                <input
                  type="text"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. 8:00 PM"
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">Location <span className="text-muted-foreground font-normal">(Optional)</span></label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. Main Pavilion"
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">Sort Order</label>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  className="w-full bg-muted/50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-bold mb-1">Description <span className="text-muted-foreground font-normal">(Optional)</span></label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-muted/50 border rounded-xl px-4 py-3 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                placeholder="Add extra details..."
              />
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
                disabled={createItem.isPending || updateItem.isPending}
                className="bg-primary text-primary-foreground px-6 py-2.5 rounded-full font-bold shadow-md hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-70 flex items-center gap-2"
              >
                {(createItem.isPending || updateItem.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                {editId ? "Save Changes" : "Add Session"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : days.length === 0 ? (
        <div className="bg-card border shadow-sm rounded-3xl p-12 text-center text-muted-foreground">
          No schedule items created yet.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((dayName) => (
            <div key={dayName} className="bg-card border shadow-sm rounded-3xl overflow-hidden">
              <div className="bg-secondary text-secondary-foreground px-6 py-4 font-serif font-bold text-xl">
                {dayName}
              </div>
              <div className="divide-y">
                {groupedItems[dayName].map((item: any) => (
                  <div key={item.id} className="p-6 flex flex-col md:flex-row gap-4 justify-between hover:bg-muted/5 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-primary font-bold inline-flex items-center gap-1.5 bg-primary/10 px-3 py-1 rounded-full text-sm">
                          <Clock className="w-3.5 h-3.5" />
                          {item.startTime} {item.endTime ? `- ${item.endTime}` : ''}
                        </span>
                        <h3 className="font-bold text-lg">{item.title}</h3>
                      </div>
                      
                      {item.location && (
                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm font-medium mb-2">
                          <MapPin className="w-4 h-4" /> {item.location}
                        </div>
                      )}
                      
                      {item.description && (
                        <p className="text-muted-foreground text-sm mt-2">{item.description}</p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 md:self-center shrink-0">
                      <button 
                        onClick={() => handleEdit(item)}
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors border shadow-sm bg-background"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors border shadow-sm bg-background"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
