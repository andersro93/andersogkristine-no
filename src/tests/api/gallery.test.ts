import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeD1, readMigration } from "../fakes/d1";
import { createFakeR2 } from "../fakes/r2";

const mockEnv: Record<string, unknown> = {
  SESSION_SECRET: "test-secret-key-12345",
  GALLERY_ADMIN_KEY: "admin-key",
  DB: undefined,
  GALLERY: undefined,
};
mock.module("cloudflare:workers", () => ({ env: mockEnv }));

const media = await import("../../pages/api/galleri/media/index");
const variant = await import("../../pages/api/galleri/media/[id]/[variant]");
const complete = await import("../../pages/api/galleri/media/[id]/complete");
const { generateAdminCookie, ADMIN_COOKIE_NAME } = await import(
  "../../services/gallery/admin"
);

const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(28).fill(7)]);
const WEBP = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46,
  0,
  0,
  0,
  0,
  0x57,
  0x45,
  0x42,
  0x50,
  ...new Array(20).fill(1),
]);
const MP4 = new Uint8Array([
  0,
  0,
  0,
  0x18,
  0x66,
  0x74,
  0x79,
  0x70,
  0x69,
  0x73,
  0x6f,
  0x6d,
  ...new Array(20).fill(2),
]);

interface CtxOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  deviceId?: string | null;
  admin?: boolean;
  flags?: Record<string, boolean>;
  ip?: string;
}

function ctx(path: string, o: CtxOpts = {}) {
  const headers = new Headers(o.headers ?? {});
  const deviceId = o.deviceId === undefined ? DEVICE : o.deviceId;
  if (deviceId) headers.set("X-Device-Id", deviceId);
  let body: BodyInit | undefined;
  if (o.body instanceof Uint8Array) {
    body = o.body as BodyInit;
    headers.set("Content-Length", String(o.body.byteLength));
  } else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers.set("Content-Type", "application/json");
  }
  const cookies = new Map<string, string>();
  if (o.admin)
    cookies.set(
      ADMIN_COOKIE_NAME,
      generateAdminCookie(mockEnv as unknown as Env),
    );
  return {
    clientAddress: o.ip ?? "203.0.113.7",
    params: o.params ?? {},
    request: new Request(`https://andersogkristine.no${path}`, {
      method: o.method ?? "GET",
      headers,
      body,
    }),
    cookies: {
      get: (n: string) =>
        cookies.has(n) ? { value: cookies.get(n) as string } : undefined,
      set: () => {},
      delete: () => {},
    },
    locals: { flags: o.flags ?? {} },
  } as any;
}

