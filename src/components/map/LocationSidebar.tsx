import { Icon } from "../ui/Icon";
import { getLabelForEmoji } from "./popup";
import type { WeddingLocation } from "./types";

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  locations: WeddingLocation[];
  selectedId: string | null;
  onSelect: (loc: WeddingLocation) => void;
  onLocate: () => void;
  isLocating: boolean;
}

/** Collapsible panel (bottom sheet on mobile, left column on desktop) with search, geolocate and the location list. */
export function LocationSidebar({
  isOpen,
  onToggle,
  searchQuery,
  onSearchChange,
  locations,
  selectedId,
  onSelect,
  onLocate,
  isLocating,
}: Props) {
  const toggleLabel = isOpen ? "Kollaps panel" : "Ekspander panel";
  return (
    <div
      className={`bg-[#fcfbf9]/90 border-brand-title/10 flex flex-col z-20 transition-all duration-300 
        absolute bottom-0 left-0 right-0 border-t
        lg:relative lg:bottom-auto lg:left-auto lg:right-auto lg:border-t-0 lg:border-r lg:w-80 lg:h-full
        ${isOpen ? "h-[50%]" : "h-[72px]"}
      `}
    >
      {/* Search Header */}
      <div className="p-3 border-b border-brand-title/10 bg-brand-bg/20 flex flex-col gap-2 shrink-0">
        {/* Decorative Drag/Grab Handle (mobile only) */}
        <button
          type="button"
          aria-label={toggleLabel}
          className="lg:hidden block w-10 h-1 bg-brand-title/20 rounded-full mx-auto cursor-pointer border-0 p-0"
          onClick={onToggle}
        />

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Søk etter steder..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input-base flex-1 px-3 py-2 text-sm placeholder-brand-text/50 shadow-inner"
          />

          {/* Collapse/Expand Button (mobile only) */}
          <button
            type="button"
            onClick={onToggle}
            className="lg:hidden p-2 rounded-lg border border-brand-title/20 bg-brand-bg text-brand-title hover:bg-brand-title/5 transition"
            aria-label={toggleLabel}
          >
            <Icon
              name="chevronDown"
              className={`w-4 h-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
              title={toggleLabel}
            />
          </button>
        </div>

        <div className={`${isOpen ? "block" : "hidden lg:block"} mt-1`}>
          <button
            type="button"
            onClick={onLocate}
            disabled={isLocating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-bg border border-brand-title/20 rounded-lg text-xs font-semibold text-brand-title hover:bg-brand-title/5 hover:border-brand-title/40 active:bg-brand-title/10 transition disabled:opacity-50 select-none shadow-xs"
          >
            {isLocating ? (
              <>
                <div className="animate-spin h-3.5 w-3.5 border-2 border-brand-title/20 border-t-brand-title rounded-full"></div>
                <span>Henter posisjon...</span>
              </>
            ) : (
              <>
                <Icon name="mapPin" className="w-4 h-4" title="Vis posisjon" />
                <span>Vis min posisjon</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Location List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 divide-y divide-brand-title/5 select-none scrollbar-thin">
        {locations.length > 0 ? (
          locations.map((loc) => {
            const isSelected = loc.id === selectedId;
            const activeBgClass = isSelected
              ? "bg-brand-title/10 border-l-4 border-l-brand-title pl-2"
              : "hover:bg-brand-title/5 active:bg-brand-title/10 border-l-4 border-l-transparent";
            return (
              <button
                type="button"
                key={loc.id}
                onClick={() => onSelect(loc)}
                className={`w-full text-left p-3 pt-4 rounded-lg flex items-center gap-3 transition group border-0 bg-transparent cursor-pointer ${activeBgClass}`}
              >
                <span className="text-xl shrink-0 group-hover:scale-110 transition-transform">
                  {loc.ikon || "📍"}
                </span>
                <div className="min-w-0">
                  <p className="font-serif font-semibold text-brand-title text-base group-hover:text-brand-text transition-colors truncate">
                    {loc.name}
                  </p>
                  <p className="text-[10px] text-brand-text/50 font-sans uppercase tracking-wider font-bold capitalize pt-0.5">
                    {getLabelForEmoji(loc.ikon)}
                  </p>
                </div>
              </button>
            );
          })
        ) : (
          <p className="text-center font-sans text-sm text-brand-text/60 py-8">
            Ingen steder matcher søket.
          </p>
        )}
      </div>
    </div>
  );
}
