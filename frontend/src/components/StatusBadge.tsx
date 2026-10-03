import { WorkItemStatus, WorkItemPriority } from '../types';

interface StatusBadgeProps {
  status: WorkItemStatus;
  className?: string;
}

interface PriorityBadgeProps {
  priority: WorkItemPriority;
  className?: string;
}

const STATUS_CONFIG: Record<WorkItemStatus, { label: string; className: string }> = {
  OPEN: { label: 'Open', className: 'bg-gray-100 text-gray-700' },
  IN_PROGRESS: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
  PENDING_APPROVAL: { label: 'Pending Approval', className: 'bg-yellow-100 text-yellow-700' },
  APPROVED: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  RESOLVED: { label: 'Resolved', className: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: 'Closed', className: 'bg-red-100 text-red-700' },
};

const PRIORITY_CONFIG: Record<WorkItemPriority, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'bg-gray-100 text-gray-600' },
  MEDIUM: { label: 'Medium', className: 'bg-blue-100 text-blue-600' },
  HIGH: { label: 'High', className: 'bg-orange-100 text-orange-600' },
  CRITICAL: { label: 'Critical', className: 'bg-red-100 text-red-700 font-semibold' },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`badge ${config.className} ${className}`}>
      {config.label}
    </span>
  );
}

export function PriorityBadge({ priority, className = '' }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority] ?? { label: priority, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`badge ${config.className} ${className}`}>
      {config.label}
    </span>
  );
}

export { STATUS_CONFIG, PRIORITY_CONFIG };
