import { useState, useMemo } from "react";
import { useListReunionRegistrations, useUpdateRegistrationPayment, useExportReunionRegistrations, getListReunionRegistrationsQueryKey, getGetReunionReportsQueryKey, getGetReunionSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Download, Check, X, Filter } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useToast } from "../../hooks/use-toast";
import { OrganizerLayout } from "./OrganizerLayout";
import { format } from "date-fns";

export function OrganizerRegistrations({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const { data: registrations, isLoading } = useListReunionRegistrations(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionRegistrationsQueryKey(reunionId) }
  });

  const updatePayment = useUpdateRegistrationPayment();
  const { refetch: fetchExport, isFetching: isExporting } = useExportReunionRegistrations(reunionId, { query: { enabled: false, queryKey: ['export', reunionId] } });

  const filteredRegistrations = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(reg => {
      const matchesSearch = 
        (reg.userName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.branchName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || reg.paymentStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [registrations, searchTerm, statusFilter]);

  const handleUpdateStatus = (registrationId: number, status: 'paid' | 'pending' | 'waived') => {
    updatePayment.mutate({
      reunionId,
      registrationId,
      data: { paymentStatus: status }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionReportsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunionId) });
        toast({ title: "Status updated" });
      }
    });
  };

  const handleExport = async () => {
    const res = await fetchExport();
    if (res.data) {
      const blob = new Blob([res.data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `reunion-${reunionId}-registrations.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="registration">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="font-serif text-3xl font-bold">Registrations</h1>
          <Button onClick={handleExport} variant="outline" className="rounded-full" disabled={isExporting || !registrations?.length}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
              <Input 
                placeholder="Search by name, email, or branch..." 
                className="pl-10 rounded-xl bg-muted/50 border-transparent"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="w-full md:w-48 shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="rounded-xl bg-muted/50 border-transparent">
                  <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="waived">Waived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 rounded-t-xl">
                <tr>
                  <th className="px-4 py-3 rounded-tl-xl">Registrant</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Attendees</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 rounded-tr-xl">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={5} className="text-center py-8">Loading...</td></tr>
                ) : filteredRegistrations.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No registrations found.</td></tr>
                ) : (
                  filteredRegistrations.map((reg) => (
                    <tr key={reg.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground">{reg.userName || "Unknown"}</div>
                        <div className="text-muted-foreground text-xs">{reg.userEmail}</div>
                      </td>
                      <td className="px-4 py-4 font-medium">{reg.branchName}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold">{reg.attendeeCount}</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={reg.attendees.map(a=>a.name).join(', ')}>
                            {reg.attendees.map(a=>a.name).join(', ')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">
                        {format(new Date(reg.createdAt), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-4">
                        <Select 
                          value={reg.paymentStatus} 
                          onValueChange={(val: 'paid'|'pending'|'waived') => handleUpdateStatus(reg.id, val)}
                        >
                          <SelectTrigger className={`h-8 text-xs font-bold uppercase tracking-wider rounded-lg border-0 w-[110px] ${
                            reg.paymentStatus === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            reg.paymentStatus === 'waived' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' :
                            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending" className="text-amber-600 font-bold uppercase text-xs">Pending</SelectItem>
                            <SelectItem value="paid" className="text-green-600 font-bold uppercase text-xs">Paid</SelectItem>
                            <SelectItem value="waived" className="text-gray-600 font-bold uppercase text-xs">Waived</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </OrganizerLayout>
  );
}
