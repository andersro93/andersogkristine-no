import { useCallback, useMemo, useState } from "react";
import { Toast, useToast } from "../ui/useToast";
import { deleteMedia, unhideMedia } from "./api";
import { getDeviceId, getSavedName, saveName } from "./device";
import { Feed } from "./Feed";
import { Lightbox } from "./Lightbox";
import type { GalleryItem } from "./types";
import { UploadBar } from "./UploadBar";
import { useFeed } from "./useFeed";
import { useUploadQueue } from "./useUploadQueue";

export interface GalleryProps {
  isAdmin: boolean;
  uploadOpen: boolean;
}

/** The gallery island: upload bar + feed + lightbox + admin controls. */
export default function Gallery({ isAdmin, uploadOpen }: GalleryProps) {
  const deviceId = useMemo(() => getDeviceId(), []);
  const [name, setName] = useState(() => getSavedName());
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [open, setOpen] = useState<number | null>(null);
  const { toast, showToast } = useToast();
  const feed = useFeed({ deviceId, admin: isAdmin, filter });

  const onNameChange = (n: string) => {
    setName(n);
    saveName(n);
  };

  const queue = useUploadQueue({
    deviceId,
    getName: () => name.trim() || null,
    onItemReady: (item) => feed.prepend(item),
    onFirstSuccess: () => showToast("Takk for bildet! 🎉"),
  });

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
            className="btn-primary px-4 py-1.5 text-sm duration-200"
          >
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
        onLoadMore={feed.loadMore}
        onOpen={setOpen}
      />

      {open !== null && feed.items[open] && (
        <Lightbox
          items={feed.items}
          index={open}
          admin={isAdmin}
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
