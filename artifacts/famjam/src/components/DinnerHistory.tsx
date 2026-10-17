import { useState } from "react";
import { useListDinnerHistory, getListDinnerHistoryQueryKey } from "@workspace/api-client-react";

export function DinnerHistory({ reunionId }: { reunionId: number }) {
  const [open, setOpen] = useState(false);
  const history = useListDinnerHistory(reunionId, { query: {
    queryKey: getListDinnerHistoryQueryKey(reunionId), enabled: open, staleTime: 0, refetchInterval: open ? 30000 : false,
  } });
  return (
    <div className="border-t pt-3">
      <button type="button" className="text-sm font-semibold underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide dinner history" : "View dinner history"}
      </button>
      {open && <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">Changes recorded from when history was enabled. Confirmed payment receipts are unchanged.</p>
        {history.isLoading && <p role="status">Loading history...</p>}
        {history.isError && <p role="alert">Could not load dinner history. <button type="button" className="underline" onClick={() => history.refetch()}>Try again</button></p>}
        {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No dinner changes recorded yet.</p>}
        <ol className="max-h-96 overflow-y-auto space-y-2" aria-label="Dinner change history">
          {history.data?.map(entry => <li key={entry.id} className="rounded-lg border bg-card p-3 text-sm">
            <p className="font-semibold">{entry.feeLabel}{entry.attendeeName ? ` — ${entry.attendeeName}` : " — Dinner mode"}</p>
            {entry.registrationId != null && <p className="text-xs text-muted-foreground">Registration #{entry.registrationId}</p>}
            <p>{entry.beforeChoice} → {entry.afterChoice}</p>
            <p className="text-xs text-muted-foreground">{entry.actorName} · <time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time></p>
          </li>)}
        </ol>
      </div>}
    </div>
  );
}
