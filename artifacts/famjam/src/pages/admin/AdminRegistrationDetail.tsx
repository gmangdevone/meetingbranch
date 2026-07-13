import { useGetRegistration, useAdminUpdatePaymentStatus } from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { format } from "date-fns";
import { ChevronLeft, Ticket, User, Utensils, CheckCircle2, AlertTriangle } from "lucide-react";
import { queryClient } from "../../lib/queryClient";

export function AdminRegistrationDetail() {
  const params = useParams();
  const id = Number(params.id);

  const { data: registration, isLoading } = useGetRegistration(id);
  const updatePaymentStatus = useAdminUpdatePaymentStatus();

  const handlePaymentToggle = async (currentStatus: string) => {
    const nextStatus = currentStatus === "pending" ? "paid" : currentStatus === "paid" ? "waived" : "pending";
    await updatePaymentStatus.mutateAsync({ id, data: { paymentStatus: nextStatus as any } });
    queryClient.invalidateQueries({ queryKey: [`/api/registrations/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
  };

  if (isLoading || !registration) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-10 w-32 bg-muted rounded-xl" />
        <div className="h-40 bg-muted rounded-3xl" />
        <div className="h-64 bg-muted rounded-3xl" />
      </div>
    );
  }

  const fee = (registration.attendees?.length || 0) * 50;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "paid": return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "pending": return "bg-amber-100 text-amber-800 border-amber-200";
      case "waived": return "bg-gray-100 text-gray-800 border-gray-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div>
        <Link href="/admin/registrations" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground font-medium mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Back to Registrations
        </Link>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-secondary mb-2">
              Registration #{registration.id}
            </h1>
            <p className="text-muted-foreground flex items-center gap-2">
              <Ticket className="w-4 h-4" />
              Registered on {format(new Date(registration.createdAt), "MMMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
          
          <div className="bg-card border shadow-sm rounded-2xl p-4 flex flex-col gap-2 min-w-[200px]">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-muted-foreground uppercase">Total Fee</span>
              <span className="font-serif text-2xl font-bold">${fee}</span>
            </div>
            <div className="flex justify-between items-center border-t pt-2 mt-1">
              <span className="text-sm font-bold text-muted-foreground uppercase">Status</span>
              <button 
                onClick={() => handlePaymentToggle(registration.paymentStatus)}
                className={`px-3 py-1 text-xs font-bold rounded-full border transition-transform active:scale-95 ${getStatusStyle(registration.paymentStatus)}`}
              >
                {registration.paymentStatus.charAt(0).toUpperCase() + registration.paymentStatus.slice(1)}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Registration Info */}
        <div className="bg-card border shadow-sm rounded-3xl p-6 md:col-span-1 h-fit">
          <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            Family Details
          </h2>
          
          <div className="flex flex-col gap-5">
            <div>
              <span className="block text-xs font-bold text-muted-foreground uppercase mb-1">Sibling Branch</span>
              <span className="font-medium text-lg">{registration.siblingName}</span>
            </div>
            <div>
              <span className="block text-xs font-bold text-muted-foreground uppercase mb-1">User ID</span>
              <span className="font-mono text-sm break-all">{registration.userId}</span>
            </div>
            <div>
              <span className="block text-xs font-bold text-muted-foreground uppercase mb-1">Headcount</span>
              <span className="font-medium text-lg">{registration.attendees?.length || 0} People</span>
            </div>
          </div>
        </div>

        {/* Attendees List */}
        <div className="bg-card border shadow-sm rounded-3xl md:col-span-2 overflow-hidden flex flex-col">
          <div className="p-6 border-b bg-muted/20">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <Utensils className="w-5 h-5 text-primary" />
              Attendees ({registration.attendees?.length || 0})
            </h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/10 border-b">
                <tr>
                  <th className="px-6 py-3 font-bold">Name</th>
                  <th className="px-6 py-3 font-bold text-center">Shirt Size</th>
                  <th className="px-6 py-3 font-bold">Dietary Restrictions</th>
                </tr>
              </thead>
              <tbody>
                {registration.attendees?.map((attendee, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/5 transition-colors">
                    <td className="px-6 py-4 font-medium">{attendee.name}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-block px-2 py-1 bg-muted rounded-md text-xs font-bold">
                        {attendee.shirtSize}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {attendee.dietaryRestrictions ? (
                        <div className="flex items-start gap-2 text-amber-600">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span className="text-sm">{attendee.dietaryRestrictions}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">None</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!registration.attendees?.length && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">
                      No attendees found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
