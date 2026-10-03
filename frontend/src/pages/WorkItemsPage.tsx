import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getTeams } from '../api/teams';
import { getWorkItems } from '../api/workItems';
import { WorkItemStatus, WorkItemPriority } from '../types';
import WorkItemCard from '../components/WorkItemCard';

const STATUSES: WorkItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'RESOLVED', 'CLOSED'];
const PRIORITIES: WorkItemPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function WorkItemsPage() {
  const [params, setParams] = useSearchParams();
  const { data: teams = [], isLoading: teamsLoading } = useQuery({ queryKey: ['teams'], queryFn: getTeams });
  const teamId = params.get('team_id') || teams[0]?.id || '';
  const queryParams = useMemo(() => ({
    team_id: teamId,
    status: (params.get('status') || undefined) as WorkItemStatus | undefined,
    priority: (params.get('priority') || undefined) as WorkItemPriority | undefined,
    assignee_id: params.get('assignee_id') || undefined,
    search: params.get('q') || undefined,
    page: Number(params.get('page') || 1),
    limit: 20,
    sort_by: 'updated_at' as const,
    sort_order: 'desc' as const,
  }), [teamId, params]);
  const itemsQuery = useQuery({
    queryKey: ['workItems', queryParams],
    queryFn: () => getWorkItems(queryParams),
    enabled: !!teamId,
  });
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Work items</h1><p className="mt-1 text-sm text-gray-500">Filter and prioritize your team’s operational work.</p></div>
        <Link to="/work-items/new" className="btn-primary inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Create</Link>
      </header>
      <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-gray-600">Team
          <select className="input mt-1" value={teamId} onChange={(e) => setFilter('team_id', e.target.value)}>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Status
          <select className="input mt-1" value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>{STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Priority
          <select className="input mt-1" value={params.get('priority') ?? ''} onChange={(e) => setFilter('priority', e.target.value)}>
            <option value="">All priorities</option>{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Search this team
          <input className="input mt-1" value={params.get('q') ?? ''} onChange={(e) => setFilter('q', e.target.value)} placeholder="Title or description" />
        </label>
      </div>
      {teamsLoading || itemsQuery.isLoading ? <p className="text-sm text-gray-500">Loading work items…</p> : null}
      {itemsQuery.error ? <p role="alert" className="text-sm text-red-600">{itemsQuery.error.message}</p> : null}
      {!teamsLoading && !teamId && <div className="card p-8 text-center text-sm text-gray-500">Join or create a team to see its work items.</div>}
      {teamId && itemsQuery.data && (
        <>
          <p className="text-sm text-gray-500">{itemsQuery.data.total} matching item{itemsQuery.data.total === 1 ? '' : 's'}</p>
          {itemsQuery.data.items.length ? <div className="grid gap-3 md:grid-cols-2">{itemsQuery.data.items.map((item) => <WorkItemCard key={item.id} item={item} searchTerm={queryParams.search} />)}</div> : <div className="card p-8 text-center text-sm text-gray-500">No matching work items.</div>}
          {itemsQuery.data.total_pages > 1 && (
            <div className="flex justify-center gap-3">
              <button className="btn-secondary" disabled={queryParams.page <= 1} onClick={() => setFilter('page', String(queryParams.page - 1))}>Previous</button>
              <span className="self-center text-sm text-gray-500">Page {itemsQuery.data.page} of {itemsQuery.data.total_pages}</span>
              <button className="btn-secondary" disabled={queryParams.page >= itemsQuery.data.total_pages} onClick={() => setFilter('page', String(queryParams.page + 1))}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
