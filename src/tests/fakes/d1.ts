/**
 * Test double for Cloudflare D1 backed by bun:sqlite, so repository code is
 * exercised against real SQLite semantics (keyset pagination, CHECKs, NULLs).
 *
 * Mirrors the D1 quirks that matter: `undefined` binds throw D1_TYPE_ERROR
 * (bun:sqlite would silently bind NULL), and results use D1's
 * `{ results, success, meta }` shape.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  import.meta.dir,
  "../../../migrations/0001_gallery.sql",
);

/** The real migration SQL, so tests run against the production schema. */
export function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

type Bindable = string | number | null | ArrayBuffer | Uint8Array;

class FakeStatement {
  private args: Bindable[] = [];
  constructor(
    private readonly sqlite: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): FakeStatement {
    for (const v of values) {
      if (v === undefined) {
        throw new Error(
          "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'",
        );
      }
    }
    this.args = values as Bindable[];
    return this;
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (this.sqlite.query(this.sql).get(...(this.args as any[])) ??
      null) as Record<string, unknown> | null;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.sqlite
      .query(this.sql)
      .all(...(this.args as any[])) as T[];
    return {
      results,
      success: true,
      meta: meta(results.length),
    } as unknown as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const r = this.sqlite.query(this.sql).run(...(this.args as any[]));
    return {
      results: [] as T[],
      success: true,
      meta: {
        ...meta(0),
        changes: r.changes,
        last_row_id: Number(r.lastInsertRowid),
      },
    } as unknown as D1Result<T>;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const rows = this.sqlite.query(this.sql).values(...(this.args as any[]));
    return rows as T[];
  }
}

function meta(rows: number): D1Meta {
  return {
    duration: 0,
    size_after: 0,
    rows_read: rows,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  } as D1Meta;
}

export type FakeD1 = D1Database & { _sqlite: Database };

/** Create an in-memory D1 double; pass the migration SQL to create the schema. */
export function createFakeD1(migrationSql?: string): FakeD1 {
  const sqlite = new Database(":memory:");
  if (migrationSql) sqlite.exec(migrationSql);

  const fake = {
    _sqlite: sqlite,
    prepare(sql: string) {
      return new FakeStatement(sqlite, sql);
    },
    async batch(statements: FakeStatement[]) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      throw new Error("dump() not supported by the fake");
    },
    withSession() {
      return fake as unknown as D1DatabaseSession;
    },
  };
  return fake as unknown as FakeD1;
}
