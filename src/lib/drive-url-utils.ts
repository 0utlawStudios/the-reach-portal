export function getPublicDriveDownloadUrl(fileId: string): string {
  const params = new URLSearchParams({ export: "download", id: fileId });
  return `https://drive.google.com/uc?${params.toString()}`;
}
