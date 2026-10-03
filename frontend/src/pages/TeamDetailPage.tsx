import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTeam } from '../api/teams';
import { getWorkItems } from '../api/workItems';
import WorkItemCard from '../components/WorkItemCard';

export default function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const teamQuery = useQuery({ queryKey: ['team', teamId], queryFn: () => getTeam(teamId), enabled: !!teamId });
  const itemsQuery = useQuery({
    queryKey: ['workItems', { team_id: teamId, page: 1, limit: 50 }],
    queryFn: () => getWorkItems({ team_id: teamId, page: 1, limit: 50, sort_by: 'updated_at', sort_order: 'desc' }),
    enabled: !!teamId,
  });

  if (teamQuery.isLoading || itemsQuery.isLoading) return <div className="p-6 text-sm text-gray-500">Loading team…</div>;
  if (teamQuery.error || itemsQuery.error || !teamQuery.data) {
    return <div role="alert" className="p-6 text-sm text-red-600">{teamQuery.error?.message ?? itemsQuery.error?.message ?? 'Team not found'}</div>;
  }

  const { team, members } = teamQuery.data;
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
        <div className="card divide-y divide-gray-100">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between px-4 py-3">
              <div><p className="text-sm font-medium">{member.user?.name ?? member.name ?? member.user_id}</p><p className="text-xs text-gray-500">{member.email}</p></div>
              <span className="badge bg-gray-100 text-gray-700">{member.role}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
