import type { RequestRecord } from '../../types';

export type ActivityKind = 'download' | 'request';

export type ActivityVisualStatus =
  | 'queued'
  | 'resolving'
  | 'locating'
  | 'downloading'
  | 'complete'
  | 'error'
  | 'cancelled'
  | 'pending'
  | 'fulfilled'
  | 'rejected';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  visualStatus: ActivityVisualStatus;

  title: string;
  author: string;
  preview?: string;

  metaLine: string;

  statusLabel: string;
  statusDetail?: string;
  adminNote?: string;

  progress?: number;
  progressAnimated?: boolean;
  sizeRaw?: string;
  downloads?: number;

  timestamp: number;
  username?: string;

  downloadBookId?: string;
  downloadRetryAvailable?: boolean;
  downloadPath?: string;
  bookKey?: string; // The metadata book it was downloaded for ("hardcover:42")
  contentType?: string;
  infoUrl?: string; // The release's page at its source (the MAM torrent page)
  requestId?: number;
  requestLevel?: 'book' | 'release';
  requestNote?: string;
  requestRecord?: RequestRecord;
}
