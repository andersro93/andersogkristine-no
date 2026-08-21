import { useCallback, useMemo, useRef, useState } from "react";
import { Toast, useToast } from "../ui/useToast";
import { deleteMedia, unhideMedia } from "./api";
import { fireConfetti } from "./confetti";
import { getDeviceId, getSavedName, saveName } from "./device";
import { Feed } from "./Feed";
import { Lightbox } from "./Lightbox";
import type { GalleryItem, QueueItem } from "./types";
import { UploadBar } from "./UploadBar";
import { useFeed } from "./useFeed";
import { useUploadQueue } from "./useUploadQueue";

export interface GalleryProps {
  isAdmin: boolean;
  uploadOpen: boolean;
}

/** How long a freshly-arrived tile keeps its "landed" pop animation. */
const JUST_ARRIVED_MS = 700;

/** The gallery island: upload bar + feed + lightbox + admin controls. */
export default function Gallery({ isAdmin, uploadOpen }: GalleryProps) {
  const deviceId = useMemo(() => getDeviceId(), []);
  const [name, setName] = useState(() => getSavedName());
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const [previewFor, setPreviewFor] = useState<Map<string, string>>(new Map());
  const { toast, showToast } = useToast();
  const feed = useFeed({ deviceId, admin: isAdmin, filter });

  const onNameChange = (n: string) => {
    setName(n);
    saveName(n);
  };

  // `onItemReady` needs the upload queue's current entries (to find the
  // finishing entry's preview) and its `dismiss` — but both only exist once
  // `useUploadQueue` (below) returns, and `onItemReady` is one of its
  // options. Mirror the hook's own "opts ref" pattern: keep the latest
  // queue/dismiss in refs, updated every render, so the closure — only ever
  // called later, asynchronously, once an upload completes — reads the
  // current value instead of closing over a stale (or not-yet-assigned) one.
  const queueListRef = useRef<QueueItem[]>([]);
  const dismissRef = useRef<(localId: string, keepPreview?: boolean) => void>(
    () => {},
  );

  const onItemReady = useCallback(
    (item: GalleryItem, localId: string) => {
      feed.prepend(item);

      setJustArrived((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      setTimeout(() => {
        setJustArrived((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }, JUST_ARRIVED_MS);

      const entry = queueListRef.current.find((q) => q.localId === localId);
      if (entry?.previewUrl) {
        const url = entry.previewUrl;
        setPreviewFor((prev) => {
          const next = new Map(prev);
          next.set(item.id, url);
          return next;
        });
      }
      // Ownership of the preview object URL transfers to `previewFor`;
      // `dismiss` must not revoke it — the Tile releases it once the real
      // thumbnail has loaded (see `releasePreview` below).
      dismissRef.current(localId, true);
    },
    [feed],
  );

  const onFirstSuccess = useCallback(() => {
    fireConfetti();
    showToast("Takk for bildet! 🎉");
  }, [showToast]);

  const queue = useUploadQueue({
    deviceId,
    getName: () => name.trim() || null,
    onItemReady,
    onFirstSuccess,
  });
  queueListRef.current = queue.queue;
  dismissRef.current = queue.dismiss;

  const releasePreview = useCallback((id: string) => {
    setPreviewFor((prev) => {
      const url = prev.get(id);
      if (!url) return prev;
      URL.revokeObjectURL(url);
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const onOpen = useCallback((index: number, rect: DOMRect) => {
    setOriginRect(rect);
    setOpen(index);
  }, []);

  const onDelete = useCallback(
    async (item: GalleryItem) => {
      if (
        !window.confirm(
          item.mine && !isAdmin
            ? "Slette bildet ditt?"
            : "Skjule dette bildet for alle?",
        )
      )
        return;
      try {
        await deleteMedia(item.id, deviceId);
        if (isAdmin) feed.update({ ...item, hiddenAt: Date.now() });
        else feed.remove(item.id);
        setOpen(null);
        showToast(isAdmin ? "Skjult." : "Slettet.");
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Noe gikk galt.",
          "error",
        );
      }
    },
    [deviceId, feed, isAdmin, showToast],
  );

  const onToggleHidden = useCallback(
    async (item: GalleryItem) => {
      try {
        if (item.hiddenAt) {
          await unhideMedia(item.id, deviceId);
          feed.update({ ...item, hiddenAt: null });
          showToast("Synlig igjen.");
        } else {
          await deleteMedia(item.id, deviceId);
          feed.update({ ...item, hiddenAt: Date.now() });
          showToast("Skjult.");
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Noe gikk galt.",
          "error",
        );
      }
    },
    [deviceId, feed, showToast],
  );

  return (
    <div className="w-full">
      <UploadBar
        uploadOpen={uploadOpen}
        name={name}
        onNameChange={onNameChange}
        onFiles={queue.enqueue}
        queue={queue.queue}
        onRetry={queue.retry}
        onDismiss={queue.dismiss}
      />

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-brand-title/20 overflow-hidden text-sm">
          {(["all", "mine"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`px-4 py-1.5 ${filter === f ? "bg-brand-title text-brand-bg" : "text-brand-title"}`}
            >
              {f === "all" ? "Alle" : "Mine"}
            </button>
          ))}
        </div>
        {feed.pendingNew.length > 0 && (
          <button
            type="button"
            onClick={feed.mergeNew}
            className="btn-primary px-4 py-1.5 text-sm duration-200 inline-flex items-center gap-2"
          >
            <span className="relative flex h-2 w-2">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-bg opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-bg" />
            </span>
            {feed.pendingNew.length}{" "}
            {feed.pendingNew.length === 1 ? "nytt bilde" : "nye bilder"}
          </button>
        )}
        {isAdmin && (
          <p className="text-caption">
            Admin · {feed.items.filter((i) => i.hiddenAt).length} skjult
            {feed.stuckCount !== null
              ? ` · ${feed.stuckCount} ufullstendige`
              : ""}
          </p>
        )}
      </div>

      {feed.error && <p className="alert-error mb-3">{feed.error}</p>}

      <Feed
        items={feed.items}
        queue={queue.queue}
        admin={isAdmin}
        hasMore={feed.hasMore}
        loading={feed.loading}
        justArrived={justArrived}
        previewFor={previewFor}
        onPreviewShown={releasePreview}
        onLoadMore={feed.loadMore}
        onOpen={onOpen}
      />

      {open !== null && feed.items[open] && (
        <Lightbox
          items={feed.items}
          index={open}
          admin={isAdmin}
          originRect={originRect}
          onClose={() => setOpen(null)}
          onNavigate={setOpen}
          onDelete={onDelete}
          onToggleHidden={onToggleHidden}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
