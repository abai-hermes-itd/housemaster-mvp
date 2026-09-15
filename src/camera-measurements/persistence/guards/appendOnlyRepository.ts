/**
 * Generic APPEND_ONLY_FACT repository factory.
 *
 * Enforces, at the repository boundary itself (not merely in comments):
 *   - insert:  ALLOWED
 *   - update:  FORBIDDEN — throws AppendOnlyViolationError
 *   - delete:  FORBIDDEN — throws AppendOnlyViolationError
 *
 * The returned object's TYPE has no update/delete members with a usable
 * signature — the `update`/`delete` methods below exist ONLY so that a
 * caller who narrows the type away (e.g. via `as any`) still gets a hard
 * runtime rejection rather than silently reaching the underlying Dexie
 * table's own mutable methods.
 */
import type { Table } from "dexie";
import { AppendOnlyViolationError } from "./errors.ts";

export interface AppendOnlyRepository<T, K> {
  create(record: T): Promise<K>;
  getById(id: K): Promise<T | undefined>;
  list(): Promise<T[]>;
  /** Always throws — see file header. */
  update(id: K, patch: Partial<T>): Promise<never>;
  /** Always throws — see file header. */
  delete(id: K): Promise<never>;
}

export function createAppendOnlyRepository<T, K>(
  // Third generic loosened to `any`: Dexie's `EntityTable<T, PK>` helper
  // (used by db.ts) has a narrower "insert" variant than plain
  // `Table<T, K, T>`, which TS otherwise rejects here structurally even
  // though every operation actually used below (add/get/toArray) is
  // identical between the two.
  table: Table<T, K, any>,
  storeName: string,
): AppendOnlyRepository<T, K> {
  return {
    async create(record: T): Promise<K> {
      return table.add(record as T);
    },
    async getById(id: K): Promise<T | undefined> {
      return table.get(id);
    },
    async list(): Promise<T[]> {
      return table.toArray();
    },
    async update(): Promise<never> {
      throw new AppendOnlyViolationError(storeName, "update");
    },
    async delete(): Promise<never> {
      throw new AppendOnlyViolationError(storeName, "delete");
    },
  };
}
