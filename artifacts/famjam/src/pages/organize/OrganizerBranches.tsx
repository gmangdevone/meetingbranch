import { useState } from "react";
import { useGetReunion, useCreateBranch, useUpdateBranch, useDeleteBranch, getGetReunionQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { useToast } from "../../hooks/use-toast";

export function OrganizerBranches({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [newBranchName, setNewBranchName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data: summary } = useGetReunion(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }
  });

  const createMutation = useCreateBranch();
  const updateMutation = useUpdateBranch();
  const deleteMutation = useDeleteBranch();

  const handleAdd = () => {
    if (!newBranchName.trim()) return;
    createMutation.mutate({
      reunionId,
      data: { name: newBranchName, sortOrder: (summary?.reunion.branches.length || 0) * 10 }
    }, {
      onSuccess: () => {
        setNewBranchName("");
        queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
        toast({ title: "Branch added" });
      }
    });
  };

  const handleSaveEdit = (branchId: number) => {
    if (!editingName.trim()) return;
    updateMutation.mutate({
      reunionId,
      branchId,
      data: { name: editingName }
    }, {
      onSuccess: () => {
        setEditingId(null);
        queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
        toast({ title: "Branch updated" });
      }
    });
  };

  const handleDelete = (branchId: number) => {
    if (confirm("Delete this branch? Anyone registered under it will keep their data, but new registrants won't see it.")) {
      deleteMutation.mutate({ reunionId, branchId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
          toast({ title: "Branch deleted" });
        }
      });
    }
  };

  if (!summary) return null;
  const branches = [...summary.reunion.branches].sort((a,b) => a.sortOrder - b.sortOrder);

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-6 max-w-2xl">
        <h1 className="font-serif text-3xl font-bold">Family Branches</h1>
        <p className="text-muted-foreground">Manage the groups users can select when they register.</p>

        <div className="bg-card border shadow-sm rounded-3xl p-6">
          <div className="flex gap-2 mb-8">
            <Input 
              value={newBranchName} 
              onChange={e => setNewBranchName(e.target.value)} 
              placeholder="New branch name..." 
              className="rounded-xl bg-muted/50"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!newBranchName.trim() || createMutation.isPending} className="rounded-xl">
              <Plus className="w-4 h-4 mr-2" /> Add
            </Button>
          </div>

          <div className="space-y-2">
            {branches.map(branch => (
              <div key={branch.id} className="flex items-center justify-between p-3 border rounded-xl hover:bg-muted/30 transition-colors">
                {editingId === branch.id ? (
                  <div className="flex flex-1 items-center gap-2 mr-2">
                    <Input 
                      value={editingName} 
                      onChange={e => setEditingName(e.target.value)} 
                      className="h-9"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && handleSaveEdit(branch.id)}
                    />
                    <Button size="icon" variant="ghost" onClick={() => handleSaveEdit(branch.id)} className="h-9 w-9 text-green-600 hover:text-green-700">
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} className="h-9 w-9">
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium">{branch.name}</span>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(branch.id); setEditingName(branch.name); }}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(branch.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </OrganizerLayout>
  );
}
