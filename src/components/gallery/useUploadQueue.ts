/**
 * Drives uploads: classify → derivatives → create → PUT steps (small first) →
 * complete. Two files at a time; each PUT retried with backoff; a failed
 * original on an image is tolerated (the display version is what guests see).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { completeMedia, createMedia, putVariant } from "./api";
import { makeImageDerivatives, makeVideoPoster } from "./derivatives";
import type { GalleryItem, QueueItem, Variant } from "./types";
import {
  backoffMs,
  classifyFile,
  overallProgress,
  planUploadSteps,
  shouldRetry,
} from "./uploadPlan";

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UseUploadQueueOptions {
  deviceId: string;
  getName: () => string | null;
  onItemReady: (item: GalleryItem, localId: string) => void;
  onFirstSuccess?: () => void;
}

export function useUploadQueue(o: UseUploadQueueOptions) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const running = useRef(0);
  const succeeded = useRef(false);
  const opts = useRef(o);
  opts.current = o;

  const patch = useCallback((localId: string, changes: Partial<QueueItem>) => {
    setQueue((q) =>
      q.map((it) => (it.localId === localId ? { ...it, ...changes } : it)),
    );
  }, []);

  const process = useCallback(
    async (entry: QueueItem) => {
      const { localId, file } = entry;
      const { deviceId } = opts.current;
      const fail = (error: string) =>
        patch(localId, { status: "error", error, stage: null });
      try {
        patch(localId, { status: "preparing", error: null });
        const classified = classifyFile(file);
        if (!classified.ok) return fail(classified.error);
        const { kind, mime } = classified;

        let blobs: Partial<Record<Variant, Blob>> = { original: file };
        let meta = {
          width: null as number | null,
          height: null as number | null,
          durationMs: null as number | null,
        };
        if (kind === "image") {
          let d: Awaited<ReturnType<typeof makeImageDerivatives>>;
          try {
            d = await makeImageDerivatives(file);
          } catch {
            return fail(
              "Kunne ikke behandle bildet – prøv å velge det fra kamerarullen igjen.",
            );
          }
          blobs = { thumb: d.thumb, display: d.display, original: file };
          meta = { width: d.width, height: d.height, durationMs: null };
          patch(localId, { kind, previewUrl: URL.createObjectURL(d.thumb) });
        } else {
          const p = await makeVideoPoster(file);
          if (p.poster) blobs.thumb = p.poster;
          meta = { width: p.width, height: p.height, durationMs: p.durationMs };
          patch(localId, {
            kind,
            previewUrl: p.poster ? URL.createObjectURL(p.poster) : null,
          });
        }

        const { id } = await createMedia(
          {
            kind,
            mime,
            bytes: file.size,
            name: opts.current.getName(),
            ...meta,
          },
          deviceId,
        );
        patch(localId, { serverId: id, status: "uploading" });

        const steps = planUploadSteps(kind, !!blobs.thumb);
        const sizes: Partial<Record<Variant, number>> = {};
        for (const s of steps) sizes[s] = blobs[s]?.size ?? 0;

        for (const step of steps) {
          const blob = blobs[step] as Blob;
          const contentType =
            step === "original" ? mime : blob.type || "image/jpeg";
          patch(localId, {
            stage: step,
            progress: overallProgress(steps, sizes, step, 0),
          });
          let lastError: unknown = null;
          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
              await putVariant(id, step, blob, contentType, deviceId, (f) =>
                patch(localId, {
                  progress: overallProgress(steps, sizes, step, f),
                }),
              );
              lastError = null;
              break;
            } catch (err) {
              lastError = err;
              const status = (err as { status?: number }).status ?? 0;
              if (!shouldRetry(status) || attempt === MAX_ATTEMPTS - 1) break;
              await sleep(backoffMs(attempt));
            }
          }
          if (lastError) {
            // Images survive without the original; anything else is fatal.
            if (step === "original" && kind === "image") continue;
            throw lastError;
          }
        }

        const item = await completeMedia(id, deviceId);
        patch(localId, { status: "done", stage: null, progress: 1, item });
        opts.current.onItemReady(item, localId);
        if (!succeeded.current) {
          succeeded.current = true;
          opts.current.onFirstSuccess?.();
        }
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Opplastingen feilet.";
        fail(message);
      }
    },
    [patch],
  );

  // Pump: start queued items while we have free slots.
  useEffect(() => {
    const next = queue.filter((q) => q.status === "queued");
    while (running.current < CONCURRENCY && next.length > 0) {
      const entry = next.shift() as QueueItem;
      running.current += 1;
      patch(entry.localId, { status: "preparing" });
      process(entry).finally(() => {
        running.current -= 1;
        // trigger another pass
        setQueue((q) => [...q]);
      });
    }
  }, [queue, patch, process]);

  const enqueue = useCallback((files: File[]) => {
    const entries: QueueItem[] = files.map((file) => ({
      localId: crypto.randomUUID(),
      file,
      kind: null,
      status: "queued",
      stage: null,
      progress: 0,
      previewUrl: null,
      serverId: null,
      error: null,
      item: null,
    }));
    setQueue((q) => [...entries, ...q]);
  }, []);

  const retry = useCallback((localId: string) => {
    setQueue((q) =>
      q.map((it) =>
        it.localId === localId
          ? {
              ...it,
              status: "queued",
              error: null,
              progress: 0,
              stage: null,
              serverId: null,
            }
          : it,
      ),
    );
  }, []);

  /**
   * Remove a queue entry. By default its preview object URL is revoked with
   * it. Pass `keepPreview: true` when the caller has taken ownership of the
   * URL (e.g. handed it to a `Tile` as a placeholder until the real thumb
   * loads) — the new owner is then responsible for revoking it.
   */
  const dismiss = useCallback((localId: string, keepPreview = false) => {
    setQueue((q) => {
      const it = q.find((x) => x.localId === localId);
      if (it?.previewUrl && !keepPreview) URL.revokeObjectURL(it.previewUrl);
      return q.filter((x) => x.localId !== localId);
    });
  }, []);

  const active = queue.some(
    (q) =>
      q.status === "queued" ||
      q.status === "preparing" ||
      q.status === "uploading",
  );

  // Don't lose files the user is still uploading.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  return { queue, enqueue, retry, dismiss, active };
}
