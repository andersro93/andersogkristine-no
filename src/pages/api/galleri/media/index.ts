import type { APIRoute } from "astro";
import { env } from "../../../../runtime";
import {
  checkUploadQuota,
  countStuck,
  createItem,
  decodeCursor,
  encodeCursor,
  GALLERY_UNAVAILABLE,
  getDeviceId,
  getGalleryBindings,
  hashIp,
  isGalleryAdmin,
  listFeed,
  STUCK_AFTER_MS,
  toGalleryItem,
  uploadsOpen,
  validateCreatePayload,
} from "../../../../services/gallery";
import { json } from "../../../../utils/http";

/**
 * Step 1 of an upload: register the item and get an id. The bytes follow as
 * PUT /media/:id/:variant and the row becomes visible on POST /media/:id/complete.
 */
export const POST: APIRoute = async (context) => {
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);
  if (!uploadsOpen(context.locals))
    return json({ error: "Opplasting er stengt." }, 403);

  const deviceId = getDeviceId(context.request);
  if (!deviceId) return json({ error: "Mangler enhets-id." }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig forespørsel." }, 400);
  }
  const v = validateCreatePayload(body);
  if (!v.ok) return json({ error: v.error }, 400);

  const now = Date.now();
  const ipHash = hashIp(context.clientAddress || "unknown-ip", env);
  try {
    const quota = await checkUploadQuota(bindings.db, {
      deviceId,
      ipHash,
      now,
    });
    if (!quota.allowed) {
      return json(
        {
          error:
            "Du har lastet opp mange filer på kort tid – prøv igjen om en liten stund.",
        },
        429,
      );
    }
    const id = crypto.randomUUID();
    await createItem(bindings.db, {
      id,
      kind: v.value.kind,
      createdAt: now,
      name: v.value.name,
      deviceId,
      ipHash,
      width: v.value.width,
      height: v.value.height,
      durationMs: v.value.durationMs,
      originalMime: v.value.mime,
    });
    return json({ id }, 201);
  } catch (err) {
    console.error("Gallery create failed:", err);
    return json({ error: "Noe gikk galt. Prøv igjen." }, 500);
  }
};

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

/**
 * The feed. Keyset pagination on (ready_at, id); `since` returns only items
 * readied after a timestamp (the "N nye bilder" poll); `mine` filters by the
 * caller's device; `all` (admin) includes hidden items and a stuck count.
 */
export const GET: APIRoute = async (context) => {
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);

  const params = new URL(context.request.url).searchParams;
  const admin = isGalleryAdmin(context.cookies, env);
  const deviceId = getDeviceId(context.request);
  const all = params.get("all") === "1";
  const mine = params.get("mine") === "1";
  if (all && !admin) return json({ error: "Ingen tilgang." }, 403);
  if (mine && !deviceId) return json({ error: "Mangler enhets-id." }, 400);

  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const sinceRaw = Number(params.get("since"));
  const since =
    params.has("since") && Number.isInteger(sinceRaw) && sinceRaw >= 0
      ? sinceRaw
      : null;

  try {
    const rows = await listFeed(bindings.db, {
      limit: limit + 1,
      cursor: decodeCursor(params.get("cursor")),
      since,
      deviceId: mine ? deviceId : null,
      includeHidden: all,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last?.ready_at !== null
        ? encodeCursor(last.ready_at as number, last.id)
        : null;
    const items = page.map((row) => toGalleryItem(row, { deviceId, admin }));
    const stuckCount = all
      ? await countStuck(bindings.db, Date.now() - STUCK_AFTER_MS)
      : undefined;
    return json({
      items,
      nextCursor,
      ...(stuckCount === undefined ? {} : { stuckCount }),
    });
  } catch (err) {
    console.error("Gallery feed failed:", err);
    return json({ error: "Kunne ikke hente galleriet." }, 500);
  }
};
