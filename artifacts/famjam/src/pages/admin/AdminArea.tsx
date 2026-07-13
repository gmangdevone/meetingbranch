import { useGetSettings, useAdminUpdateSettings, useAdminListReunions, getAdminListReunionsQueryKey, useAdminListUsers, useAdminToggleAdminFlag, getAdminListUsersQueryKey, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Shield, Settings as SettingsIcon, Users, CalendarDays, Power, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { format } from "date-fns";
import { useToast } from "../../hooks/use-toast";
import { useState } from "react";

export function AdminArea() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  // Platform admin signal
  const { data: adminReunions, isError: notAdminError, isLoading: loadingReunions, refetch } = useAdminListReunions({
    query: { retry: false, queryKey: getAdminListReunionsQueryKey() }
  });

  const { data: settings } = useGetSettings();
  const updateSettingsMutation = useAdminUpdateSettings();
  const toggleAdminMutation = useAdminToggleAdminFlag();
  const { data: users } = useAdminListUsers({ query: { enabled: !!adminReunions, queryKey: getAdminListUsersQueryKey() } });

  const handleClaimAdmin = async () => {
    setClaiming(true);
    try {
      const res = await fetch('/api/admin/setup', { method: 'GET', credentials: 'include' });
      if (res.ok) {
        toast({ title: "Admin claimed successfully!" });
        queryClient.invalidateQueries();
        refetch();
      } else if (res.status === 409) {
        toast({ title: "Cannot claim", description: "An admin already exists.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Failed to claim admin.", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: "Failed to claim admin.", variant: "destructive" });
    }
    setClaiming(false);
  };

  const handleToggleCreation = (enabled: boolean) => {
    updateSettingsMutation.mutate({ data: { reunionCreationEnabled: enabled } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: enabled ? "Creation Enabled" : "Creation Disabled" });
      }
    });
  };

  const handleToggleAdmin = (userId: string, currentStatus: boolean) => {
    if (confirm(`Are you sure you want to ${currentStatus ? 'revoke' : 'grant'} admin rights?`)) {
      toggleAdminMutation.mutate({ id: userId, data: { isAdmin: !currentStatus } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
          toast({ title: "Admin status updated" });
        }
      });
    }
  };

  if (notAdminError) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center flex flex-col items-center">
        <Shield className="w-16 h-16 text-muted-foreground mb-6" />
        <h1 className="font-serif text-3xl font-bold mb-4">Access Denied</h1>
        <p className="text-muted-foreground mb-8">You do not have platform administrator privileges.</p>
        
        <div className="bg-muted p-6 rounded-3xl w-full border border-dashed">
          <p className="text-sm font-medium mb-4">Are you setting up this instance for the first time?</p>
          <Button onClick={handleClaimAdmin} disabled={claiming} variant="outline" className="w-full rounded-xl">
            <Power className="w-4 h-4 mr-2" /> Claim First-Operator Admin
          </Button>
        </div>
      </div>
    );
  }

  if (loadingReunions || !adminReunions || !settings || !users) {
    return <div className="p-8 text-center text-muted-foreground">Loading admin area...</div>;
  }

  return (
    <div className="flex flex-col gap-10 pb-12 animate-in fade-in zoom-in-95">
      <div className="flex items-center gap-4 border-b pb-6">
        <div className="bg-primary/10 text-primary w-16 h-16 rounded-2xl flex items-center justify-center">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div>
          <h1 className="font-serif text-4xl font-bold text-foreground">Platform Admin</h1>
          <p className="text-muted-foreground">Global control for FamJam.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1">
          <div className="bg-card border shadow-sm rounded-3xl p-6 sticky top-24">
            <h2 className="font-serif text-xl font-bold mb-6 flex items-center"><SettingsIcon className="w-5 h-5 mr-2" /> Settings</h2>
            
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <div className="font-medium">Allow New Reunions</div>
                  <div className="text-xs text-muted-foreground">Global toggle for creation</div>
                </div>
                <Switch 
                  checked={settings.reunionCreationEnabled} 
                  onCheckedChange={handleToggleCreation}
                  disabled={updateSettingsMutation.isPending}
                />
              </div>
              <div className="pt-2 text-sm text-muted-foreground">
                <span className="font-bold text-foreground block mb-1">System Stats</span>
                <ul className="space-y-1">
                  <li>Total Users: {users.length}</li>
                  <li>Total Reunions: {adminReunions.length}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-1 md:col-span-2 flex flex-col gap-8">
          <section>
            <h2 className="font-serif text-2xl font-bold mb-4 flex items-center"><CalendarDays className="w-6 h-6 mr-2 text-primary" /> All Reunions</h2>
            <div className="bg-card border shadow-sm rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-3">Name / Code</th>
                      <th className="px-4 py-3">Dates</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {adminReunions.map(r => (
                      <tr key={r.reunion.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-bold">{r.reunion.name}</div>
                          <div className="font-mono text-xs text-primary">{r.reunion.code}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {format(new Date(r.reunion.startDate), 'MMM d')} - {format(new Date(r.reunion.endDate), 'MMM d, yyyy')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setLocation(`/organize/${r.reunion.id}`)}>
                            Manage <ArrowRight className="w-4 h-4 ml-1" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {adminReunions.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No reunions exist.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-serif text-2xl font-bold mb-4 flex items-center"><Users className="w-6 h-6 mr-2 text-primary" /> Users</h2>
            <div className="bg-card border shadow-sm rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Stats</th>
                      <th className="px-4 py-3">Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium truncate max-w-[200px]">{u.email}</div>
                          {u.firstName && <div className="text-xs text-muted-foreground">{u.firstName} {u.lastName}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div>{u.registrationCount} regs</div>
                          <div>{u.attendeeCount} pax</div>
                        </td>
                        <td className="px-4 py-3">
                          <Switch 
                            checked={u.isAdmin} 
                            onCheckedChange={() => handleToggleAdmin(u.id, u.isAdmin)} 
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
