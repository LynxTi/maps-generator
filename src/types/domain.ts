export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_ITEM_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type JobItemStatus = (typeof JOB_ITEM_STATUSES)[number];

export const MAP_STATUSES = ['pending', 'ready', 'failed'] as const;

export type MapStatus = (typeof MAP_STATUSES)[number];

export type MapRequest = {
  lat: number;
  lon: number;
  place?: string;
};

export type MapResponse = {
  id: string;
  url: string;
  lat: number;
  lon: number;
  place: string | null;
  cached: boolean;
  status: MapStatus;
  renderVersion: string;
};

export type MapAcceptResult = MapResponse & {
  created: boolean;
};

export type BatchItemResult =
  | (MapResponse & { ok: true; index: number })
  | {
      ok: false;
      index: number;
      error: {
        code: string;
        message: string;
      };
    };

export type SyncBatchResponse = {
  mode: 'sync';
  total: number;
  created: number;
  cached: number;
  failed: number;
  items: BatchItemResult[];
};

export type AsyncBatchResponse = {
  mode: 'async';
  jobId: string;
  total: number;
  status: JobStatus;
  items: BatchItemResult[];
};

export type JobProgressResponse = {
  id: string;
  status: JobStatus;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type RenderMapInput = {
  lat: number;
  lon: number;
  outputPath: string;
  seedText: string;
};

export type RenderMap = (input: RenderMapInput) => Promise<string>;

export type GetOrCreateMapOptions = {
  ignoreBackpressure?: boolean;
  enqueue?: boolean;
  wait?: boolean;
};

export type CoordinateKey = {
  latKey: string;
  lonKey: string;
};
