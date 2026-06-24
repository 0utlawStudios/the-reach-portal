export function aiAssetProxyUrl(storageKey: string): string {
  return `/api/ai/asset?key=${encodeURIComponent(storageKey)}`;
}

export function aiAssetProxyUrls(storageKeys: ReadonlyArray<string> | null | undefined): string[] {
  return (storageKeys || []).filter(Boolean).map(aiAssetProxyUrl);
}
