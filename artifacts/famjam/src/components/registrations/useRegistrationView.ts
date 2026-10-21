import { useUser } from "@clerk/react";
import { useGetMyRegistrationView, getGetMyRegistrationViewQueryKey } from "@workspace/api-client-react";
import { normalizeFields, type ViewField } from "../../lib/registrationView";

/** The signed-in organizer's saved registration view, cached per user. */
export function useRegistrationView() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const queryKey = [...getGetMyRegistrationViewQueryKey(), userId] as const;
  const query = useGetMyRegistrationView({
    query: { queryKey, enabled: !!userId, refetchOnMount: "always", staleTime: 0 },
  });
  const fields: ViewField[] | null = query.data ? normalizeFields(query.data.fields) : null;
  return {
    userId,
    queryKey,
    fields,
    resetInvalid: query.data?.resetInvalid ?? false,
    isLoading: !query.data && (query.isLoading || !userId),
    isError: query.isError,
    refetch: query.refetch,
  };
}
