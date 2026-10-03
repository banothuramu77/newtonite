import { FormEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  assignWorkItem,
  changeStatus,
  getWorkItem,
  addComment,
  updateWorkItem,
} from '../api/workItems';
import { getTeam } from '../api/teams';
import { useAuthStore } from '../store/authStore';
import { WorkItemStatus } from '../types';
import { PriorityBadge, StatusBadge } from '../components/StatusBadge';
import { WorkItemPriority } from '../types';

const STATUS_OPTIONS: WorkItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'RESOLVED', 'CLOSED'];

export default function WorkItemDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [priorityDraft, setPriorityDraft] = useState<WorkItemPriority>('MEDIUM');
  const [tagsDraft, setTagsDraft] = useState('');
  const commentRequestKey = useRef(crypto.randomUUID());
  const detailQuery = useQuery({ queryKey: ['workItem', id], queryFn: () => getWorkItem(id), enabled: !!id });
  const item = detailQuery.data?.workItem;
  const teamQuery = useQuery({
    queryKey: ['team', item?.team_id],
    queryFn: () => getTeam(item!.team_id),
    enabled: !!item?.team_id,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workItem', id] }),
      queryClient.invalidateQueries({ queryKey: ['workItems'] }),
    ]);
  };
  const assignMutation = useMutation({
    mutationFn: (assigneeId: string | null) => assignWorkItem(id, { assignee_id: assigneeId, version: item!.version }),
    onSuccess: refresh,
  });
  const statusMutation = useMutation({
    mutationFn: (status: WorkItemStatus) => changeStatus(id, status, item!.version),
    onSuccess: refresh,
  });
  const editMutation = useMutation({
    mutationFn: () => updateWorkItem(id, {
      title: titleDraft.trim(),
      description: descriptionDraft.trim() || null,
      priority: priorityDraft,
      tags: tagsDraft.split(',').map((tag) => tag.trim()).filter(Boolean),
      version: item!.version,
    }),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const commentMutation = useMutation({
    mutationFn: () => addComment(id, comment.trim(), commentRequestKey.current),
    onSuccess: async () => {
      commentRequestKey.current = crypto.randomUUID();
      setComment('');
      await refresh();
    },
  });

  function submitComment(event: FormEvent) {
    event.preventDefault();
    if (comment.trim()) commentMutation.mutate();
  }

  if (detailQuery.isLoading) return <div className="p-6 text-sm text-gray-500">Loading work item…</div>;
  if (detailQuery.error || !detailQuery.data || !item) {
    return <div role="alert" className="p-6 text-sm text-red-600">{detailQuery.error?.message ?? 'Work item not found'}</div>;
  }
  const currentItem = item;
  const actionError = assignMutation.error ?? statusMutation.error ?? commentMutation.error;
  const memberRole = teamQuery.data?.members.find((member) => member.user_id === user?.id)?.role;
  const canEdit = memberRole === 'MEMBER' || memberRole === 'ADMIN';
  const ownAssignment = item.assignee_id === user?.id;
  const canClaim = !item.assignee_id || ownAssignment;

  function beginEditing() {
    setTitleDraft(currentItem.title);
    setDescriptionDraft(currentItem.description ?? '');
    setPriorityDraft(currentItem.priority);
    setTagsDraft(currentItem.tags.join(', '));
    editMutation.reset();
    setEditing(true);
  }

  async function reloadLatestItem() {
    const result = await detailQuery.refetch();
    if (result.data) {
      setTitleDraft(result.data.workItem.title);
      setDescriptionDraft(result.data.workItem.description ?? '');
      setPriorityDraft(result.data.workItem.priority);
      setTagsDraft(result.data.workItem.tags.join(', '));
      editMutation.reset();
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link to="/work-items" className="text-sm text-brand-700 hover:underline">← Work items</Link>
      <header className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-500">{teamQuery.data?.team.name ?? 'Team'}</p>
            <h1 className="mt-1 text-2xl font-bold">{item.title}</h1>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">{item.description || 'No description provided.'}</p>
          </div>
          <div className="flex flex-wrap gap-2"><StatusBadge status={item.status} /><PriorityBadge priority={item.priority} /></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          {canEdit && !editing && (
            <button className="btn-secondary" onClick={beginEditing}>Edit details</button>
          )}
          <span className="text-sm text-gray-600">Assigned to <strong>{item.assignee_name ?? (ownAssignment ? user?.name : 'Nobody')}</strong></span>
          {canClaim ? (
            <button className="btn-secondary" disabled={assignMutation.isPending} onClick={() => assignMutation.mutate(ownAssignment ? null : user!.id)}>
              {ownAssignment ? 'Release assignment' : 'Claim this item'}
            </button>
          ) : <span className="text-xs text-gray-500">Another teammate owns this item.</span>}
          <label className="ml-auto text-xs font-medium text-gray-500">Change status
            <select className="input mt-1 min-w-48" value={item.status} disabled={statusMutation.isPending} onChange={(e) => statusMutation.mutate(e.target.value as WorkItemStatus)}>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <span className="w-full text-xs text-gray-400">Version {item.version} · Updated {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}</span>
        </div>
        {item.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="badge bg-gray-100 text-gray-600">{tag}</span>)}</div>}
        {actionError && <p role="alert" className="mt-3 text-sm text-red-600">{actionError.message}</p>}
      </header>
      {editing && (
        <form
          className="card p-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (titleDraft.trim()) editMutation.mutate();
          }}
        >
          <h2 className="font-semibold">Edit work item</h2>
          <label className="block text-sm font-medium">Title
            <input className="input mt-1" value={titleDraft} maxLength={255} required onChange={(event) => setTitleDraft(event.target.value)} />
          </label>
          <label className="block text-sm font-medium">Description
            <textarea className="input mt-1 min-h-24" value={descriptionDraft} maxLength={5000} onChange={(event) => setDescriptionDraft(event.target.value)} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">Priority
              <select className="input mt-1" value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as WorkItemPriority)}>
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as WorkItemPriority[]).map((priority) => <option key={priority}>{priority}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Tags <span className="font-normal text-gray-400">(comma-separated)</span>
              <input className="input mt-1" value={tagsDraft} onChange={(event) => setTagsDraft(event.target.value)} />
            </label>
          </div>
          {editMutation.error && (
            <div role="alert" className="text-sm text-red-600">
              <p>{editMutation.error.message}</p>
              {editMutation.error.message.startsWith('409:') && (
                <button type="button" className="mt-1 underline" onClick={reloadLatestItem}>
                  Reload latest version and discard stale edits
                </button>
              )}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn-primary" disabled={editMutation.isPending || !titleDraft.trim()}>
              {editMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-semibold">Comments ({detailQuery.data.comments.length})</h2>
          <div className="card divide-y divide-gray-100">
            {detailQuery.data.comments.length ? detailQuery.data.comments.map((entry) => (
              <article key={entry.id} className="p-4">
                <div className="flex justify-between gap-3"><strong className="text-sm">{entry.user_name ?? 'Teammate'}</strong><time className="text-xs text-gray-400">{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</time></div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{entry.content}</p>
              </article>
            )) : <p className="p-4 text-sm text-gray-500">No comments yet.</p>}
          </div>
          <form onSubmit={submitComment} className="mt-3 space-y-2">
            <label htmlFor="comment" className="sr-only">Add a comment</label>
            <textarea id="comment" className="input min-h-24" value={comment} onChange={(e) => { commentRequestKey.current = crypto.randomUUID(); setComment(e.target.value); }} maxLength={5000} placeholder="Share an update…" required />
            <button className="btn-primary" disabled={!comment.trim() || commentMutation.isPending}>{commentMutation.isPending ? 'Posting…' : 'Add comment'}</button>
          </form>
        </div>
        <div>
          <h2 className="mb-3 font-semibold">Activity history</h2>
          <ol className="card divide-y divide-gray-100">
            {detailQuery.data.activityLog.length ? detailQuery.data.activityLog.map((entry) => (
              <li key={entry.id} className="p-4">
                <p className="text-sm font-medium">{entry.action.replace(/_/g, ' ')}{entry.field_name ? ` · ${entry.field_name}` : ''}</p>
                {entry.comment && <p className="mt-1 text-sm text-gray-600">{entry.comment}</p>}
                {(entry.old_value || entry.new_value) && <p className="mt-1 text-xs text-gray-500">{entry.old_value ?? '—'} → {entry.new_value ?? '—'}</p>}
                <p className="mt-1 text-xs text-gray-400">{entry.user_name ?? 'Teammate'} · {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</p>
              </li>
            )) : <li className="p-4 text-sm text-gray-500">No activity recorded.</li>}
          </ol>
        </div>
      </section>
    </div>
  );
}
