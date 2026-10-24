/** Read-only inventory. Filename hints are not verified TMDB metadata. */
export interface QuarkFolder { id: string; name: string; path: string }
export interface QuarkNameHint {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
}
export interface QuarkVideo {
  id: string;
  name: string;
  path: string;
  size: number | null;
  checkUrl: string | null;
  hint: QuarkNameHint;
}
export interface QuarkInventory {
  folder: QuarkFolder;
  recursive: boolean;
  scannedAt: string;
  directories: number;
  videos: QuarkVideo[];
}
export interface QuarkStatus {
  toolPath: string | null;
  folder: QuarkFolder | null;
  recursive: boolean;
  autoRead: boolean;
  busy: boolean;
  error: string | null;
  notices: string[];
  inventory: QuarkInventory | null;
}
export interface QuarkBrowse { folders: QuarkFolder[]; notices: string[] }
