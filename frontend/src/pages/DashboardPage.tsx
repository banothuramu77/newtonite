import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, TrendingUp, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getTeams } from '../api/teams';
import { getWorkItems } from '../api/workItems';
import { WorkItem, WorkItemStatus } from '../types';
import WorkItemCard from '../components/WorkItemCard';
import { StatusBadge } from '../components/StatusBadge';
import { formatDistanceToNow } from 'date-fns';

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="animate-pulse bg-gray-200 rounded-lg h-24 w-full" />;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const today = format(new Date(), 'EEEE, MMMM d, yyyy');

  // Fetch user's teams
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: getTeams,
  });

  // Fetch all open items across user's teams
  const { data: openData, isLoading: openLoading } = useQuery({
    queryKey: ['workItems', 'dashboard', 'open'],
    queryFn: () => getWorkItems({ status: 'OPEN', limit: 100 }),
    enabled: teams.length > 0,
  });

  const { data: inProgressData } = useQuery({
    queryKey: ['workItems', 'dashboard', 'inProgress'],
    queryFn: () => getWorkItems({ status: 'IN_PROGRESS', limit: 100 }),
    enabled: teams.length > 0,
  });

  const { data: pendingData } = useQuery({
    queryKey: ['workItems', 'dashboard', 'pending'],
    queryFn: () => getWorkItems({ status: 'PENDING_APPROVAL', limit: 100 }),
    enabled: teams.length > 0,
  });

  const { data: criticalData } = useQuery({
    queryKey: ['workItems', 'dashboard', 'critical'],
    queryFn: () => getWorkItems({ priority: 'CRITICAL', limit: 100 }),
    enabled: teams.length > 0,
  });
  const { data: recentData } = useQuery({
    queryKey: ['workItems', 'dashboard', 'recent'],
    queryFn: () => getWorkItems({ sort_by: 'updated_at', sort_order: 'desc', limit: 10 }),
    enabled: teams.length > 0,
  });

  // My assigned work items
  const { data: myItemsData, isLoading: myItemsLoading } = useQuery({
    queryKey: ['workItems', 'mine', user?.id],
    queryFn: () => getWorkItems({ assignee_id: user?.id, limit: 10 }),
    enabled: !!user?.id,
  });

  const myItems: WorkItem[] = myItemsData?.items ?? [];
  const isLoading = teamsLoading || openLoading;

  // Recent activity — simulated from work items updated_at for now
  const recentItems = useMemo(() => recentData?.items ?? [], [recentData]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operations Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">{today}</p>
        </div>
        <Link to="/work-items/new" className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Work Item
        </Link>
      </div>

      {/* Stats */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Overview
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Open Items"
              value={openData?.total ?? 0}
              icon={TrendingUp}
              color="bg-gray-100 text-gray-600"
            />
            <StatCard
              label="In Progress"
              value={inProgressData?.total ?? 0}
              icon={Clock}
              color="bg-blue-100 text-blue-600"
            />
            <StatCard
              label="Pending Approval"
              value={pendingData?.total ?? 0}
              icon={CheckCircle}
              color="bg-yellow-100 text-yellow-600"
            />
            <StatCard
              label="Critical Priority"
              value={criticalData?.total ?? 0}
              icon={AlertTriangle}
              color="bg-red-100 text-red-600"
            />
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* My Work Items */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              My Work Items
            </h2>
            <Link
              to={`/work-items?assignee_id=${user?.id}`}
              className="text-xs text-brand-600 hover:text-brand-700"
            >
              View all
            </Link>
          </div>
          {myItemsLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse bg-gray-200 rounded-xl h-20" />
              ))}
            </div>
          ) : myItems.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-gray-500 text-sm">No work items assigned to you</p>
              <Link to="/work-items/new" className="mt-3 inline-block text-sm text-brand-600 hover:text-brand-700">
                Create your first work item
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {myItems.map((item) => (
                <WorkItemCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>

        {/* Recent Activity */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Recently Updated
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse bg-gray-200 rounded h-10" />
              ))}
            </div>
          ) : recentItems.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-gray-500 text-sm">No recent activity</p>
            </div>
          ) : (
            <div className="card divide-y divide-gray-100">
              {recentItems.map((item) => (
                <Link
                  key={item.id}
                  to={`/work-items/${item.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                    <p className="text-xs text-gray-400">
                      {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                  <StatusBadge status={item.status as WorkItemStatus} className="ml-3 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* My Teams */}
      {teams.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            My Teams
          </h2>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <Link
                key={team.id}
                to={`/teams/${team.id}`}
                className="card px-4 py-2 text-sm font-medium text-gray-700 hover:border-brand-300 hover:text-brand-700 transition-colors"
              >
                {team.name}
                {team.memberCount != null && (
                  <span className="ml-2 text-xs text-gray-400">{team.memberCount} members</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
