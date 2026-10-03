import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { createTeam, getTeams } from '../api/teams';

export default function TeamsPage() {
  const queryClient = useQueryClient();
  const { data: teams = [], isLoading, error } = useQuery({
    queryKey: ['teams'],
    queryFn: getTeams,
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMutation = useMutation({
    mutationFn: () => createTeam(name.trim(), description.trim() || undefined),
    onSuccess: async () => {
      setName('');
      setDescription('');
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) createMutation.mutate();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Teams</h1>
        <p className="mt-1 text-sm text-gray-500">Work is visible only to members of its team.</p>
      </header>
      <form onSubmit={submit} className="card p-5 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
        <label className="sr-only" htmlFor="team-name">Team name</label>
        <input id="team-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Team name" maxLength={100} required />
        <label className="sr-only" htmlFor="team-description">Description</label>
        <input id="team-description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this team handle?" maxLength={500} />
        <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={createMutation.isPending}>
          <Plus className="w-4 h-4" /> Create team
        </button>
        {createMutation.isError && <p className="md:col-span-3 text-sm text-red-600">{createMutation.error.message}</p>}
      </form>
      {isLoading ? <p className="text-sm text-gray-500">Loading teams…</p> : null}
      {error ? <p role="alert" className="text-sm text-red-600">{error.message}</p> : null}
      {!isLoading && teams.length === 0 && (
        <div className="card p-10 text-center text-gray-500">You are not a member of any teams yet. Create one to get started.</div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team) => (
          <Link key={team.id} to={`/teams/${team.id}`} className="card p-5 hover:border-brand-300 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">{team.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{team.description || 'No description provided.'}</p>
              </div>
              <Users className="w-5 h-5 text-brand-600" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
