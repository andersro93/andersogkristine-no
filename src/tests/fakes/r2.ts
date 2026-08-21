/**
 * Test double for an R2 bucket. Enough of the Workers R2 API for the gallery:
 * streaming put, ranged get (R2Range object *or* a Range header), onlyIf with
 * If-None-Match, head/delete/list. Unsatisfiable ranges throw like R2 does.
 */
interface Stored {
  bytes: Uint8Array;
  contentType?: string;
  etag: string;
  uploaded: Date;
}

export type FakeR2 = R2Bucket & { _objects: Map<string, Stored> };

async function drain(value: unknown): Promise<Uint8Array> {
  if (value === null || value === undefined) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  throw new Error("fake R2: unsupported put() value");
}

function parseRange(
  range: R2Range | Headers | undefined,
  size: number,
): { offset: number; length: number } | null {
  if (!range) return null;
  if (range instanceof Headers) {
    const h = range.get("range");
    if (!h) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
    if (!m) return null;
    const [, a, b] = m;
    if (a === "" && b === "") return null;
    if (a === "") {
      const suffix = Math.min(Number(b), size);
      return { offset: size - suffix, length: suffix };
    }
    const start = Number(a);
    if (start >= size) throw new Error("fake R2: range not satisfiable");
    const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
    return { offset: start, length: end - start + 1 };
  }
  if ("suffix" in range) {
    const suffix = Math.min(range.suffix, size);
    return { offset: size - suffix, length: suffix };
  }
  const offset = range.offset ?? 0;
  if (offset >= size) throw new Error("fake R2: range not satisfiable");
  const length =
    "length" in range && range.length !== undefined
      ? Math.min(range.length, size - offset)
      : size - offset;
  return { offset, length };
}

function hashEtag(bytes: Uint8Array): string {
  let h = 2166136261;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function makeObject(
  key: string,
  s: Stored,
  range?: { offset: number; length: number } | null,
) {
  const base = {
    key,
    version: s.etag,
    size: s.bytes.length,
    etag: s.etag,
    httpEtag: `"${s.etag}"`,
    uploaded: s.uploaded,
    httpMetadata: s.contentType ? { contentType: s.contentType } : {},
    customMetadata: {},
    checksums: {} as R2Checksums,
    storageClass: "Standard",
    range: range ?? undefined,
    writeHttpMetadata(headers: Headers) {
      if (s.contentType) headers.set("Content-Type", s.contentType);
    },
  };
  return base;
}

function withBody(obj: ReturnType<typeof makeObject>, slice: Uint8Array) {
  const blob = () => new Blob([slice as unknown as BlobPart]);
  return {
    ...obj,
    bodyUsed: false,
    get body() {
      return blob().stream();
    },
    arrayBuffer: async () => slice.slice().buffer as ArrayBuffer,
    bytes: async () => slice.slice(),
    text: async () => new TextDecoder().decode(slice),
    json: async () => JSON.parse(new TextDecoder().decode(slice)),
    blob: async () => blob(),
  };
}

/** Create an empty in-memory bucket. */
export function createFakeR2(): FakeR2 {
  const objects = new Map<string, Stored>();

  const bucket = {
    _objects: objects,
    async put(key: string, value: unknown, options?: R2PutOptions) {
      const bytes = await drain(value);
      const stored: Stored = {
        bytes,
        contentType: options?.httpMetadata
          ? ((options.httpMetadata as R2HTTPMetadata).contentType ??
            (options.httpMetadata as Headers).get?.("content-type") ??
            undefined)
          : undefined,
        etag: hashEtag(bytes),
        uploaded: new Date(0),
      };
      objects.set(key, stored);
      return makeObject(key, stored);
    },
    async get(key: string, options?: R2GetOptions) {
      const s = objects.get(key);
      if (!s) return null;
      const onlyIf = options?.onlyIf;
      if (onlyIf instanceof Headers) {
        const inm = onlyIf.get("if-none-match");
        if (inm && inm === `"${s.etag}"`) return makeObject(key, s);
      }
      const range = parseRange(options?.range, s.bytes.length);
      const slice = range
        ? s.bytes.subarray(range.offset, range.offset + range.length)
        : s.bytes;
      return withBody(makeObject(key, s, range), slice);
    },
    async head(key: string) {
      const s = objects.get(key);
      return s ? makeObject(key, s) : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list(options?: R2ListOptions) {
      const prefix = options?.prefix ?? "";
      const out = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, s]) => makeObject(k, s));
      return { objects: out, truncated: false, delimitedPrefixes: [] };
    },
    async createMultipartUpload() {
      throw new Error("fake R2: multipart not supported");
    },
    resumeMultipartUpload() {
      throw new Error("fake R2: multipart not supported");
    },
  };
  return bucket as unknown as FakeR2;
}
