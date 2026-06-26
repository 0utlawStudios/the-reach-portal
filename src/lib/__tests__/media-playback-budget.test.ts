import { describe, expect, it, vi } from "vitest";
import { enforcePlaybackBudget, PLAYBACK_BUDGET_BYTES } from "@/lib/media-playback-budget";

const MB = 1024 * 1024;

type Obj = { key: string; size: number; lastAccessed?: string; created?: string };

// Simulate a nested media-playback bucket (keys are workspaceId/cardId/uuid-name.ext) over
// the Supabase Storage list() API, plus remove() and the media_assets detach update.
function makeAdmin(objects: Obj[], opts: { listError?: boolean } = {}) {
  const removed: string[] = [];
  const cleared: string[] = [];
  const listed: string[] = [];

  const childrenOf = (prefix: string) => {
    const seenFolders = new Set<string>();
    const entries: Array<Record<string, unknown>> = [];
    for (const o of objects) {
      let rest: string[];
      if (prefix === "") {
        rest = o.key.split("/");
      } else if (o.key === prefix || o.key.startsWith(`${prefix}/`)) {
        rest = o.key.slice(prefix.length + 1).split("/").filter(Boolean);
      } else {
        continue;
      }
      const seg = rest[0];
      if (!seg) continue;
      if (rest.length > 1) {
        if (!seenFolders.has(seg)) {
          seenFolders.add(seg);
          entries.push({ name: seg, id: null, metadata: null, created_at: null, updated_at: null, last_accessed_at: null });
        }
      } else {
        entries.push({
          name: seg,
          id: o.key,
          metadata: { size: o.size },
          created_at: o.created || null,
          updated_at: null,
          last_accessed_at: o.lastAccessed || null,
        });
      }
    }
    return entries;
  };

  const admin = {
    storage: {
      from: () => ({
        list: vi.fn(async (prefix: string) => {
          listed.push(prefix);
          if (opts.listError) return { data: null, error: { message: "boom" } };
          return { data: childrenOf(prefix), error: null };
        }),
        remove: vi.fn(async (keys: string[]) => {
          removed.push(...keys);
          return { error: null };
        }),
      }),
    },
    from: () => ({
      update: () => ({
        eq: vi.fn(async (_col: string, val: string) => {
          cleared.push(val);
          return { error: null };
        }),
      }),
    }),
  } as never;

  return { admin, removed, cleared, listed };
}

// N copies of 50 MB each under one workspace/card, oldest-accessed first (f0 is coldest).
function fiftyMbObjects(n: number): Obj[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `ws1/card1/f${String(i).padStart(2, "0")}`,
    size: 50 * MB,
    lastAccessed: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));
}

describe("enforcePlaybackBudget", () => {
  it("does nothing while the bucket plus the incoming copy fits the budget", async () => {
    const { admin, removed, cleared } = makeAdmin(fiftyMbObjects(10)); // 500 MB
    const res = await enforcePlaybackBudget(admin, 50 * MB); // 550 MB total, under 700
    expect(res.evicted).toBe(0);
    expect(removed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("evicts the least-recently-played copies until the incoming copy fits", async () => {
    const { admin, removed, cleared } = makeAdmin(fiftyMbObjects(15)); // 750 MB
    const res = await enforcePlaybackBudget(admin, 50 * MB); // 750 + 50 = 800 -> evict to <= 700
    expect(res.evicted).toBe(2);
    expect(res.freedBytes).toBe(100 * MB);
    // Oldest two (f00, f01) go first, and each is detached from its media_assets row.
    expect(removed).toEqual(["ws1/card1/f00", "ws1/card1/f01"]);
    expect(cleared).toEqual(["ws1/card1/f00", "ws1/card1/f01"]);
  });

  it("evicts strictly by least-recently-played order, not upload order", async () => {
    // B is bigger AND older-accessed than A; with the bucket already over budget, B goes first.
    const objects: Obj[] = [
      { key: "ws1/cardA/new", size: 400 * MB, lastAccessed: "2026-06-20T00:00:00Z" },
      { key: "ws1/cardB/old", size: 400 * MB, lastAccessed: "2026-06-01T00:00:00Z" },
    ];
    const { admin, removed } = makeAdmin(objects); // 800 MB already > 700
    const res = await enforcePlaybackBudget(admin, 10 * MB);
    expect(res.evicted).toBe(1);
    expect(removed).toEqual(["ws1/cardB/old"]); // the colder one
  });

  it("falls back to upload time when last-played is missing", async () => {
    const objects: Obj[] = [
      { key: "ws1/c/newer", size: 400 * MB, created: "2026-06-10T00:00:00Z" },
      { key: "ws1/c/older", size: 400 * MB, created: "2026-06-02T00:00:00Z" },
    ];
    const { admin, removed } = makeAdmin(objects);
    const res = await enforcePlaybackBudget(admin, 10 * MB);
    expect(res.evicted).toBe(1);
    expect(removed).toEqual(["ws1/c/older"]);
  });

  it("fails OPEN: a Storage list error never blocks the upload", async () => {
    const { admin, removed, cleared } = makeAdmin(fiftyMbObjects(20), { listError: true });
    const res = await enforcePlaybackBudget(admin, 50 * MB);
    expect(res.evicted).toBe(0);
    expect(removed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("keeps the budget headroom realistic (700MB, under the 1GB shared pool)", () => {
    expect(PLAYBACK_BUDGET_BYTES).toBe(700 * MB);
    expect(PLAYBACK_BUDGET_BYTES).toBeLessThan(1024 * MB);
  });
});
