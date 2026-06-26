import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { filterKnownAppDriveFiles, filterKnownPlaybackObjects } from "@/lib/media-access";

type Row = Record<string, unknown>;

// Minimal thenable Supabase query mock that actually evaluates .eq()/.ilike() against rows,
// so the per-file fallback inside the filters resolves to a real (empty) result for misses.
function makeAdmin(tables: { media_assets?: Row[]; posts?: Row[] }): SupabaseClient {
  function build(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const ilikes: Array<[string, string]> = [];
    let limitN = Infinity;
    const q: Record<string, unknown> = {
      select: () => q,
      limit: (n: number) => { limitN = n; return q; },
      eq: (col: string, val: unknown) => { eqs.push([col, val]); return q; },
      ilike: (col: string, pat: string) => { ilikes.push([col, pat.replace(/%/g, "")]); return q; },
      not: () => q,
      then: (resolve: (value: { data: Row[]; error: null }) => void) => {
        let data = (tables[table as keyof typeof tables] || []).slice();
        for (const [col, val] of eqs) data = data.filter((r) => r[col] === val);
        for (const [col, needle] of ilikes) data = data.filter((r) => typeof r[col] === "string" && (r[col] as string).includes(needle));
        resolve({ data: data.slice(0, limitN), error: null });
      },
    };
    return q;
  }
  return { from: build } as unknown as SupabaseClient;
}

const WS = "00000000-0000-0000-0000-000000000001";
const ID_A = "aaaaaaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbbbbbb";
const ID_UNKNOWN = "zzzzzzzzzzzzzzzzzzzz";

describe("filterKnownAppDriveFiles", () => {
  it("resolves ids matched by file_id exactly", async () => {
    const admin = makeAdmin({ media_assets: [{ workspace_id: WS, file_id: ID_A }] });
    const known = await filterKnownAppDriveFiles(admin, [ID_A], WS);
    expect(known.has(ID_A)).toBe(true);
  });

  it("resolves legacy ids that only appear inside a url column", async () => {
    const admin = makeAdmin({
      media_assets: [{ workspace_id: WS, file_id: "", url: `/api/drive/stream?id=${ID_B}` }],
    });
    const known = await filterKnownAppDriveFiles(admin, [ID_B], WS);
    expect(known.has(ID_B)).toBe(true);
  });

  it("excludes ids absent from media_assets, posts, and source_vault (falls through to the per-file check)", async () => {
    const admin = makeAdmin({ media_assets: [{ workspace_id: WS, file_id: ID_A }], posts: [] });
    const known = await filterKnownAppDriveFiles(admin, [ID_A, ID_UNKNOWN], WS);
    expect(known.has(ID_A)).toBe(true);
    expect(known.has(ID_UNKNOWN)).toBe(false);
  });

  it("never resolves ids from another workspace's rows", async () => {
    const admin = makeAdmin({ media_assets: [{ workspace_id: "11111111-1111-1111-1111-111111111111", file_id: ID_A }] });
    const known = await filterKnownAppDriveFiles(admin, [ID_A], WS);
    expect(known.has(ID_A)).toBe(false);
  });

  it("ignores malformed ids and returns empty without an admin client", async () => {
    expect((await filterKnownAppDriveFiles(makeAdmin({ media_assets: [] }), ["nope"], WS)).size).toBe(0);
    expect((await filterKnownAppDriveFiles(null, [ID_A], WS)).size).toBe(0);
  });
});

describe("filterKnownPlaybackObjects", () => {
  it("resolves keys matched by playback_storage_key", async () => {
    const key = `${WS}/videos/clip.mp4`;
    const admin = makeAdmin({ media_assets: [{ workspace_id: WS, playback_storage_key: key }] });
    const known = await filterKnownPlaybackObjects(admin, [key], WS);
    expect(known.has(key)).toBe(true);
  });

  it("excludes keys whose prefix does not match the caller workspace", async () => {
    const foreignKey = "11111111-1111-1111-1111-111111111111/videos/clip.mp4";
    const admin = makeAdmin({ media_assets: [{ workspace_id: WS, playback_storage_key: foreignKey }] });
    const known = await filterKnownPlaybackObjects(admin, [foreignKey], WS);
    expect(known.has(foreignKey)).toBe(false);
  });
});
