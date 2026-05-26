import { useState, useMemo } from 'react';

interface Guest {
  id: string;
  name: string;
}

interface Table {
  id: string;
  name: string;
  guests: Guest[];
}

interface Props {
  tables: Table[];
}

export default function SeatingChart({ tables }: Props) {
  const [query, setQuery] = useState('');

  // Compute matched guest IDs
  const matchedGuestIds = useMemo(() => {
    if (query.trim().length < 2) return new Set<string>();
    const q = query.toLowerCase().trim();
    const ids = new Set<string>();
    tables.forEach((t) => {
      t.guests.forEach((g) => {
        if (g.name.toLowerCase().includes(q)) ids.add(g.id);
      });
    });
    return ids;
  }, [query, tables]);

  // Compute matched table IDs (tables that contain any matched guest)
  const matchedTableIds = useMemo(() => {
    const ids = new Set<string>();
    tables.forEach((t) => {
      if (t.guests.some((g) => matchedGuestIds.has(g.id))) ids.add(t.id);
    });
    return ids;
  }, [matchedGuestIds, tables]);

  const isSearching = query.trim().length >= 2;
  const matchCount = matchedGuestIds.size;

  return (
    <div>
      {/* Search bar */}
      <div className="max-w-md mx-auto mb-16 relative sticky top-4 z-30">
        <div className="bg-[#fcfbf9]/90 backdrop-blur-md border border-brand-title/15 rounded-xl p-3 shadow-lg shadow-brand-title/5">
          <div className="relative flex items-center">
            <svg
              className="w-5 h-5 text-brand-title/50 absolute left-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              id="guest-search"
              placeholder="Søk etter ditt eller andres navn..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-12 pr-10 py-3 rounded-lg border border-brand-title/10 bg-white font-sans text-brand-title focus:outline-none focus:ring-2 focus:ring-brand-title/50 focus:border-transparent text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-brand-title/40 hover:text-brand-title absolute right-4 focus:outline-none"
                aria-label="Tøm søk"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Result banner */}
        {isSearching && (
          <div className="mt-2 bg-brand-title text-brand-bg text-center py-2 px-4 rounded-lg font-sans text-xs shadow-md animate-fade-in">
            {matchCount > 0
              ? `Fant ${matchCount} treff!`
              : 'Ingen gjester funnet med det navnet.'}
          </div>
        )}
      </div>

      {/* Tables grid – now only name + guest list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {tables.map((table) => {
          const isHighlighted = isSearching && matchedTableIds.has(table.id);
          const isDimmed = isSearching && !matchedTableIds.has(table.id) && matchCount > 0;

          return (
            <div
              key={table.id}
              className={`bg-[#fcfbf9]/85 backdrop-blur-sm border rounded-2xl p-6 shadow-md transition-all duration-300 relative overflow-hidden flex flex-col justify-between ${
                isHighlighted
                  ? 'border-brand-text/50 shadow-lg shadow-brand-text/10 scale-[1.02] bg-[#fffdfa]'
                  : isDimmed
                  ? 'border-brand-title/5 opacity-40'
                  : 'border-brand-title/10 hover:shadow-lg'
              }`}
            >
              <h3
                className={`font-serif text-2xl text-center mb-8 transition-colors duration-300 ${
                  isHighlighted ? 'text-brand-text' : 'text-brand-title'
                }`}
              >
                {table.name}
              </h3>

              <div className="w-12 h-px bg-brand-title/10 mx-auto mb-6" />

              {/* Guest list */}
              <div className="space-y-2">
                <h4 className="text-xs uppercase font-bold tracking-wider text-brand-title/50 mb-3 text-center">
                  Gjesteliste
                </h4>
                <ul className="space-y-1.5 font-sans">
                  {table.guests.map((guest) => {
                    const isMatch = matchedGuestIds.has(guest.id);
                    return (
                      <li
                        key={guest.id}
                        className={`text-sm px-2 py-1 rounded transition duration-150 flex items-center justify-between ${
                          isMatch
                            ? 'bg-brand-text/8 text-brand-text font-bold border-l-2 border-brand-text pl-1.5'
                            : 'text-brand-title/80 hover:text-brand-text hover:bg-brand-title/5'
                        }`}
                      >
                        <span className="font-medium">{guest.name}</span>
                      </li>
                    );
                  })}
                  {table.guests.length === 0 && (
                    <li className="text-xs text-brand-title/40 italic text-center py-2">
                      Ingen gjester plassert på dette bordet ennå.
                    </li>
                  )}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
