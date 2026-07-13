import { useAdminListRegistrations, useAdminUpdatePaymentStatus } from "@workspace/api-client-react";
import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Ticket, Search, Filter, FileDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { queryClient } from "../../lib/queryClient";

export function AdminRegistrations() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<string>("");
  const [siblingName, setSiblingName] = useState<string>("");
  const limit = 20;

  const { data, isLoading } = useAdminListRegistrations({
    page,
    limit,
    search: search || undefined,
    paymentStatus: paymentStatus as any || undefined,
    siblingName: siblingName as any || undefined,
  });

  const updatePaymentStatus = useAdminUpdatePaymentStatus();

  const handleExport = () => {
    window.location.href = "/api/admin/registrations/export";
  };

  const togglePaymentStatus = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === "pending" ? "paid" : currentStatus === "paid" ? "waived" : "pending";
    await updatePaymentStatus.mutateAsync({ id, data: { paymentStatus: nextStatus as any } });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid": return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full cursor-pointer hover:bg-emerald-200">Paid</span>;
      case "pending": return <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full cursor-pointer hover:bg-amber-200">Pending</span>;
      case "waived": return <span className="px-2.5 py-1 bg-gray-100 text-gray-800 text-xs font-bold rounded-full cursor-pointer hover:bg-gray-200">Waived</span>;
      default: return <span className="px-2.5 py-1 bg-gray-100 text-gray-800 text-xs font-bold rounded-full">{status}</span>;
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Ticket className="w-8 h-8 text-primary" />
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-secondary">Registrations</h1>
        </div>
        <button
          onClick={handleExport}
          className="bg-secondary text-secondary-foreground px-4 py-2 rounded-full font-bold text-sm shadow-sm hover:bg-secondary/90 flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <FileDown className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="bg-card border shadow-sm rounded-3xl overflow-hidden flex flex-col">
        {/* Filters */}
        <div className="p-4 border-b flex flex-col md:flex-row gap-4 bg-muted/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search email or attendee name..." 
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={siblingName} 
              onChange={(e) => { setSiblingName(e.target.value); setPage(1); }}
              className="bg-background border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 flex-1 md:flex-none"
            >
              <option value="">All Branches</option>
              <option value="Arthur">Arthur</option>
              <option value="Betty">Betty</option>
              <option value="Charles">Charles</option>
              <option value="Diana">Diana</option>
              <option value="Edward">Edward</option>
            </select>
            <select 
              value={paymentStatus} 
              onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }}
              className="bg-background border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 flex-1 md:flex-none"
            >
              <option value="">All Statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="waived">Waived</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b">
              <tr>
                <th className="px-6 py-4 font-bold"># ID</th>
                <th className="px-6 py-4 font-bold">Branch</th>
                <th className="px-6 py-4 font-bold">Registrant</th>
                <th className="px-6 py-4 font-bold text-center">Attendees</th>
                <th className="px-6 py-4 font-bold text-right">Fee</th>
                <th className="px-6 py-4 font-bold text-center">Status</th>
                <th className="px-6 py-4 font-bold">Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </td>
                </tr>
              ) : !data?.registrations.length ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No registrations found.
                  </td>
                </tr>
              ) : (
                data.registrations.map((reg) => (
                  <tr key={reg.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4 font-medium">
                      <Link href={`/admin/registrations/${reg.id}`} className="text-primary hover:underline">
                        {reg.id}
                      </Link>
                    </td>
                    <td className="px-6 py-4">{reg.siblingName}</td>
                    <td className="px-6 py-4 truncate max-w-[150px]">{reg.userEmail}</td>
                    <td className="px-6 py-4 text-center font-bold">{reg.attendees?.length || 0}</td>
                    <td className="px-6 py-4 text-right">${(reg.attendees?.length || 0) * 50}</td>
                    <td className="px-6 py-4 text-center">
                      <div onClick={() => togglePaymentStatus(reg.id, reg.paymentStatus)} className="inline-block">
                        {getStatusBadge(reg.paymentStatus)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {format(new Date(reg.createdAt), "MMM d, yyyy")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && Math.ceil(data.total / limit) > 1 && (
          <div className="p-4 border-t flex items-center justify-between bg-muted/20">
            <span className="text-sm text-muted-foreground">
              Showing <span className="font-bold text-foreground">{(page - 1) * limit + 1}</span> to <span className="font-bold text-foreground">{Math.min(page * limit, data.total)}</span> of <span className="font-bold text-foreground">{data.total}</span>
            </span>
            <div className="flex gap-2">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 bg-background border rounded-lg disabled:opacity-50 hover:bg-muted"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setPage(p => Math.min(Math.ceil(data.total / limit), p + 1))}
                disabled={page === Math.ceil(data.total / limit)}
                className="p-2 bg-background border rounded-lg disabled:opacity-50 hover:bg-muted"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
