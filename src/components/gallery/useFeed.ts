/**
 * The gallery feed: first page on mount, keyset "load more", and a 30 s
 * `since` poll (only while the tab is visible) that parks new arrivals in
 * `pendingNew` until the user taps "N nye bilder" — so the grid never jumps
 * under their thumb.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFeed } from "./api";
import type { GalleryItem } from "./types";

const PAGE = 40;
export const POLL_MS = 30_000;

function dedupe(items: GalleryItem[]): GalleryItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

export function useFeed(o: {
  deviceId: string;
  admin: boolean;
  filter: "all" | "mine";
}) {
  const { deviceId, admin, filter } = o;
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [pendingNew, setPendingNew] = useState<GalleryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stuckCount, setStuckCount] = useState<number | null>(null);
  const latest = useRef<number>(0); // newest ready_at we know of
  const busy = useRef(false);
  const generation = useRef(0); // bumped on every filter/admin change; invalidates stale loadMore responses
  const pageLoadedAt = useRef(Date.now()); // fallback `since` for polling an empty feed
  const itemsRef = useRef<GalleryItem[]>(items);
  const pendingRef = useRef<GalleryItem[]>(pendingNew);

  const params = useCallback(
    () => ({ mine: filter === "mine", all: admin }),
    [filter, admin],
  );

  const track = useCallback((list: GalleryItem[]) => {
    for (const it of list)
      if (it.readyAt && it.readyAt > latest.current)
        latest.current = it.readyAt;
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    pendingRef.current = pendingNew;
  }, [pendingNew]);

  // First page (and on filter/admin change)
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPendingNew([]);
    latest.current = 0;
    fetchFeed({ limit: PAGE, ...params() }, deviceId)
      .then((res) => {
        if (cancelled) return;
        track(res.items);
        setItems(res.items);
        setNextCursor(res.nextCursor);
        setStuckCount(res.stuckCount ?? null);
      })
      .catch(
        (err) =>
          !cancelled && setError(err.message ?? "Kunne ikke hente galleriet."),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [deviceId, params, track]);

  const loadMore = useCallback(() => {
    if (!nextCursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    const gen = generation.current;
    fetchFeed({ limit: PAGE, cursor: nextCursor, ...params() }, deviceId)
      .then((res) => {
        if (gen !== generation.current) return; // filter/admin changed mid-flight; drop this page
        setItems((cur) => dedupe([...cur, ...res.items]));
        setNextCursor(res.nextCursor);
      })
      .catch((err) => {
        if (gen === generation.current)
          setError(err.message ?? "Kunne ikke hente mer.");
      })
      .finally(() => {
        if (gen === generation.current) {
          busy.current = false;
          setLoading(false);
        }
      });
  }, [nextCursor, params, deviceId]);

  // Poll for new arrivals while visible
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const since = latest.current || pageLoadedAt.current;
        const res = await fetchFeed(
          { since, limit: 100, ...params() },
          deviceId,
        );
        if (res.items.length === 0) return;
        track(res.items);
        const known = new Set(itemsRef.current.map((i) => i.id));
        const fresh = res.items.filter((i) => !known.has(i.id));
        if (fresh.length) setPendingNew((p) => dedupe([...fresh, ...p]));
      } catch {
        /* transient; try again next tick */
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [deviceId, params, track]);

  const mergeNew = useCallback(() => {
    const p = pendingRef.current;
    if (p.length) setItems((cur) => dedupe([...p, ...cur]));
    setPendingNew([]);
  }, []);

  const prepend = useCallback(
    (item: GalleryItem) => {
      track([item]);
      setPendingNew((p) => p.filter((i) => i.id !== item.id));
      setItems((cur) => dedupe([item, ...cur]));
    },
    [track],
  );

  const update = useCallback((item: GalleryItem) => {
    setItems((cur) => cur.map((i) => (i.id === item.id ? item : i)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  return {
    items,
    loading,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    pendingNew,
    mergeNew,
    prepend,
    update,
    remove,
    stuckCount,
  };
}
