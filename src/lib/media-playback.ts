import { supabase } from "@/lib/supabaseClient";
import { normalizeDriveMimeType } from "@/lib/drive-policy";

export interface PlaybackUploadResult {
  playbackUrl: string;
  playbackStorageKey: string;
  mimeType: string;
  size: number;
}

interface PlaybackUploadTarget {
  bucket: string;
  storageKey: string;
  token: string;
  publicUrl: string;
  mimeType: string;
  size: number;
}

async function getAccessTokenFromCurrentSession(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

async function getPlaybackUploadTarget(file: File, cardId?: string): Promise<PlaybackUploadTarget> {
  const accessToken = await getAccessTokenFromCurrentSession();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch("/api/media/playback-upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: normalizeDriveMimeType(file.type, file.name),
      fileSize: file.size,
      cardId,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Playback upload target failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  const data = await res.json() as Partial<PlaybackUploadTarget> & { error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.bucket || !data.storageKey || !data.token || !data.publicUrl) {
    throw new Error("Playback upload target response was incomplete");
  }

  return data as PlaybackUploadTarget;
}

export async function uploadVideoPlaybackCopy(file: File, cardId?: string): Promise<PlaybackUploadResult> {
  const mimeType = normalizeDriveMimeType(file.type, file.name);
  if (!mimeType.startsWith("video/")) {
    throw new Error("Playback copy is only supported for videos");
  }

  const target = await getPlaybackUploadTarget(file, cardId);
  const { error } = await supabase.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.storageKey, target.token, file, {
      contentType: target.mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Playback upload failed: ${error.message}`);
  }

  return {
    playbackUrl: target.publicUrl,
    playbackStorageKey: target.storageKey,
    mimeType: target.mimeType,
    size: target.size,
  };
}
