import { useEffect, useRef } from "react";
import { Icon, Spinner } from "../ui/Icon";
import type { GalleryItem, QueueItem } from "./types";
import { useFlipGrid } from "./useFlipGrid";

interface Props {
  items: GalleryItem[];
  queue: QueueItem[];
  admin: boolean;
  hasMore: boolean;
  loading: boolean;
  /** Ids that turned ready in the last ~700 ms — get the "landed" pop. */
  justArrived: Set<string>;
  /** item id → object URL of the local preview, shown behind the real thumb until it loads. */
  previewFor: Map<string, string>;
  onPreviewShown: (id: string) => void;
  onLoadMore: () => void;
  onOpen: (index: number, rect: DOMRect) => void;
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
      data-flip-id={`q:${q.localId}`}
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
  justArrived,
  preview,
  onPreviewShown,
}: {
  item: GalleryItem;
  onOpen: (rect: DOMRect) => void;
  admin: boolean;
  justArrived: boolean;
  preview: string | undefined;
  onPreviewShown: () => void;
}) {
  const hidden = admin && item.hiddenAt !== null;
  return (
    <li
      data-flip-id={item.id}
      className={`relative aspect-square overflow-hidden rounded-sm bg-brand-title/5 ${justArrived ? "motion-safe:animate-pop" : ""}`}
    >
      <button
        type="button"
        className="block w-full h-full"
        onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
        aria-label={item.name ? `Åpne bilde fra ${item.name}` : "Åpne bilde"}
      >
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt={item.name ? `Bilde fra ${item.name}` : "Bilde fra gjest"}
            loading="lazy"
            decoding="async"
            onLoad={preview ? onPreviewShown : undefined}
            className={`w-full h-full object-cover bg-cover bg-center ${hidden ? "opacity-40" : ""}`}
            style={preview ? { backgroundImage: `url(${preview})` } : undefined}
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
  justArrived,
  previewFor,
  onPreviewShown,
  onLoadMore,
  onOpen,
}: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const pending = queue.filter(
    (q) => q.status !== "done" && q.status !== "error",
  );

  const orderKey = [
    ...pending.map((q) => `q:${q.localId}`),
    ...items.map((i) => i.id),
  ].join("|");
  useFlipGrid(gridRef, orderKey);

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
      <ul ref={gridRef} className="grid grid-cols-3 md:grid-cols-5 gap-1">
        {pending.map((q) => (
          <PendingTile key={q.localId} q={q} />
        ))}
        {items.map((item, i) => (
          <Tile
            key={item.id}
            item={item}
            admin={admin}
            justArrived={justArrived.has(item.id)}
            preview={previewFor.get(item.id)}
            onPreviewShown={() => onPreviewShown(item.id)}
            onOpen={(rect) => onOpen(i, rect)}
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
