import { useAdminListReunions, getAdminListReunionsQueryKey } from "@workspace/api-client-react";
import { HomeContentEditor } from "../../components/HomeContentEditor";
import { OrganizerLayout } from "./OrganizerLayout";

export function OrganizerHomePage({ params }: { params: { reunionId: string } }) {
  const reunionId = Number(params.reunionId);
  const { data: reunions, isLoading, isError } = useAdminListReunions({ query: { queryKey: getAdminListReunionsQueryKey(), retry: false } });
  const event = reunions?.find(({ reunion }) => reunion.id === reunionId);

  return (
    <OrganizerLayout reunionId={reunionId}>
      {isLoading ? (
        <p role="status">Loading home page settings...</p>
      ) : isError ? (
        <div role="alert">
          <h1 className="font-serif text-2xl font-bold mb-2">Access Denied</h1>
          <p>Platform administrator access is required to edit the event home page.</p>
        </div>
      ) : event ? (
        <HomeContentEditor key={reunionId} reunions={[event]} fixedEvent />
      ) : (
        <p role="alert">Event not found.</p>
      )}
    </OrganizerLayout>
  );
}
