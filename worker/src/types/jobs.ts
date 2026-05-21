// ── Base payload (all jobs must carry these two fields) ───────────────────────

export interface BaseJobPayload {
  /** UUID of the tenant — required to set the RLS session variable. */
  tenantId: string;
  /** UUID of the user who triggered the job — written to audit.events. */
  userId: string;
}

// ── Job: generate_dynamic_export ──────────────────────────────────────────────

export interface GenerateDynamicExportPayload extends BaseJobPayload {
  /** Slug of the meta.entity to export (e.g. 'vehicle', 'patient'). */
  entitySlug: string;
  /** Output file format. */
  format: 'csv' | 'pdf';
  /** JSONB containment filter applied to core.records.data. */
  filters: Record<string, unknown>;
  /**
   * ID of the 'ExportJob' record in core.records that tracks this job's state.
   * Created by the API before enqueuing so the client can poll for status.
   */
  exportJobRecordId: string;
}

// ── Job: process_accounting_reversal ─────────────────────────────────────────

export interface ProcessAccountingReversalPayload extends BaseJobPayload {
  /** Primary key of the fin.journal_entries row to be reversed. */
  journalEntryIdToReverse: string;
}

// ── Dead-Letter Queue (DLQ) ───────────────────────────────────────────────────

export interface DlqJobPayload {
  /**
   * pg-boss routes jobs here after all retries are exhausted.
   * The envelope contains the original job's output (error details).
   * We enrich this in the base handler's catch block before rethrowing.
   */
  originalJobId:    string;
  originalJobName:  string;
  tenantId:         string;
  userId:           string;
  errorMessage:     string;
  errorStack?:      string;
  retryCount:       number;
}

// ── Queue names (single source of truth, shared with the API) ─────────────────

export const QUEUES = {
  GENERATE_DYNAMIC_EXPORT:      'generate_dynamic_export',
  PROCESS_ACCOUNTING_REVERSAL:  'process_accounting_reversal',
  DLQ:                          'dlq_failed_jobs',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ── Default send options (used by both producer and consumer for consistency) ─

export const DEFAULT_SEND_OPTIONS = {
  retryLimit:    3,
  retryDelay:    30,    // seconds; with retryBackoff: 30, 60, 120
  retryBackoff:  true,
  expireInHours: 24,
  deadLetter:    QUEUES.DLQ,
} as const;
