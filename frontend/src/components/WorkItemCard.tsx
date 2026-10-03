import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { User, Tag } from 'lucide-react';
import { WorkItem } from '../types';
import { StatusBadge, PriorityBadge } from './StatusBadge';

interface WorkItemCardProps {
  item: WorkItem;
  searchTerm?: string;
}

function highlight(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function WorkItemCard({ item, searchTerm = '' }: WorkItemCardProps) {
  const age = formatDistanceToNow(new Date(item.created_at), { addSuffix: true });

  return (
    <Link
      to={`/work-items/${item.id}`}
      className="card block p-4 hover:shadow-md transition-shadow hover:border-brand-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate text-sm">
            {highlight(item.title, searchTerm)}
          </h3>
          {item.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
              {highlight(item.description, searchTerm)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PriorityBadge priority={item.priority} />
          <StatusBadge status={item.status} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {item.team_name && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-brand-400 inline-block" />
            {item.team_name}
          </span>
        )}
        <span className="flex items-center gap-1">
          <User className="w-3 h-3" />
          {item.assignee_name ?? 'Unassigned'}
        </span>
        <span className="ml-auto text-gray-400">{age}</span>
      </div>

      {item.tags && item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs"
            >
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
