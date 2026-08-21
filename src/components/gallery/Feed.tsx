import { useEffect, useRef } from "react";
import { Icon, Spinner } from "../ui/Icon";
import type { GalleryItem, QueueItem } from "./types";

interface Props {
  items: GalleryItem[];
  queue: QueueItem[];
  admin: boolean;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onOpen: (index: number) => void;
}

export function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PendingTile({ q }: { q: QueueItem }) {
  const label =
    q.status === "preparing"
      ? "Klargjør…"
      : q.status === "uploading"
        ? `Laster opp… ${Math.round(q.progress * 100)} %`
        : "Venter…";
  return (
    <li
      className="relative aspect-square overflow-hidden rounded-sm bg-brand-title/5"
      aria-label={label}
    >
      {q.previewUrl ? (
        <img
          src={q.previewUrl}
          alt=""
          className="w-full h-full object-cover opacity-60"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-brand-title/40">
          <Icon
            name={q.kind === "video" ? "video" : "image"}
            className="w-8 h-8"
          />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-1.5 text-[10px] text-white bg-gradient-to-t from-black/60 to-transparent">
        <div className="h-1 rounded bg-white/30 overflow-hidden mb-1">
          <div
            className="h-full bg-white transition-[width] duration-300"
            style={{ width: `${Math.round(q.progress * 100)}%` }}
          />
        </div>
        {label}
      </div>
    </li>
  );
}

function Tile({
  item,
  onOpen,
  admin,
}: {
  item: GalleryItem;
  onOpen: () => void;
  admin: boolean;
}) {
  const hidden = admin && item.hiddenAt !== null;
  return (
    <li className="relative aspect-square overflow-hidden rounded-sm bg-brand-title/5">
      <button
        type="button"
        className="block w-full h-full"
        onClick={onOpen}
        aria-label={item.name ? `Åpne bilde fra ${item.name}` : "Åpne bilde"}
      >
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt={item.name ? `Bilde fra ${item.name}` : "Bilde fra gjest"}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover ${hidden ? "opacity-40" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-brand-title/40">
            <Icon name="video" className="w-8 h-8" />
          </div>
        )}
        {item.kind === "video" && (
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-black/60 text-white text-[10px] px-1.5 py-0.5">
            <Icon name="play" className="w-3 h-3" />
            {formatDuration(item.durationMs)}
          </span>
        )}
        {hidden && (
          <span className="absolute top-1 left-1 rounded bg-black/70 text-white text-[10px] px-1.5 py-0.5">
            Skjult
          </span>
        )}
      </button>
    </li>
  );
}

/** Square grid: pending uploads first, then the feed; infinite scroll via a sentinel. */
export function Feed({
  items,
  queue,
  admin,
  hasMore,
  loading,
  onLoadMore,
  onOpen,
}: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const pending = queue.filter(
    (q) => q.status !== "done" && q.status !== "error",
  );

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) onLoadMore();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (!loading && items.length === 0 && pending.length === 0) {
    return (
      <p className="text-body-serif text-center py-16">
        Ingen bilder ennå – bli den første!
      </p>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-3 md:grid-cols-5 gap-1">
        {pending.map((q) => (
          <PendingTile key={q.localId} q={q} />
        ))}
        {items.map((item, i) => (
          <Tile
            key={item.id}
            item={item}
            admin={admin}
            onOpen={() => onOpen(i)}
          />
        ))}
      </ul>
      <div ref={sentinel} className="h-12 flex items-center justify-center">
        {loading && (
          <Spinner className="w-5 h-5 text-brand-title/60" title="Laster" />
        )}
      </div>
    </>
  );
}
