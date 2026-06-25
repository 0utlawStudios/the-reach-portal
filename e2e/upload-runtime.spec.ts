import { test, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { GoogleAuth } from "google-auth-library";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Persona = {
  email: string;
  password: string;
  userId: string;
  session: Session;
};

type FixtureState = {
  runId: string;
  workspaceId: string;
  persona: Persona | null;
  createdUserIds: string[];
  createdEmails: string[];
  createdPostIds: string[];
  createdDriveFileIds: string[];
  mediaNames: string[];
};

type NetworkRecord = {
  method: string;
  status: number;
  url: string;
  durationMs: number;
};

type MediaRow = {
  id: string;
  workspace_id: string;
  name: string;
  file_type: string;
  file_id: string | null;
  publish_url: string | null;
  drive_proxy_url: string | null;
  playback_url: string | null;
  playback_storage_key: string | null;
  mime_type: string | null;
  size_bytes: number | null;
};

type PostRow = {
  id: string;
  workspace_id: string;
  title: string;
  stage: string;
  thumbnail_url: string | null;
  source_vault: unknown;
};

const env = loadEnv();
const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://thereach.ten80ten.com";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const RUN_ID = process.env.PLAYWRIGHT_RUN_ID ?? `upload-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const TINY_HEIC_FIXTURE_BASE64 = `
AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAUNG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRp
bmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABo
dmMxAAAAABVpbmZlAgAAAQACAABodmMxAAAAABppcmVmAAAAAAAAAA5hdXhsAAIAAQABAAATV2lwcnAAABMtaXBjbwAAEahjb2xy
cHJvZgAAEZxhcHBsAgAAAG1udHJHUkFZWFlaIAfcAAgAFwAPAC4AD2Fjc3BBUFBMAAAAAG5vbmUAAAAAAAAAAAAAAAAAAAAAAAD2
1gABAAAAANMtYXBwbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABWRlc2MAAADAAAAAeWRz
Y20AAAE8AAAIGmNwcnQAAAlYAAAAI3d0cHQAAAl8AAAAFGtUUkMAAAmQAAAIDGRlc2MAAAAAAAAAH0dlbmVyaWMgR3JheSBHYW1t
YSAyLjIgUHJvZmlsZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAABtbHVjAAAAAAAAAB8AAAAMc2tTSwAAAC4AAAGEZGFESwAAADoAAAGyY2FFUwAAADgAAAHsdmlW
TgAAAEAAAAIkcHRCUgAAAEoAAAJkdWtVQQAAACwAAAKuZnJGVQAAAD4AAALaaHVIVQAAADQAAAMYemhUVwAAABoAAANMa29LUgAA
ACIAAANmbmJOTwAAADoAAAOIY3NDWgAAACgAAAPCaGVJTAAAACQAAAPqcm9STwAAACoAAAQOZGVERQAAAE4AAAQ4aXRJVAAAAE4A
AASGc3ZTRQAAADgAAATUemhDTgAAABoAAAUMamFKUAAAACYAAAUmZWxHUgAAACoAAAVMcHRQTwAAAFIAAAV2bmxOTAAAAEAAAAXI
ZXNFUwAAAEwAAAYIdGhUSAAAADIAAAZUdHJUUgAAACQAAAaGZmlGSQAAAEYAAAaqaHJIUgAAAD4AAAbwcGxQTAAAAEoAAAcuYXJF
RwAAACwAAAd4cnVSVQAAADoAAAekZW5VUwAAADwAAAfeAFYBYQBlAG8AYgBlAGMAbgDhACAAcwBpAHYA4QAgAGcAYQBtAGEAIAAy
ACwAMgBHAGUAbgBlAHIAaQBzAGsAIABnAHIA5QAgADIALAAyACAAZwBhAG0AbQBhAC0AcAByAG8AZgBpAGwARwBhAG0AbQBhACAA
ZABlACAAZwByAGkAcwBvAHMAIABnAGUAbgDoAHIAaQBjAGEAIAAyAC4AMgBDHqUAdQAgAGgA7ABuAGgAIABNAOAAdQAgAHgA4QBt
ACAAQwBoAHUAbgBnACAARwBhAG0AbQBhACAAMgAuADIAUABlAHIAZgBpAGwAIABHAGUAbgDpAHIAaQBjAG8AIABkAGEAIABHAGEA
bQBhACAAZABlACAAQwBpAG4AegBhAHMAIAAyACwAMgQXBDAEMwQwBDsETAQ9BDAAIABHAHIAYQB5AC0EMwQwBDwEMAAgADIALgAy
AFAAcgBvAGYAaQBsACAAZwDpAG4A6QByAGkAcQB1AGUAIABnAHIAaQBzACAAZwBhAG0AbQBhACAAMgAsADIAwQBsAHQAYQBsAOEA
bgBvAHMAIABzAHoA/AByAGsAZQAgAGcAYQBtAG0AYQAgADIALgAykBp1KHBwlo5RSV6mADIALgAygnJfaWPPj/DHfLwYACDWjMDJ
ACCsELnIACAAMgAuADIAINUEuFzTDMd8AEcAZQBuAGUAcgBpAHMAawAgAGcAcgDlACAAZwBhAG0AbQBhACAAMgAsADIALQBwAHIA
bwBmAGkAbABPAGIAZQBjAG4A4QAgAWEAZQBkAOEAIABnAGEAbQBhACAAMgAuADIF0gXQBd4F1AAgBdAF5AXVBegAIAXbBdwF3AXZ
ACAAMgAuADIARwBhAG0AYQAgAGcAcgBpACAAZwBlAG4AZQByAGkAYwEDACAAMgAsADIAQQBsAGwAZwBlAG0AZQBpAG4AZQBzACAA
RwByAGEAdQBzAHQAdQBmAGUAbgAtAFAAcgBvAGYAaQBsACAARwBhAG0AbQBhACAAMgAsADIAUAByAG8AZgBpAGwAbwAgAGcAcgBp
AGcAaQBvACAAZwBlAG4AZQByAGkAYwBvACAAZABlAGwAbABhACAAZwBhAG0AbQBhACAAMgAsADIARwBlAG4AZQByAGkAcwBrACAA
ZwByAOUAIAAyACwAMgAgAGcAYQBtAG0AYQBwAHIAbwBmAGkAbGZukBpwcF6mfPtlcAAyAC4AMmPPj/Blh072TgCCLDCwMOwwpDCs
MPMw3gAgADIALgAyACAw1zDtMNUwoTCkMOsDkwO1A70DuQO6A8wAIAOTA7oDwQO5ACADkwOsA7wDvAOxACAAMgAuADIAUABlAHIA
ZgBpAGwAIABnAGUAbgDpAHIAaQBjAG8AIABkAGUAIABjAGkAbgB6AGUAbgB0AG8AcwAgAGQAYQAgAEcAYQBtAG0AYQAgADIALAAy
AEEAbABnAGUAbQBlAGUAbgAgAGcAcgBpAGoAcwAgAGcAYQBtAG0AYQAgADIALAAyAC0AcAByAG8AZgBpAGUAbABQAGUAcgBmAGkA
bAAgAGcAZQBuAOkAcgBpAGMAbwAgAGQAZQAgAGcAYQBtAG0AYQAgAGQAZQAgAGcAcgBpAHMAZQBzACAAMgAsADIOIw4xDgcOKg41
DkEOAQ4hDiEOMg5ADgEOIw4iDkwOFw4xDkgOJw5EDhsAIAAyAC4AMgBHAGUAbgBlAGwAIABHAHIAaQAgAEcAYQBtAGEAIAAyACwA
MgBZAGwAZQBpAG4AZQBuACAAaABhAHIAbQBhAGEAbgAgAGcAYQBtAG0AYQAgADIALAAyACAALQBwAHIAbwBmAGkAaQBsAGkARwBl
AG4AZQByAGkBDQBrAGkAIABHAHIAYQB5ACAARwBhAG0AbQBhACAAMgAuADIAIABwAHIAbwBmAGkAbABVAG4AaQB3AGUAcgBzAGEA
bABuAHkAIABwAHIAbwBmAGkAbAAgAHMAegBhAHIAbwFbAGMAaQAgAGcAYQBtAG0AYQAgADIALAAyBjoGJwZFBicAIAAyAC4AMgAg
BkQGSAZGACAGMQZFBicGLwZKACAGOQYnBkUEHgQxBEkEMARPACAEQQQ1BEAEMARPACAEMwQwBDwEPAQwACAAMgAsADIALQQ/BEAE
PgREBDgEOwRMAEcAZQBuAGUAcgBpAGMAIABHAHIAYQB5ACAARwBhAG0AbQBhACAAMgAuADIAIABQAHIAbwBmAGkAbABlAAB0ZXh0
AAAAAENvcHlyaWdodCBBcHBsZSBJbmMuLCAyMDEyAABYWVogAAAAAAAA81EAAQAAAAEWzGN1cnYAAAAAAAAEAAAAAAUACgAPABQA
GQAeACMAKAAtADIANwA7AEAARQBKAE8AVABZAF4AYwBoAG0AcgB3AHwAgQCGAIsAkACVAJoAnwCkAKkArgCyALcAvADBAMYAywDQ
ANUA2wDgAOUA6wDwAPYA+wEBAQcBDQETARkBHwElASsBMgE4AT4BRQFMAVIBWQFgAWcBbgF1AXwBgwGLAZIBmgGhAakBsQG5AcEB
yQHRAdkB4QHpAfIB+gIDAgwCFAIdAiYCLwI4AkECSwJUAl0CZwJxAnoChAKOApgCogKsArYCwQLLAtUC4ALrAvUDAAMLAxYDIQMt
AzgDQwNPA1oDZgNyA34DigOWA6IDrgO6A8cD0wPgA+wD+QQGBBMEIAQtBDsESARVBGMEcQR+BIwEmgSoBLYExATTBOEE8AT+BQ0F
HAUrBToFSQVYBWcFdwWGBZYFpgW1BcUF1QXlBfYGBgYWBicGNwZIBlkGagZ7BowGnQavBsAG0QbjBvUHBwcZBysHPQdPB2EHdAeG
B5kHrAe/B9IH5Qf4CAsIHwgyCEYIWghuCIIIlgiqCL4I0gjnCPsJEAklCToJTwlkCXkJjwmkCboJzwnlCfsKEQonCj0KVApqCoEK
mAquCsUK3ArzCwsLIgs5C1ELaQuAC5gLsAvIC+EL+QwSDCoMQwxcDHUMjgynDMAM2QzzDQ0NJg1ADVoNdA2ODakNww3eDfgOEw4u
DkkOZA5/DpsOtg7SDu4PCQ8lD0EPXg96D5YPsw/PD+wQCRAmEEMQYRB+EJsQuRDXEPURExExEU8RbRGMEaoRyRHoEgcSJhJFEmQS
hBKjEsMS4xMDEyMTQxNjE4MTpBPFE+UUBhQnFEkUahSLFK0UzhTwFRIVNBVWFXgVmxW9FeAWAxYmFkkWbBaPFrIW1hb6Fx0XQRdl
F4kXrhfSF/cYGxhAGGUYihivGNUY+hkgGUUZaxmRGbcZ3RoEGioaURp3Gp4axRrsGxQbOxtjG4obshvaHAIcKhxSHHscoxzMHPUd
Hh1HHXAdmR3DHeweFh5AHmoelB6+HukfEx8+H2kflB+/H+ogFSBBIGwgmCDEIPAhHCFIIXUhoSHOIfsiJyJVIoIiryLdIwojOCNm
I5QjwiPwJB8kTSR8JKsk2iUJJTglaCWXJccl9yYnJlcmhya3JugnGCdJJ3onqyfcKA0oPyhxKKIo1CkGKTgpaymdKdAqAio1Kmgq
myrPKwIrNitpK50r0SwFLDksbiyiLNctDC1BLXYtqy3hLhYuTC6CLrcu7i8kL1ovkS/HL/4wNTBsMKQw2zESMUoxgjG6MfIyKjJj
Mpsy1DMNM0YzfzO4M/E0KzRlNJ402DUTNU01hzXCNf02NzZyNq426TckN2A3nDfXOBQ4UDiMOMg5BTlCOX85vDn5OjY6dDqyOu87
LTtrO6o76DwnPGU8pDzjPSI9YT2hPeA+ID5gPqA+4D8hP2E/oj/iQCNAZECmQOdBKUFqQaxB7kIwQnJCtUL3QzpDfUPARANER0SK
RM5FEkVVRZpF3kYiRmdGq0bwRzVHe0fASAVIS0iRSNdJHUljSalJ8Eo3Sn1KxEsMS1NLmkviTCpMcky6TQJNSk2TTdxOJU5uTrdP
AE9JT5NP3VAnUHFQu1EGUVBRm1HmUjFSfFLHUxNTX1OqU/ZUQlSPVNtVKFV1VcJWD1ZcVqlW91dEV5JX4FgvWH1Yy1kaWWlZuFoH
WlZaplr1W0VblVvlXDVchlzWXSddeF3JXhpebF69Xw9fYV+zYAVgV2CqYPxhT2GiYfViSWKcYvBjQ2OXY+tkQGSUZOllPWWSZedm
PWaSZuhnPWeTZ+loP2iWaOxpQ2maafFqSGqfavdrT2una/9sV2yvbQhtYG25bhJua27Ebx5veG/RcCtwhnDgcTpxlXHwcktypnMB
c11zuHQUdHB0zHUodYV14XY+dpt2+HdWd7N4EXhueMx5KnmJeed6RnqlewR7Y3vCfCF8gXzhfUF9oX4BfmJ+wn8jf4R/5YBHgKiB
CoFrgc2CMIKSgvSDV4O6hB2EgITjhUeFq4YOhnKG14c7h5+IBIhpiM6JM4mZif6KZIrKizCLlov8jGOMyo0xjZiN/45mjs6PNo+e
kAaQbpDWkT+RqJIRknqS45NNk7aUIJSKlPSVX5XJljSWn5cKl3WX4JhMmLiZJJmQmfyaaJrVm0Kbr5wcnImc951kndKeQJ6unx2f
i5/6oGmg2KFHobaiJqKWowajdqPmpFakx6U4pammGqaLpv2nbqfgqFKoxKk3qamqHKqPqwKrdavprFys0K1ErbiuLa6hrxavi7AA
sHWw6rFgsdayS7LCszizrrQltJy1E7WKtgG2ebbwt2i34LhZuNG5SrnCuju6tbsuu6e8IbybvRW9j74KvoS+/796v/XAcMDswWfB
48JfwtvDWMPUxFHEzsVLxcjGRsbDx0HHv8g9yLzJOsm5yjjKt8s2y7bMNcy1zTXNtc42zrbPN8+40DnQutE80b7SP9LB00TTxtRJ
1MvVTtXR1lXW2Ndc1+DYZNjo2WzZ8dp22vvbgNwF3IrdEN2W3hzeot8p36/gNuC94UThzOJT4tvjY+Pr5HPk/OWE5g3mlucf56no
Mui86Ubp0Opb6uXrcOv77IbtEe2c7ijutO9A78zwWPDl8XLx//KM8xnzp/Q09ML1UPXe9m32+/eK+Bn4qPk4+cf6V/rn+3f8B/yY
/Sn9uv5L/tz/bf//AAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAoY2xhcAAAAAEAAAABAAAAAQAAAAH/wAAAAIAAAP/AAAAAgAAAAAAA
CWlyb3QAAAAAEHBpeGkAAAAAAwgICAAAAA5waHhpAAAAAAEIAAAAN2F1eEMAAAAAdXJuOm1wZWc6aGV2YzoyMDE1OmF1eGlkOjEA
AAAADAAAAAhOAaUEAAH+QAAAAHJodmNDAQNwAAAAsAAAAAAAHvAA/P34+AAACwOgAAEAF0ABDAH//wNwAAADALAAAAMAAAMAHnAk
oQABACRCAQEDcAAAAwCwAAADAAADAB6gFCBBwKEEGIe5FlU3AgICAICiAAEACUQBwGFyyERTZAAAAHFodmNDAQQIAAAAv8gAAAAA
HvAA/Pz4+AAACwOgAAEAF0ABDAH//wQIAAADAL/IAAADAAAeFwJAoQABACNCAQEECAAAAwC/yAAAAwAAHsBQgQcBPwf4gXuRZVNw
ICAgCKIAAQAJRAHAYdLIRFNkAAAAImlwbWEAAAAAAAAAAgABBoECBYiDhAACBgIGh4mDhAAAACxpbG9jAAAAAEQAAAIAAQAAAAEA
ABRcAAAAKwACAAAAAQAAFIcAAAAlAAAAAW1kYXQAAAAAAAAAYAAAACcoAa+ixkft2//+JRWypaJ+oHto45lf0CI62Cx9i6Hm1EaQ
+PQI/mwAAAAhKAGvROiMBv//COE3mZ+uT1RI5UAup5xfU6yC2EKrsT3A
`.replace(/\s/g, "");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let state: FixtureState;
const evidence: Record<string, unknown> = {};

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  guardRuntimeTarget();
  state = await seedFixture();
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (!state) return;
  await cleanupFixture(state);
});

test("live media library upload renders images and video through real backend paths", async ({ browser }, testInfo) => {
  const fixtures = createMediaFixtures(testInfo, state.runId);
  expect(statSync(fixtures.largePath).size).toBeGreaterThanOrEqual(4 * 1024 * 1024);
  state.mediaNames.push(fixtures.smallName, fixtures.largeName, fixtures.heicName, fixtures.videoName);

  const { context, page } = await openApp(browser, requirePersona(state), "media");
  const network = attachMediaNetworkRecorder(page);
  const uploadButton = page.getByRole("button", { name: /Upload Files/i });
  await expect(uploadButton).toBeVisible({ timeout: 30_000 });

  const chooserPromise = page.waitForEvent("filechooser");
  await uploadButton.click();
  const chooser = await chooserPromise;
  await chooser.setFiles([fixtures.smallPath, fixtures.largePath, fixtures.heicPath, fixtures.videoPath]);

  await expect(page.getByText(fixtures.smallName, { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(fixtures.largeName, { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(fixtures.heicName, { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(fixtures.videoName, { exact: true })).toBeVisible({ timeout: 120_000 });

  const rows = await expectMediaRows([fixtures.smallName, fixtures.largeName, fixtures.heicName, fixtures.videoName]);
  const small = rowByName(rows, fixtures.smallName);
  const large = rowByName(rows, fixtures.largeName);
  const heic = rowByName(rows, fixtures.heicName);
  const video = rowByName(rows, fixtures.videoName);

  expect(small).toMatchObject({ workspace_id: state.workspaceId, file_type: "image", mime_type: "image/png" });
  expect(large).toMatchObject({ workspace_id: state.workspaceId, file_type: "image", mime_type: "image/png" });
  expect(heic).toMatchObject({ workspace_id: state.workspaceId, file_type: "image" });
  expect(["image/heic", "image/heif"]).toContain(heic.mime_type);
  expect(video).toMatchObject({ workspace_id: state.workspaceId, file_type: "video", mime_type: "video/mp4" });
  for (const row of [small, large, heic, video]) {
    expect(row.file_id, `${row.name} file_id`).toBeTruthy();
    expect(row.drive_proxy_url, `${row.name} drive_proxy_url`).toContain("/api/drive/stream");
    expect(row.publish_url, `${row.name} publish_url`).toContain("/api/drive/stream");
  }

  await expect.poll(async () => {
    const { data, error } = await admin
      .from("media_assets")
      .select("playback_url, playback_storage_key")
      .eq("workspace_id", state.workspaceId)
      .eq("name", fixtures.videoName)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data?.playback_url && data?.playback_storage_key);
  }, { timeout: 120_000, message: "video playback copy should be created in the background" }).toBe(true);

  const heicRenderStartedAt = Date.now();
  await expect.poll(async () => renderedPreviewImageForFile(page, requiredString(heic.file_id, "HEIC file_id")), {
    timeout: 10_000,
    message: "HEIC app thumbnail should render through image-preview before the 10s black-screen complaint",
  }).toBe(true);
  const heicRenderMs = Date.now() - heicRenderStartedAt;
  expect(heicRenderMs).toBeLessThan(10_000);

  await page.getByText(fixtures.heicName, { exact: true }).click();
  const heicFullRenderStartedAt = Date.now();
  await expect.poll(async () => renderedPreviewImageForFile(page, requiredString(heic.file_id, "HEIC file_id"), "full"), {
    timeout: 10_000,
    message: "HEIC full lightbox preview should render before the 10s black-screen complaint",
  }).toBe(true);
  const heicFullRenderMs = Date.now() - heicFullRenderStartedAt;
  expect(heicFullRenderMs).toBeLessThan(10_000);

  const refreshed = await expectMediaRows([fixtures.smallName, fixtures.largeName, fixtures.heicName, fixtures.videoName]);
  const refreshedVideo = rowByName(refreshed, fixtures.videoName);

  const smallRender = await loadImageInBrowser(page, requiredString(small.drive_proxy_url, `${small.name} drive_proxy_url`));
  expect(smallRender).toMatchObject({ ok: true });
  const largeRender = await loadImageInBrowser(page, requiredString(large.drive_proxy_url, `${large.name} drive_proxy_url`));
  expect(largeRender).toMatchObject({ ok: true });
  const videoRender = await loadVideoMetadataInBrowser(
    page,
    requiredString(refreshedVideo.playback_url || refreshedVideo.drive_proxy_url, `${refreshedVideo.name} playback or drive URL`),
  );
  expect(videoRender).toMatchObject({ ok: true });

  expect(network.some((r) => r.url.includes("/api/drive/proxy-upload") && r.status < 400)).toBe(true);
  expect(network.some((r) => r.url.includes("/api/drive/upload") && r.status < 400)).toBe(true);
  expect(network.some((r) => r.url.includes("/api/drive/upload-chunk") && r.status < 400)).toBe(true);
  expect(network.some((r) => r.url.includes("/api/drive/finalize") && r.status < 400)).toBe(true);
  expect(network.some((r) => r.url.includes("/api/media/playback-upload") && r.status < 400)).toBe(true);
  expect(criticalNetworkFailures(network)).toEqual([]);

  evidence.mediaLibrary = { rows: refreshed, network, smallRender, largeRender, heicRenderMs, heicFullRenderMs, videoRender };
  writeEvidence(testInfo, "media-library-evidence.json", evidence.mediaLibrary);
  await context.close();
});

test("live create post upload persists Drive metadata without post loss", async ({ browser }, testInfo) => {
  const fixtures = createMediaFixtures(testInfo, `${state.runId}-post`);
  const postTitle = `QA Upload Runtime ${state.runId}`;
  state.mediaNames.push(fixtures.smallName);

  const { context, page } = await openApp(browser, requirePersona(state), "pipeline");
  const network = attachMediaNetworkRecorder(page);

  await expect(page.getByTestId("kanban-board")).toBeVisible({ timeout: 30_000 });
  const createPostButton = page.getByRole("button", { name: "Create Post" });
  await expect(createPostButton).toBeVisible({ timeout: 30_000 });
  await createPostButton.click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: /Create New Post/i });
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder(/Product Launch Reel/i).fill(postTitle);
  const chooserPromise = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /Upload from device/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixtures.smallPath);
  await expect(dialog.getByText(fixtures.smallName)).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole("button", { name: /Instagram/i }).click();
  await dialog.getByRole("button", { name: /^Image$/i }).click();
  await dialog.getByPlaceholder(/Write your caption/i).fill("Runtime upload proof caption.");
  await dialog.locator('input[type="date"]').fill(futureDate());
  await dialog.locator('input[type="time"]').fill("09:30");
  await dialog.locator("select").selectOption({ label: "Canva Pro" });
  await dialog.getByRole("button", { name: /^Create Post$/i }).click();

  const post = await expectPostRow(postTitle);
  state.createdPostIds.push(post.id);
  expect(post).toMatchObject({ workspace_id: state.workspaceId, stage: "ideas" });
  expect(post.thumbnail_url).toContain("/api/drive/stream");
  const sourceVault = post.source_vault as {
    rawFiles?: Array<{ fileId?: string; driveProxyUrl?: string; publishUrl?: string; mimeType?: string }>;
  };
  expect(sourceVault.rawFiles?.[0]).toMatchObject({
    mimeType: "image/png",
  });
  expect(sourceVault.rawFiles?.[0]?.fileId).toBeTruthy();
  expect(sourceVault.rawFiles?.[0]?.driveProxyUrl).toContain("/api/drive/stream");
  expect(sourceVault.rawFiles?.[0]?.publishUrl).toContain("/api/drive/stream");
  await expectMediaRows([fixtures.smallName]);
  await expect(page.getByTestId(`content-card-${post.id}`)).toBeVisible({ timeout: 30_000 });
  expect(network.some((r) => r.url.includes("/api/drive/proxy-upload") && r.status < 400)).toBe(true);
  expect(criticalNetworkFailures(network)).toEqual([]);

  evidence.createPost = { post, network };
  writeEvidence(testInfo, "create-post-upload-evidence.json", evidence.createPost);
  await context.close();
});

async function seedFixture(): Promise<FixtureState> {
  const stamp = RUN_ID.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 54);
  const workspaceId = randomUUID();
  const password = `Reach-${randomUUID()}-1a!`;
  const email = `qa-${stamp}-media@example.com`;
  const label = "QA Upload Runtime";
  const fixture: FixtureState = {
    runId: RUN_ID,
    workspaceId,
    persona: null,
    createdUserIds: [],
    createdEmails: [email],
    createdPostIds: [],
    createdDriveFileIds: [],
    mediaNames: [],
  };
  state = fixture;

  await must(admin.from("workspaces").insert({
    id: workspaceId,
    name: `QA Upload ${stamp}`,
    slug: `qa-upload-${stamp}`,
  }), "insert temp workspace");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: label, role: "creative_director" },
    app_metadata: { role: "creative_director" },
  });
  if (error || !data.user) throw new Error(`create auth user: ${formatError(error)}`);
  fixture.createdUserIds.push(data.user.id);

  await must(admin.from("team_members").insert({
    workspace_id: workspaceId,
    name: label,
    email,
    role: "creative_director",
    status: "active",
  }), "insert team member");

  await must(admin.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: data.user.id,
    role: "creative_director",
    status: "active",
  }), "insert workspace member");

  const session = await signIn(email, password);
  fixture.persona = { email, password, userId: data.user.id, session };

  return fixture;
}

async function cleanupFixture(fixture: FixtureState) {
  const driveFileIds = new Set<string>();
  const playbackKeys = new Set<string>();
  for (const fileId of fixture.createdDriveFileIds) driveFileIds.add(fileId);

  const { data: mediaRows } = await admin
    .from("media_assets")
    .select("id, name, file_id, playback_storage_key")
    .eq("workspace_id", fixture.workspaceId);
  for (const row of mediaRows || []) {
    if (row.file_id) driveFileIds.add(row.file_id as string);
    if (row.playback_storage_key) playbackKeys.add(row.playback_storage_key as string);
  }

  if (fixture.createdPostIds.length > 0) {
    const { data: posts } = await admin
      .from("posts")
      .select("id, source_vault")
      .in("id", fixture.createdPostIds);
    for (const post of posts || []) {
      const rawFiles = (post.source_vault as { rawFiles?: Array<{ fileId?: string }> } | null)?.rawFiles || [];
      for (const file of rawFiles) if (file.fileId) driveFileIds.add(file.fileId);
    }
    await admin.from("posts").delete().in("id", fixture.createdPostIds);
    await admin.from("audit_log_v2").delete().in("entity_id", fixture.createdPostIds);
  }

  if (mediaRows && mediaRows.length > 0) {
    await admin.from("media_assets").delete().eq("workspace_id", fixture.workspaceId);
  }
  if (playbackKeys.size > 0) {
    await admin.storage.from("media-playback").remove([...playbackKeys]);
  }
  if (driveFileIds.size > 0) {
    await deleteDriveFiles([...driveFileIds]);
  }
  await admin.from("workspace_members").delete().eq("workspace_id", fixture.workspaceId);
  await admin.from("team_members").delete().eq("workspace_id", fixture.workspaceId);
  await admin.from("workspaces").delete().eq("id", fixture.workspaceId);
  for (const userId of fixture.createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
}

async function openApp(browser: Browser, persona: Persona, pageName: "media" | "pipeline") {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  await context.addInitScript(({ authStorageKey, session, page }) => {
    try {
      window.localStorage.setItem(authStorageKey, JSON.stringify(session));
      window.localStorage.setItem("pt_v2_nav_page", JSON.stringify(page));
      window.localStorage.setItem("pt_v2_nav_sidebar", JSON.stringify(true));
      window.localStorage.setItem("pt_v2_nav_sidebar_pinned", JSON.stringify(true));
    } catch {
      // about:blank can deny localStorage before the real app document loads.
    }
  }, {
    authStorageKey: AUTH_STORAGE_KEY,
    session: persona.session,
    page: pageName,
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signInThroughUiIfNeeded(page, persona);
  return { context, page };
}

async function signInThroughUiIfNeeded(page: Page, persona: Persona): Promise<void> {
  const emailInput = page.getByPlaceholder("you@company.com");
  try {
    await emailInput.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return;
  }
  await emailInput.fill(persona.email);
  await page.getByPlaceholder("Enter your password").fill(persona.password);
  await page.getByRole("button", { name: /Sign In/i }).click();
  await expect(page.getByText("Checking session")).toBeHidden({ timeout: 15_000 });
}

function attachMediaNetworkRecorder(page: Page): NetworkRecord[] {
  const starts = new Map<unknown, number>();
  const records: NetworkRecord[] = [];
  const patterns = [
    "/api/drive/proxy-upload",
    "/api/drive/upload",
    "/api/drive/upload-chunk",
    "/api/drive/finalize",
    "/api/drive/stream",
    "/api/media/playback-upload",
    "/api/media/playback",
    "/api/media/image-preview",
    "/rest/v1/media_assets",
    "/rest/v1/posts",
  ];
  page.on("request", (request) => {
    if (patterns.some((pattern) => request.url().includes(pattern))) starts.set(request, Date.now());
  });
  page.on("response", (response) => {
    const request = response.request();
    const startedAt = starts.get(request);
    if (!startedAt) return;
    const url = response.url();
    records.push({
      method: request.method(),
      status: response.status(),
      url,
      durationMs: Date.now() - startedAt,
    });
    if (response.status() < 400 && (
      url.includes("/api/drive/proxy-upload") ||
      url.includes("/api/drive/finalize") ||
      url.includes("/api/drive/upload-chunk")
    )) {
      void response.json()
        .then((payload) => collectDriveFileIds(payload))
        .catch(() => undefined);
    }
  });
  page.on("requestfailed", (request) => {
    const startedAt = starts.get(request);
    if (!startedAt) return;
    records.push({
      method: request.method(),
      status: 0,
      url: request.url(),
      durationMs: Date.now() - startedAt,
    });
  });
  return records;
}

function collectDriveFileIds(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDriveFileIds(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.fileId === "string") state.createdDriveFileIds.push(record.fileId);
  for (const item of Object.values(record)) collectDriveFileIds(item);
}

function criticalNetworkFailures(records: NetworkRecord[]): NetworkRecord[] {
  return records.filter((record) => {
    if (record.status >= 500) return true;
    if (record.status !== 0) return false;
    return record.method !== "GET";
  });
}

function createMediaFixtures(testInfo: TestInfo, stem: string) {
  const dir = testInfo.outputPath("fixtures");
  mkdirSync(dir, { recursive: true });
  const smallName = `qa-${stem}-small.png`;
  const largeName = `qa-${stem}-large.png`;
  const videoName = `qa-${stem}-clip.mp4`;
  const heicName = `qa-${stem}-iphone.heic`;
  const smallPath = path.join(dir, smallName);
  const largePath = path.join(dir, largeName);
  const videoPath = path.join(dir, videoName);
  const heicPath = path.join(dir, heicName);
  writeFileSync(smallPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ));
  execFileSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc2=s=1800x1800",
    "-frames:v", "1",
    "-compression_level", "0",
    largePath,
  ], { stdio: "ignore" });
  writeFileSync(heicPath, Buffer.from(TINY_HEIC_FIXTURE_BASE64, "base64"));
  execFileSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=blue:s=160x90:d=1",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    videoPath,
  ], { stdio: "ignore" });
  return { smallName, largeName, heicName, videoName, smallPath, largePath, heicPath, videoPath };
}

async function readMediaRows(names: string[]): Promise<MediaRow[]> {
  const { data, error } = await admin
    .from("media_assets")
    .select("id, workspace_id, name, file_type, file_id, publish_url, drive_proxy_url, playback_url, playback_storage_key, mime_type, size_bytes")
    .eq("workspace_id", state.workspaceId)
    .in("name", names);
  if (error) throw new Error(error.message);
  return (data || []) as MediaRow[];
}

async function expectMediaRows(names: string[]): Promise<MediaRow[]> {
  await expect.poll(async () => {
    const rows = await readMediaRows(names);
    return new Set(rows.map((row) => row.name)).size;
  }, { timeout: 120_000, message: `media_assets rows for ${names.join(", ")}` }).toBe(names.length);
  const rows = await readMediaRows(names);
  for (const name of names) rowByName(rows, name);
  return rows;
}

async function readPostRow(title: string): Promise<PostRow | null> {
  const { data, error } = await admin
    .from("posts")
    .select("id, workspace_id, title, stage, thumbnail_url, source_vault")
    .eq("workspace_id", state.workspaceId)
    .eq("title", title)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as PostRow | null;
}

async function expectPostRow(title: string): Promise<PostRow> {
  await expect.poll(async () => Boolean(await readPostRow(title)), {
    timeout: 120_000,
    message: `post row ${title}`,
  }).toBe(true);
  const post = await readPostRow(title);
  if (!post) throw new Error(`post missing: ${title}`);
  return post;
}

function rowByName(rows: MediaRow[], name: string): MediaRow {
  const row = rows.find((item) => item.name === name);
  if (!row) throw new Error(`Missing media row ${name}`);
  return row;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

async function renderedPreviewImageForFile(page: Page, fileId: string, size?: "thumb" | "full"): Promise<boolean> {
  return page.evaluate(({ id, expectedSize }) => {
    const images = Array.from(document.images).filter((img) => {
      const src = img.currentSrc || img.src || "";
      return src.includes("/api/media/image-preview") &&
        src.includes(id) &&
        (!expectedSize || src.includes(`size=${expectedSize}`));
    });
    return images.some((img) => {
      const rect = img.getBoundingClientRect();
      return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 && rect.width > 0 && rect.height > 0;
    });
  }, { id: fileId, expectedSize: size });
}

async function loadImageInBrowser(page: Page, url: string) {
  return page.evaluate(async (src) => {
    return new Promise<{ ok: boolean; width?: number; height?: number; reason?: string }>((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 20_000);
      img.onload = () => {
        clearTimeout(timer);
        resolve({ ok: img.naturalWidth > 0 && img.naturalHeight > 0, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, reason: "error" });
      };
      img.src = src;
    });
  }, url);
}

async function loadVideoMetadataInBrowser(page: Page, url: string) {
  return page.evaluate(async (src) => {
    return new Promise<{ ok: boolean; duration?: number; width?: number; height?: number; reason?: string }>((resolve) => {
      const video = document.createElement("video");
      const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 20_000);
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve({ ok: video.videoWidth > 0 && video.videoHeight > 0, duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, reason: "error" });
      };
      video.src = src;
      video.load();
    });
  }, url);
}

async function deleteDriveFiles(fileIds: string[]) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(Buffer.from(requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON"), "base64").toString("utf8")),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const client = await auth.getClient();
  const token = (await client.getAccessToken())?.token;
  if (!token) return;
  const failures: string[] = [];
  await Promise.all([...new Set(fileIds)].map(async (fileId) => {
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) failures.push(`${fileId}:${res.status}`);
    } catch (err) {
      failures.push(`${fileId}:${formatError(err)}`);
    }
  }));
  if (failures.length > 0) {
    throw new Error(`Drive cleanup failed for ${failures.join(", ")}`);
  }
}

function requirePersona(fixture: FixtureState): Persona {
  if (!fixture.persona) throw new Error("QA persona was not seeded");
  return fixture.persona;
}

async function signIn(email: string, password: string): Promise<Session> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${formatError(error)}`);
  return data.session;
}

