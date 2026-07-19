/**
 * mock-kv.ts — Reusable mock for NATS KV bucket.
 *
 * Provides a Map-backed in-memory implementation of the NATS KV interface
 * with CAS (Compare-And-Swap) semantics: create(), update() with revision guards.
 *
 * Used by: mesh-kv-sync.test.ts, future collab tests, deploy result tests, health tests.
 *
 * Import: import { MockKV, encode, decode } from "./mocks/mock-kv";
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface MockKvWatchEntry {
  key: string;
  value: Uint8Array | null;
  revision: number;
  operation: "PUT" | "DEL";
}

export function encode(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj));
}

export function decode(buf: Uint8Array): unknown {
  return JSON.parse(decoder.decode(buf));
}

export class MockKV {
  store = new Map<string, { value: Uint8Array; revision: number }>();
  private rev = 0;
  watchers: Array<{
    callback: (entry: MockKvWatchEntry) => void;
    stopped: boolean;
  }> = [];

  async put(key: string, value: Uint8Array) {
    this.rev++;
    this.store.set(key, { value, revision: this.rev });
    for (const w of this.watchers) {
      if (!w.stopped) {
        w.callback({ key, value, revision: this.rev, operation: "PUT" });
      }
    }
    return this.rev;
  }

  async get(key: string) {
    return this.store.get(key) || null;
  }

  async create(key: string, value: Uint8Array) {
    if (this.store.has(key)) {
      throw new Error("wrong last sequence: key already exists");
    }
    return this.put(key, value);
  }

  async update(key: string, value: Uint8Array, expectedRevision: number) {
    const current = this.store.get(key);
    if (!current || current.revision !== expectedRevision) {
      throw new Error(
        `wrong last sequence: revision mismatch (expected ${expectedRevision}, got ${current?.revision ?? "none"})`
      );
    }
    return this.put(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
    for (const w of this.watchers) {
      if (!w.stopped) {
        w.callback({
          key,
          value: null,
          revision: ++this.rev,
          operation: "DEL",
        });
      }
    }
  }

  async keys() {
    const iter = this.store.keys();
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const r = iter.next();
            return Promise.resolve(r);
          },
        };
      },
    };
  }

  async watch(_opts?: unknown) {
    const entries: MockKvWatchEntry[] = [];
    let resolveNext:
      | ((v: IteratorResult<MockKvWatchEntry | undefined>) => void)
      | null = null;
    let stopped = false;

    const watcher = {
      callback: (entry: MockKvWatchEntry) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: entry, done: false });
        } else {
          entries.push(entry);
        }
      },
      stopped: false,
    };
    this.watchers.push(watcher);

    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (stopped)
              return Promise.resolve({ value: undefined, done: true });
            if (entries.length > 0) {
              return Promise.resolve({ value: entries.shift(), done: false });
            }
            return new Promise<IteratorResult<MockKvWatchEntry | undefined>>(
              (resolve) => {
                resolveNext = resolve;
              }
            );
          },
        };
      },
      stop() {
        stopped = true;
        watcher.stopped = true;
        if (resolveNext) {
          resolveNext({ value: undefined, done: true });
        }
      },
    };
  }
}
