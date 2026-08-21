import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { formatDuration } from "./Feed";
import type { GalleryItem } from "./types";

interface Props {
  items: GalleryItem[];
  index: number;
  admin: boolean;
  /** Bounding rect of the tile that was tapped, for the lightbox-in zoom origin. */
  originRect?: DOMRect | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete: (item: GalleryItem) => void;
  onToggleHidden: (item: GalleryItem) => void;
}

const SWIPE_PX = 48;

/** True when the event originated on native video/button/link/input controls —
 * their own gestures (seek-bar drag, clicks) must not also drive swipe-nav. */
function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("video, button, a, input") !== null
  );
}

function when(ms: number): string {
  return new Date(ms).toLocaleString("nb-NO", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Full-screen <dialog>: image or video, prev/next (buttons, keys, swipe), download / delete / hide. */
export function Lightbox({
  items,
  index,
  admin,
  originRect = null,
  onClose,
  onNavigate,
  onDelete,
  onToggleHidden,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const startX = useRef<number | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const origin = originRect
    ? `${originRect.left + originRect.width / 2}px ${originRect.top + originRect.height / 2}px`
    : "center";

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (item?.id) setVideoFailed(false);
  }, [item?.id]);

  // Preload neighbours
  useEffect(() => {
    for (const n of [items[index - 1], items[index + 1]]) {
      if (n?.kind === "image" && n.displayUrl) new Image().src = n.displayUrl;
    }
  }, [items, index]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (isControlTarget(e.target)) return;
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(index - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(index + 1);
    },
    [hasPrev, hasNext, index, onNavigate],
  );

  if (!item) return null;
  const downloadUrl = item.originalUrl ?? item.displayUrl;

  return (
    <dialog
      ref={dialog}
      className="fixed inset-0 m-0 w-screen h-dvh max-w-none max-h-none bg-black/95 text-white p-0 backdrop:bg-black/80 motion-safe:animate-fade-in"
      onClose={onClose}
      onCancel={onClose}
      onKeyDown={onKey}
      aria-label="Bildevisning"
    >
      <div
        className="relative w-full h-full flex flex-col"
        onPointerDown={(e) => {
          if (isControlTarget(e.target)) {
            startX.current = null;
            return;
          }
          startX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (isControlTarget(e.target)) {
            startX.current = null;
            return;
          }
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (dx > SWIPE_PX && hasPrev) onNavigate(index - 1);
          if (dx < -SWIPE_PX && hasNext) onNavigate(index + 1);
        }}
      >
        <div className="flex items-center justify-between p-3 text-sm">
          <span className="truncate">
            {item.name ?? "Gjest"} · {when(item.createdAt)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="p-2"
          >
            <Icon name="x" className="w-6 h-6" />
          </button>
        </div>

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click closes; keyboard users have Esc and the close button */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: this is the modal backdrop, not interactive content; Esc and the close button remain keyboard-accessible */}
        <div
          className="flex-1 min-h-0 flex items-center justify-center motion-safe:animate-lightbox-in"
          style={{ transformOrigin: origin }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          {item.kind === "image" ? (
            <img
              src={item.displayUrl ?? item.originalUrl ?? ""}
              alt={item.name ? `Bilde fra ${item.name}` : "Bilde fra gjest"}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
              onError={(e) => {
                if (
                  item.originalUrl &&
                  e.currentTarget.src !==
                    new URL(item.originalUrl, location.href).href
                ) {
                  e.currentTarget.src = item.originalUrl;
                }
              }}
            />
          ) : videoFailed ? (
            <p className="text-center p-6">
              Videoen kan ikke spilles av i denne nettleseren.{" "}
              {downloadUrl && (
                <a href={downloadUrl} download className="underline">
                  Last den ned for å se den.
                </a>
              )}
            </p>
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: guest phone videos have no captions
            <video
              key={item.id}
              src={item.originalUrl ?? undefined}
              poster={item.thumbUrl ?? undefined}
              controls
              playsInline
              autoPlay
              className="max-w-full max-h-full"
              onError={() => setVideoFailed(true)}
            />
          )}
        </div>

        <div className="flex items-center justify-between p-3 text-sm gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => onNavigate(index - 1)}
            aria-label="Forrige"
            className="p-2 disabled:opacity-30"
          >
            <Icon name="chevronLeft" className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-4">
            {item.kind === "video" && (
              <span className="text-white/70">
                {formatDuration(item.durationMs)}
              </span>
            )}
            {downloadUrl && (
              <a
                href={downloadUrl}
                download
                className="inline-flex items-center gap-1 underline"
              >
                <Icon name="download" className="w-5 h-5" /> Last ned
              </a>
            )}
            {(item.mine || admin) && !item.hiddenAt && (
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="inline-flex items-center gap-1 underline"
              >
                <Icon name="trash" className="w-5 h-5" /> Slett
              </button>
            )}
            {admin && (
              <button
                type="button"
                onClick={() => onToggleHidden(item)}
                className="inline-flex items-center gap-1 underline"
              >
                <Icon
                  name={item.hiddenAt ? "eye" : "eyeOff"}
                  className="w-5 h-5"
                />{" "}
                {item.hiddenAt ? "Vis" : "Skjul"}
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onNavigate(index + 1)}
            aria-label="Neste"
            className="p-2 disabled:opacity-30"
          >
            <Icon name="chevronRight" className="w-6 h-6" />
          </button>
        </div>
      </div>
    </dialog>
  );
}
