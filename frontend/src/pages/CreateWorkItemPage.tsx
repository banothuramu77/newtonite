import { FormEvent, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createWorkItem } from '../api/workItems';
import { getTeams } from '../api/teams';
import { WorkItemPriority } from '../types';

export default function CreateWorkItemPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { data: teams = [], isLoading } = useQuery({ queryKey: ['teams'], queryFn: getTeams });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState(params.get('team_id') ?? '');
  const [priority, setPriority] = useState<WorkItemPriority>('MEDIUM');
  const [tags, setTags] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () => createWorkItem({
      title: title.trim(),
      description: description.trim() || undefined,
      team_id: teamId,
      priority,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    }, idempotencyKey.current),
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({ queryKey: ['workItems'] });
      navigate(`/work-items/${item.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() && teamId) mutation.mutate();
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <Link to="/work-items" className="text-sm text-brand-700 hover:underline">← Work items</Link>
      <div><h1 className="text-2xl font-bold">Create work item</h1><p className="mt-1 text-sm text-gray-500">Capture the issue, owner context, and urgency.</p></div>
      {teams.length === 0 && !isLoading ? <div className="card p-6 text-sm text-gray-600">Create or join a team before adding work items.</div> : (
        <form onSubmit={submit} className="card p-6 space-y-4">
          <label className="block text-sm font-medium">Title<input className="input mt-1" value={title} onChange={(e) => { idempotencyKey.current = crypto.randomUUID(); setTitle(e.target.value); }} maxLength={255} required /></label>
          <label className="block text-sm font-medium">Description<textarea className="input mt-1 min-h-32" value={description} onChange={(e) => { idempotencyKey.current = crypto.randomUUID(); setDescription(e.target.value); }} maxLength={5000} placeholder="Why does this request exist and what needs to happen?" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">Team<select className="input mt-1" value={teamId} onChange={(e) => { idempotencyKey.current = crypto.randomUUID(); setTeamId(e.target.value); }} required><option value="" disabled>Select team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label className="block text-sm font-medium">Priority<select className="input mt-1" value={priority} onChange={(e) => { idempotencyKey.current = crypto.randomUUID(); setPriority(e.target.value as WorkItemPriority); }}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label className="block text-sm font-medium">Tags <span className="font-normal text-gray-400">(comma-separated)</span><input className="input mt-1" value={tags} onChange={(e) => { idempotencyKey.current = crypto.randomUUID(); setTags(e.target.value); }} placeholder="customer, payments" /></label>
          {mutation.error && <p role="alert" className="text-sm text-red-600">{mutation.error.message}</p>}
          <div className="flex justify-end gap-3"><Link to="/work-items" className="btn-secondary">Cancel</Link><button className="btn-primary" disabled={mutation.isPending || !teamId}>{mutation.isPending ? 'Creating…' : 'Create item'}</button></div>
        </form>
      )}
    </div>
  );
}
