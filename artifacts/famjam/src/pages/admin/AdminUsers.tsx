import { useAdminListUsers, useAdminToggleAdminFlag } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Users as UsersIcon, Shield, Search, Loader2 } from "lucide-react";
import { queryClient } from "../../lib/queryClient";
import { useState } from "react";

export function AdminUsers() {
  const { data: users, isLoading } = useAdminListUsers();
  const toggleAdmin = useAdminToggleAdminFlag();
  const [searchTerm, setSearchTerm] = useState("");

  const handleToggleAdmin = async (id: string, currentEmail: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    const action = nextStatus ? "Grant admin access to" : "Remove admin access from";
    
    if (confirm(`${action} ${currentEmail}?`)) {
      await toggleAdmin.mutateAsync({ id: String(id), data: { isAdmin: nextStatus } });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    }
  };

  const filteredUsers = users?.filter(user => 
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (user.firstName && user.firstName.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (user.lastName && user.lastName.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex items-center gap-4">
        <div className="bg-primary/10 text-primary p-3 rounded-2xl">
          <UsersIcon className="w-8 h-8" />
        </div>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-secondary">User Management</h1>
      </div>

      <div className="bg-card border shadow-sm rounded-3xl overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-muted/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search users..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b">
              <tr>
                <th className="px-6 py-4 font-bold">User</th>
                <th className="px-6 py-4 font-bold text-center">Registrations</th>
                <th className="px-6 py-4 font-bold text-center">Attendees</th>
                <th className="px-6 py-4 font-bold">Joined</th>
                <th className="px-6 py-4 font-bold text-right">Admin Role</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </td>
                </tr>
              ) : !filteredUsers.length ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-foreground">
                        {user.firstName || user.lastName ? `${user.firstName || ''} ${user.lastName || ''}` : 'Unknown Name'}
                      </div>
                      <div className="text-muted-foreground text-xs mt-0.5">{user.email}</div>
                    </td>
                    <td className="px-6 py-4 text-center font-bold">
                      {user.registrationCount}
                    </td>
                    <td className="px-6 py-4 text-center font-bold">
                      {user.attendeeCount}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                      {format(new Date(user.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <label className="inline-flex items-center cursor-pointer justify-end">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={user.isAdmin}
                          onChange={() => handleToggleAdmin(user.id, user.email, user.isAdmin)}
                          disabled={toggleAdmin.isPending}
                        />
                        <div className="relative w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        {user.isAdmin && <Shield className="w-4 h-4 ml-2 text-primary" />}
                      </label>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
