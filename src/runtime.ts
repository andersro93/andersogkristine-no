import { env as workersEnv } from "cloudflare:workers";

/**
 * The Cloudflare Workers environment (bindings + secrets), typed once here so
 * pages, API routes and the middleware can `import { env } from "../runtime"`
 * instead of casting `cloudflare:workers` everywhere.
 *
 * Implemented as a thin proxy over the live `cloudflare:workers` binding rather
 * than a captured object: in production that is the same thing, and in tests
 * it lets `mock.module("cloudflare:workers", …)` take effect per test file
 * without import-order coupling.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, key) =>
    (workersEnv as unknown as Record<PropertyKey, unknown>)[key],
  has: (_target, key) => key in (workersEnv as object),
  ownKeys: () => Reflect.ownKeys(workersEnv as object),
  getOwnPropertyDescriptor: (_target, key) => {
    const value = (workersEnv as unknown as Record<PropertyKey, unknown>)[key];
    return value === undefined
      ? undefined
      : { value, enumerable: true, configurable: true, writable: false };
  },
});
