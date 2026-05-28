import type { Env } from "cloudflare:workers";

let cloudflareEnv: Env | undefined;
try {
  // Dynamically import to prevent static resolution errors in Bun/Node test runners
  // @ts-expect-error
  const workers = await import("cloudflare:workers");
  cloudflareEnv = workers.env;
} catch {
  // Graceful fallback for non-worker environments (like tests or CLI scripts)
}

/**
 * Resolves an environment variable from:
 * 1. An optional local environment context (localEnv)
 * 2. The Cloudflare Workers imported environment (cloudflareEnv)
 * 3. The Node.js process environment (process.env)
 *
 * Preserves the exact type (e.g. KVNamespace vs string) using TypeScript generics.
 */
export function getEnvVar<K extends keyof Env>(key: K, localEnv?: Env): Env[K] {
  return (
    localEnv?.[key] || cloudflareEnv?.[key] || (process.env[key] as Env[K])
  );
}

/**
 * Resolves a required environment variable, throwing an error if it is not defined.
 */
export function requireEnvVar(key: keyof Env, localEnv?: Env): string {
  const value = getEnvVar(key, localEnv);
  if (!value || typeof value !== "string") {
    throw new Error(
      `${key} is not defined or is not a string. Please check your environment configuration or .env file.`,
    );
  }
  return value;
}