async function createImage(name?: string, deviceId = DEVICE) {
  const res = await media.POST(
    ctx("/api/galleri/media", {
      method: "POST",
      deviceId,
      body: { kind: "image", mime: "image/jpeg", bytes: JPEG.length, name },
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).id as string;
}

async function put(
  id: string,
  v: string,
  bytes: Uint8Array,
  type: string,
  deviceId = DEVICE,
) {
  return variant.PUT(
    ctx(`/api/galleri/media/${id}/${v}`, {
      method: "PUT",
      params: { id, variant: v },
      body: bytes,
      headers: { "Content-Type": type },
      deviceId,
    }),
  );
}

async function finish(id: string, deviceId = DEVICE) {
  return complete.POST(
    ctx(`/api/galleri/media/${id}/complete`, {
      method: "POST",
      params: { id },
      deviceId,
    }),
  );
}

beforeEach(() => {
  mockEnv.DB = createFakeD1(readMigration());
  mockEnv.GALLERY = createFakeR2();
});

describe("POST /api/galleri/media", () => {
  test("503 without bindings", async () => {
    mockEnv.DB = undefined;
    const res = await media.POST(
      ctx("/api/galleri/media", {
        method: "POST",
        body: { kind: "image", mime: "image/jpeg", bytes: 1 },
      }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).unavailable).toBe(true);
  });
  test("403 when gallery_upload is off", async () => {
    const res = await media.POST(
      ctx("/api/galleri/media", {
        method: "POST",
        flags: { gallery_upload: false },
        body: { kind: "image", mime: "image/jpeg", bytes: 1 },
      }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe("Opplasting er stengt.");
  });
  test("400 without a device id, on bad JSON, on invalid payload", async () => {
    expect(
      (
        await media.POST(
          ctx("/api/galleri/media", {
            method: "POST",
            deviceId: null,
            body: { kind: "image", mime: "image/jpeg", bytes: 1 },
          }),
        )
      ).status,
    ).toBe(400);
    const bad = ctx("/api/galleri/media", { method: "POST" });
    bad.request = new Request("https://x/api/galleri/media", {
      method: "POST",
      headers: { "X-Device-Id": DEVICE, "Content-Type": "application/json" },
      body: "{nope",
    });
    expect((await media.POST(bad)).status).toBe(400);
    expect(
      (
        await media.POST(
          ctx("/api/galleri/media", {
            method: "POST",
            body: { kind: "image", mime: "image/gif", bytes: 1 },
          }),
        )
      ).status,
    ).toBe(400);
  });
  test("201 creates an uploading row with the sanitised name", async () => {
    const id = await createImage("  Kari \n");
    const row = await (mockEnv.DB as D1Database)
      .prepare("SELECT * FROM media WHERE id = ?")
      .bind(id)
      .first<any>();
    expect(row.status).toBe("uploading");
    expect(row.uploader_name).toBe("Kari");
    expect(row.device_id).toBe(DEVICE);
    expect(row.original_mime).toBe("image/jpeg");
    expect(row.ip_hash).not.toContain("203.0.113.7");
  });
  test("429 once the device quota is exhausted", async () => {
    const { DEVICE_HOURLY_LIMIT } = await import(
      "../../services/gallery/quota"
    );
    for (let i = 0; i < DEVICE_HOURLY_LIMIT; i++) await createImage();
    const res = await media.POST(
      ctx("/api/galleri/media", {
        method: "POST",
        body: { kind: "image", mime: "image/jpeg", bytes: 1 },
      }),
    );
    expect(res.status).toBe(429);
  });
});

describe("PUT /api/galleri/media/:id/:variant", () => {
  test("404 for a bad id/variant or unknown row", async () => {
    expect((await put("nope", "thumb", WEBP, "image/webp")).status).toBe(404);
    expect(
      (await put(crypto.randomUUID(), "poster", WEBP, "image/webp")).status,
    ).toBe(404);
    expect(
      (await put(crypto.randomUUID(), "thumb", WEBP, "image/webp")).status,
    ).toBe(404);
  });
  test("403 for another device, 415 for a disallowed type, 413 over cap, 411 without length", async () => {
    const id = await createImage();
    expect((await put(id, "thumb", WEBP, "image/webp", OTHER)).status).toBe(
      403,
    );
    expect((await put(id, "thumb", WEBP, "image/gif")).status).toBe(415);
    expect((await put(id, "original", WEBP, "image/png")).status).toBe(415); // declared image/jpeg at create
    const big = ctx(`/api/galleri/media/${id}/thumb`, {
      method: "PUT",
      params: { id, variant: "thumb" },
      body: WEBP,
      headers: { "Content-Type": "image/webp" },
    });
    big.request.headers.set("Content-Length", String(2 * 1024 * 1024));
    expect((await variant.PUT(big)).status).toBe(413);
    const nolen = ctx(`/api/galleri/media/${id}/thumb`, {
      method: "PUT",
      params: { id, variant: "thumb" },
      body: WEBP,
      headers: { "Content-Type": "image/webp" },
    });
    nolen.request.headers.delete("Content-Length");
    expect((await variant.PUT(nolen)).status).toBe(411);
  });
  test("415 when the bytes do not match the declared type, and the object is removed", async () => {
    const id = await createImage();
    const res = await put(id, "thumb", JPEG, "image/webp");
    expect(res.status).toBe(415);
    expect((mockEnv.GALLERY as any)._objects.size).toBe(0);
  });
  test("stores thumb/display/original under media/<id>/ and records keys", async () => {
    const id = await createImage();
    expect((await put(id, "thumb", WEBP, "image/webp")).status).toBe(200);
    expect((await put(id, "display", WEBP, "image/webp")).status).toBe(200);
    expect((await put(id, "original", JPEG, "image/jpeg")).status).toBe(200);
    const keys = [...(mockEnv.GALLERY as any)._objects.keys()].sort();
    expect(keys).toEqual([
      `media/${id}/display.webp`,
      `media/${id}/original.jpg`,
      `media/${id}/thumb.webp`,
    ]);
    const row = await (mockEnv.DB as D1Database)
      .prepare("SELECT * FROM media WHERE id = ?")
      .bind(id)
      .first<any>();
    expect(row.thumb_key).toBe(`media/${id}/thumb.webp`);
    expect(row.original_bytes).toBe(JPEG.length);
    const stored = await (mockEnv.GALLERY as R2Bucket).get(
      `media/${id}/original.jpg`,
    );
    const h = new Headers();
    stored?.writeHttpMetadata(h);
    expect(h.get("Content-Type")).toBe("image/jpeg");
  });
  test("409 once the item is ready; video rejects display", async () => {
    const id = await createImage();
    await put(id, "thumb", WEBP, "image/webp");
    await put(id, "display", WEBP, "image/webp");
    expect((await finish(id)).status).toBe(200);
    expect((await put(id, "original", JPEG, "image/jpeg")).status).toBe(409);

    const vres = await media.POST(
      ctx("/api/galleri/media", {
        method: "POST",
        body: { kind: "video", mime: "video/mp4", bytes: MP4.length },
      }),
    );
    const vid = ((await vres.json()) as any).id;
    expect((await put(vid, "display", WEBP, "image/webp")).status).toBe(415);
  });
});

describe("POST /api/galleri/media/:id/complete", () => {
  test("image needs thumb + display; video needs original (poster optional)", async () => {
    const id = await createImage();
    let res = await finish(id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).missing).toEqual(["thumb", "display"]);
    await put(id, "thumb", WEBP, "image/webp");
    await put(id, "display", WEBP, "image/webp");
    res = await finish(id);
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as any;
    expect(item.id).toBe(id);
    expect(item.mine).toBe(true);
    expect(item.hasOriginal).toBe(false);
    expect(item.thumbUrl).toBe(`/api/galleri/file/${id}/thumb`);
    expect(item.readyAt).toBeGreaterThan(0);
    // idempotent
    expect((await finish(id)).status).toBe(200);

    const vres = await media.POST(
      ctx("/api/galleri/media", {
        method: "POST",
        body: { kind: "video", mime: "video/mp4", bytes: MP4.length },
      }),
    );
    const vid = ((await vres.json()) as any).id;
    expect((await finish(vid)).status).toBe(409);
    await put(vid, "original", MP4, "video/mp4");
    expect((await finish(vid)).status).toBe(200);
  });
  test("403 for another device, 404 unknown", async () => {
    const id = await createImage();
    expect((await finish(id, OTHER)).status).toBe(403);
    expect((await finish(crypto.randomUUID())).status).toBe(404);
  });
});
