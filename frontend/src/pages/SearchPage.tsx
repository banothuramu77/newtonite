import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { searchWorkItems } from '../api/workItems';
import WorkItemCard from '../components/WorkItemCard';

export default function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const searchQuery = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchWorkItems(query, { page: 1, limit: 20 }),
    enabled: query.trim().length > 0,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input.trim());
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header><h1 className="text-2xl font-bold">Search work</h1><p className="mt-1 text-sm text-gray-500">Search items across all teams you belong to.</p></header>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="search-query" className="sr-only">Search work items</label>
        <input id="search-query" className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search by title or description" />
        <button className="btn-primary inline-flex items-center gap-2"><Search className="w-4 h-4" /> Search</button>
      </form>
      {searchQuery.isFetching && <p className="text-sm text-gray-500">Searching…</p>}
      {searchQuery.error && <p role="alert" className="text-sm text-red-600">{searchQuery.error.message}</p>}
      {query && searchQuery.data && (
        <>
          <p className="text-sm text-gray-500">{searchQuery.data.total} result{searchQuery.data.total === 1 ? '' : 's'} for “{query}”</p>
          {searchQuery.data.items.length ? <div className="grid gap-3 md:grid-cols-2">{searchQuery.data.items.map((item) => <WorkItemCard key={item.id} item={{ ...item, tags: Array.isArray(item.tags) ? item.tags : [] }} searchTerm={query} />)}</div> : <div className="card p-8 text-center text-sm text-gray-500">No matching items found.</div>}
        </>
      )}
    </div>
  );
}