async function must<T>(query: PromiseLike<{ data: T | null; error: unknown }>, label: string): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${formatError(error)}`);
  return data;
}

function futureDate(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function guardRuntimeTarget() {
  const url = new URL(BASE_URL);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const stagingLike = /(^|\.)((staging|stage|preview|qa|dev)[.-]|vercel\.app$)/i.test(url.hostname);
  const allowProd = process.env.QA_ALLOW_PROD_UPLOADS === "1";
  const supabaseHost = new URL(SUPABASE_URL).hostname;
  const productionSupabaseHosts = new Set(["gxmpmdhmxyfqusdzcemt.supabase.co"]);
  const productionSiteHosts = new Set(["thereach.ten80ten.com"]);

  if (!local && !stagingLike && !allowProd) {
    throw new Error(`Refusing live upload runtime test against ${BASE_URL}. Use localhost/staging or set QA_ALLOW_PROD_UPLOADS=1 for an intentional production QA run.`);
  }
  if ((productionSupabaseHosts.has(supabaseHost) || productionSiteHosts.has(url.hostname)) && !allowProd) {
    throw new Error("Refusing live upload runtime test against production backend/site without QA_ALLOW_PROD_UPLOADS=1.");
  }
}

function redactTokenizedUrl(value: string): string {
  return value
    .replace(/([?&](?:token|access_token|refresh_token|apikey|key)=)[^&#]+/gi, "$1REDACTED")
    .replace(/((?:%3F|%26)(?:token|access_token|refresh_token|apikey|key)%3D)[^%&,\])]+/gi, "$1REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1REDACTED");
}

function redactEvidence(value: unknown): unknown {
  if (typeof value === "string") return redactTokenizedUrl(value);
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactEvidence(item)]),
  );
}

function writeEvidence(testInfo: TestInfo, name: string, value: unknown): void {
  writeFileSync(testInfo.outputPath(name), `${JSON.stringify(redactEvidence(value), null, 2)}\n`);
}

function loadEnv(): Record<string, string> {
  const files = [".env.local"];
  const loaded: Record<string, string> = {};
  for (const file of files) {
    const fullPath = path.join(process.cwd(), file);
    let content = "";
    try {
      content = readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      if (!(key in process.env)) process.env[key] = value;
      loaded[key] = process.env[key] || value;
    }
  }
  return loaded;
}

function requireEnv(key: string): string {
  const value = process.env[key] || env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function formatError(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" | ") || JSON.stringify(record);
  }
  return String(error);
}
