import { useAdminGetSettings, getAdminGetSettingsQueryKey, useAdminUpdateSettings, useAdminListReunions, getAdminListReunionsQueryKey, useAdminListUsers, useAdminToggleAdminFlag, getAdminListUsersQueryKey, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Shield, Settings as SettingsIcon, Users, CalendarDays, Power, ArrowRight, ShieldCheck, Mail, X, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Input } from "../../components/ui/input";
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

  const { data: adminSettings } = useAdminGetSettings({
    query: { enabled: !!adminReunions, queryKey: getAdminGetSettingsQueryKey() }
  });
  const updateSettingsMutation = useAdminUpdateSettings();
  const toggleAdminMutation = useAdminToggleAdminFlag();
  const { data: users } = useAdminListUsers({ query: { enabled: !!adminReunions, queryKey: getAdminListUsersQueryKey() } });

  const [newTesterEmail, setNewTesterEmail] = useState("");

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
        queryClient.invalidateQueries({ queryKey: getAdminGetSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: enabled ? "Creation Enabled" : "Creation Disabled" });
      }
    });
  };

  const handleToggleLockdown = (locked: boolean) => {
    if (locked && !confirm("WARNING: This will block all regular users from accessing the app. Only platform admins, organizers, and listed testers will be able to sign in. Are you sure?")) {
      return;
    }
    updateSettingsMutation.mutate({ data: { signInsLocked: locked } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetSettingsQueryKey() });
        toast({ title: locked ? "Platform Locked Down" : "Lockdown Lifted" });
      }
    });
  };

  const handleAddTester = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSettings || !newTesterEmail.trim()) return;
    const email = newTesterEmail.trim().toLowerCase();
    if (adminSettings.testerEmails.includes(email)) {
      setNewTesterEmail("");
      return;
    }
    const newEmails = [...adminSettings.testerEmails, email];
    updateSettingsMutation.mutate({ data: { testerEmails: newEmails } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetSettingsQueryKey() });
        setNewTesterEmail("");
      }
    });
  };

  const handleRemoveTester = (email: string) => {
    if (!adminSettings) return;
    const newEmails = adminSettings.testerEmails.filter(e => e !== email);
    updateSettingsMutation.mutate({ data: { testerEmails: newEmails } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetSettingsQueryKey() });
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

  if (loadingReunions || !adminReunions || !adminSettings || !users) {
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
                  checked={adminSettings.reunionCreationEnabled} 
                  onCheckedChange={handleToggleCreation}
                  disabled={updateSettingsMutation.isPending}
                />
              </div>

              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <div className="font-medium text-destructive flex items-center"><Shield className="w-4 h-4 mr-1"/> Sign-In Lockdown</div>
                  <div className="text-xs text-muted-foreground">Blocks all non-organizer/tester sign-ins</div>
                </div>
                <Switch 
                  checked={adminSettings.signInsLocked} 
                  onCheckedChange={handleToggleLockdown}
                  disabled={updateSettingsMutation.isPending}
                  className="data-[state=checked]:bg-destructive"
                />
              </div>

              <div className="pt-2 pb-4 border-b">
                <div className="font-bold text-sm mb-2 flex items-center"><Mail className="w-4 h-4 mr-1"/> Tester Emails</div>
                <div className="text-xs text-muted-foreground mb-3">Allowed to sign in during lockdown</div>
                
                <form onSubmit={handleAddTester} className="flex gap-2 mb-3">
                  <Input 
                    type="email" 
                    placeholder="tester@example.com" 
                    value={newTesterEmail}
                    onChange={(e) => setNewTesterEmail(e.target.value)}
                    className="h-8 text-sm rounded-lg"
                    disabled={updateSettingsMutation.isPending}
                  />
                  <Button type="submit" size="sm" className="h-8 rounded-lg" disabled={!newTesterEmail.trim() || updateSettingsMutation.isPending}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </form>
                
                {adminSettings.testerEmails.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">No testers configured.</div>
                ) : (
                  <ul className="space-y-1">
                    {adminSettings.testerEmails.map(email => (
                      <li key={email} className="flex items-center justify-between bg-muted/50 px-2 py-1.5 rounded-md text-xs font-mono">
                        <span className="truncate">{email}</span>
                        <button 
                          onClick={() => handleRemoveTester(email)}
                          disabled={updateSettingsMutation.isPending}
                          className="text-muted-foreground hover:text-destructive"
                          title="Remove tester"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
