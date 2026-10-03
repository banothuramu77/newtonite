import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addTeamMember, getTeam, removeTeamMember, updateMemberRole } from '../api/teams';
import { getWorkItems } from '../api/workItems';
import WorkItemCard from '../components/WorkItemCard';
import { useAuthStore } from '../store/authStore';
import { TeamRole } from '../types';

export default function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<TeamRole>('MEMBER');
  const teamQuery = useQuery({ queryKey: ['team', teamId], queryFn: () => getTeam(teamId), enabled: !!teamId });
  const itemsQuery = useQuery({
    queryKey: ['workItems', { team_id: teamId, page: 1, limit: 50 }],
    queryFn: () => getWorkItems({ team_id: teamId, page: 1, limit: 50, sort_by: 'updated_at', sort_order: 'desc' }),
    enabled: !!teamId,
  });
  const refreshTeam = () => queryClient.invalidateQueries({ queryKey: ['team', teamId] });
  const addMutation = useMutation({
    mutationFn: () => addTeamMember(teamId, newUserId.trim(), newRole),
    onSuccess: async () => {
      setNewUserId('');
      await refreshTeam();
    },
  });
  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamRole }) =>
      updateMemberRole(teamId, userId, role),
    onSuccess: refreshTeam,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeTeamMember(teamId, userId),
    onSuccess: refreshTeam,
  });

  function addMember(event: FormEvent) {
    event.preventDefault();
    if (newUserId.trim()) addMutation.mutate();
  }

  if (teamQuery.isLoading || itemsQuery.isLoading) return <div className="p-6 text-sm text-gray-500">Loading team…</div>;
  if (teamQuery.error || itemsQuery.error || !teamQuery.data) {
    return <div role="alert" className="p-6 text-sm text-red-600">{teamQuery.error?.message ?? itemsQuery.error?.message ?? 'Team not found'}</div>;
  }

  const { team, members } = teamQuery.data;
  const isAdmin = members.some((member) => member.user_id === user?.id && member.role === 'ADMIN');
  const membershipError = addMutation.error ?? roleMutation.error ?? removeMutation.error;
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link to="/teams" className="text-sm text-brand-700 hover:underline">← Teams</Link>
          <h1 className="mt-2 text-2xl font-bold">{team.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{team.description || 'No description provided.'}</p>
        </div>
        <Link to={`/work-items/new?team_id=${team.id}`} className="btn-primary">New work item</Link>
      </header>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Work items</h2>
        {itemsQuery.data?.items.length ? (
          <div className="grid gap-3 md:grid-cols-2">{itemsQuery.data.items.map((item) => <WorkItemCard key={item.id} item={item} />)}</div>
        ) : <div className="card p-8 text-center text-sm text-gray-500">No work items in this team yet.</div>}
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Members ({members.length})</h2>
        {isAdmin && (
          <form onSubmit={addMember} className="card mb-3 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]">
            <label className="text-xs font-medium text-gray-600">User ID
              <input
                className="input mt-1"
                value={newUserId}
                onChange={(event) => setNewUserId(event.target.value)}
                placeholder="UUID of an existing account"
                required
              />
            </label>
            <label className="text-xs font-medium text-gray-600">Role
              <select className="input mt-1" value={newRole} onChange={(event) => setNewRole(event.target.value as TeamRole)}>
                <option value="MEMBER">Member</option>
                <option value="VIEWER">Viewer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
            <button className="btn-primary self-end" disabled={addMutation.isPending}>
              {addMutation.isPending ? 'Adding…' : 'Add member'}
            </button>
            {membershipError && <p role="alert" className="sm:col-span-3 text-sm text-red-600">{membershipError.message}</p>}
          </form>
        )}
        <div className="card divide-y divide-gray-100">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between px-4 py-3">
              <div><p className="text-sm font-medium">{member.user?.name ?? member.name ?? member.user_id}</p><p className="text-xs text-gray-500">{member.email}</p></div>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`role-${member.user_id}`}>Role for {member.name ?? member.user_id}</label>
                  <select
                    id={`role-${member.user_id}`}
                    className="input w-auto"
                    value={member.role}
                    disabled={roleMutation.isPending}
                    onChange={(event) => roleMutation.mutate({ userId: member.user_id, role: event.target.value as TeamRole })}
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="MEMBER">Member</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    type="button"
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                    disabled={removeMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.name ?? 'this user'} from ${team.name}?`)) {
                        removeMutation.mutate(member.user_id);
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : <span className="badge bg-gray-100 text-gray-700">{member.role}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
