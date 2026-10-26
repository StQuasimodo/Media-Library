import type { MediaType, MetadataSearchResult } from './types';
import type { QuarkFolder } from './quark';
import type { QuarkResourceInfo } from './quarkResource';

export interface QuarkSyncSource {
  folder: QuarkFolder | null;
  autoRead: boolean;
  autoImport: boolean;
  lastScanAt: string | null;
}
export interface QuarkMatchQuery { title: string; year: number | null; mediaType: MediaType | 'all' }
export interface QuarkMatchCandidate extends MetadataSearchResult { confidence: 'high' | 'review' }
export interface QuarkSyncGroup {
  key: string;
  season: number | null;
  query: QuarkMatchQuery;
  files: number;
  examples: string[];
  formats: string[];
  state: 'pending' | 'review' | 'linked' | 'ignored' | 'error';
  candidates: QuarkMatchCandidate[];
  film: { id: string; title: string } | null;
  error: string | null;
}
export interface QuarkSyncStatus {
  source: QuarkSyncSource;
  busy: boolean;
  phase: 'idle' | 'reading' | 'matching' | 'importing';
  progress: string;
  error: string | null;
  groups: QuarkSyncGroup[];
  videos: number;
}
export interface QuarkCloudResource {
  id: string;
  filmId: string;
  fileId: string;
  name: string;
  path: string;
  size: number | null;
  technical: QuarkResourceInfo;
  season: number | null;
  episode: number | null;
  present: boolean;
  lastSeenAt: string;
  active: boolean;
}
