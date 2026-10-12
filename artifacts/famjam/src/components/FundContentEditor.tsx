import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetReunion, useUpdateReunion, getGetReunionQueryKey, getGetReunionByCodeQueryKey, getAdminListReunionsQueryKey, type Reunion } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function FundContentEditor({ reunionId }: { reunionId: number }) {
  const { data, isError } = useGetReunion(reunionId, { query: { queryKey: getGetReunionQueryKey(reunionId) } });
  if (isError) return <p role="alert">Could not load fund settings. Reload to try again.</p>;
  if (!data) return <p role="status">Loading fund settings...</p>;
  return <FundForm key={reunionId} reunion={data.reunion} />;
}

function FundForm({ reunion }: { reunion: Reunion }) {
  const [name, setName] = useState(reunion.fundName ?? "");
  const [description, setDescription] = useState(reunion.fundDescription ?? "");
  const [button, setButton] = useState(reunion.fundButtonLabel ?? "");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const mutation = useUpdateReunion();
  const client = useQueryClient();
  return (
    <form className="bg-card border rounded-3xl p-6 space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setFeedback(null);
      try {
        await mutation.mutateAsync({ reunionId: reunion.id, data: {
          fundName: name.trim() || null, fundDescription: description.trim() || null, fundButtonLabel: button.trim() || null,
        } });
        client.invalidateQueries({ queryKey: getGetReunionQueryKey(reunion.id) });
        client.invalidateQueries({ queryKey: getGetReunionByCodeQueryKey(reunion.code) });
        client.invalidateQueries({ queryKey: getAdminListReunionsQueryKey() });
        setFeedback({ error: false, text: "Fund details saved." });
      } catch {
        setFeedback({ error: true, text: "Could not save fund details. Your edits are still here—please try again." });
      }
    }}>
      <h2 className="font-serif text-xl font-bold">Fund display settings</h2>
      <p className="text-sm text-muted-foreground">Customize what members see for this event. Leave a field blank to use its default.</p>
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <div><label htmlFor="fund-name" className="block font-medium mb-1">Fund name</label>
          <Input id="fund-name" value={name} maxLength={100} placeholder="Sponsorship Fund" onChange={e => { setName(e.target.value); setFeedback(null); }} /></div>
        <div><label htmlFor="fund-button" className="block font-medium mb-1">Give button text</label>
          <Input id="fund-button" value={button} maxLength={60} placeholder="Chip in to Fund" onChange={e => { setButton(e.target.value); setFeedback(null); }} /></div>
        <div><label htmlFor="fund-description" className="block font-medium mb-1">Description</label>
          <textarea id="fund-description" value={description} maxLength={2000} rows={4} className="w-full rounded-xl border bg-background p-3 text-sm" placeholder="Help cover costs for family members who need a little assistance." onChange={e => { setDescription(e.target.value); setFeedback(null); }} /></div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">{mutation.isPending ? "Saving..." : "Save Fund Details"}</Button>
          <Button type="button" variant="outline" onClick={() => { setName(""); setDescription(""); setButton(""); setFeedback(null); }}>Reset to defaults</Button>
        </div>
      </fieldset>
      {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-destructive" : "text-emerald-700"}>{feedback.text}</p>}
    </form>
  );
}
