import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import { getNotionClient } from "../../services/notion";

const NOTION_TIMEOUT_MS = 3000;

async function checkKv(): Promise<boolean> {
  const kv = env?.CACHE;
  if (!kv) return false;
  try {
    await kv.get("health_probe");
    return true;
  } catch {
    return false;
  }
}

async function checkNotion(): Promise<boolean> {
  try {
    const notion = getNotionClient(env);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), NOTION_TIMEOUT_MS),
    );
    await Promise.race([notion.users.me({}), timeout]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unauthenticated health probe for external uptime monitoring.
 * Reports only booleans — never configuration values.
 */
export const GET: APIRoute = async () => {
  const [kv, notion] = await Promise.all([checkKv(), checkNotion()]);
  const ok = kv && notion;
  return new Response(
    JSON.stringify({ ok, kv, notion, ts: new Date().toISOString() }),
    {
      status: ok ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
};
