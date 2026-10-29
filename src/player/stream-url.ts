/** Builds the archive.org download URL for a catalogue item. */
export function streamUrl(identifier: string, filename: string): string {
  // Filenames can contain slashes for files inside an item's subdirectory,
  // so each path part is encoded separately.
  const path = filename.split('/').map(encodeURIComponent).join('/');
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${path}`;
}

/** The human-facing page for an item, used for credits and guide links. */
export function detailsUrl(identifier: string): string {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}
