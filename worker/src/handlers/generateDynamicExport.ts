import { PoolClient } from 'pg';
import { BaseHandler, JobMeta }            from './baseHandler';
import { insertAuditEvent }                from '../utils/audit';
import { GenerateDynamicExportPayload, QUEUES } from '../types/jobs';
import { env }                             from '../config/env';

// ── DB row types (mirrors db/init.sql) ───────────────────────────────────────

interface EntityRow   { id: string; name: string; config: Record<string, unknown> }
interface FieldRow    { slug: string; name: string; display_order: number }
interface RecordRow   { id: string; data: Record<string, unknown>; record_number: string }

// ── Handler ───────────────────────────────────────────────────────────────────

export class GenerateDynamicExportHandler
  extends BaseHandler<GenerateDynamicExportPayload>
{
  readonly jobName = QUEUES.GENERATE_DYNAMIC_EXPORT;

  protected async execute(
    db:      PoolClient,
    payload: GenerateDynamicExportPayload,
    meta:    JobMeta,
  ): Promise<void> {
    const { tenantId, userId, entitySlug, format, filters, exportJobRecordId } = payload;

    // ── Step 1: Mark the ExportJob record as 'processing' ──────────────────
    // The record was created by the API before enqueuing with status:'pending'.
    await db.query(
      `UPDATE core.records
       SET data       = data || '{"status":"processing"}'::jsonb,
           updated_by = $1,
           version    = version + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [userId, exportJobRecordId],
    );

    // ── Step 2: Resolve entity slug → id + field definitions ───────────────
    const entityResult = await db.query<EntityRow>(
      `SELECT id, name, config
       FROM meta.entities
       WHERE slug = $1`,
      [entitySlug],
    );

    if (entityResult.rowCount === 0) {
      throw new Error(`Entity '${entitySlug}' not found for tenant ${tenantId}`);
    }

    const entity = entityResult.rows[0]!;

    const fieldsResult = await db.query<FieldRow>(
      `SELECT slug, name, display_order
       FROM meta.fields
       WHERE entity_id = $1
       ORDER BY display_order ASC`,
      [entity.id],
    );

    const fields = fieldsResult.rows;
    if (fields.length === 0) {
      throw new Error(`Entity '${entitySlug}' has no defined fields`);
    }

    // ── Step 3: Fetch records (streaming via cursor in production; ──────────
    // paginated fetch here for simplicity on the free tier)
    const records = await db.query<RecordRow>(
      `SELECT id, record_number, data
       FROM core.records
       WHERE entity_id = $1
         AND status    = 'active'
         AND data @> $2::jsonb
       ORDER BY created_at DESC
       LIMIT 10000`,                                       // hard cap for memory safety
      [entity.id, JSON.stringify(filters)],
    );

    const rowCount = records.rowCount ?? 0;

    console.info(
      `[GenerateDynamicExport] entity=${entitySlug} format=${format}` +
      ` rows=${rowCount} job=${meta.jobId}`,
    );

    // ── Step 4: Generate the file (mocked) ───────────────────────────────────
    // In production: stream records to CSV via csv-stringify, or
    // build a PDF via pdfkit/puppeteer, then upload to S3/GCS.
    //
    // This mock simulates I/O latency and returns a pre-signed URL.
    await mockFileGeneration(format, rowCount);

    const downloadUrl =
      `${env.STORAGE_BASE_URL}/${tenantId}/${exportJobRecordId}.${format}`;

    // ── Step 5: Mark export job record as 'completed' ────────────────────────
    const completionData = {
      status:      'completed',
      downloadUrl,
      rowCount,
      completedAt: new Date().toISOString(),
      columns:     fields.map((f) => ({ slug: f.slug, name: f.name })),
    };

    await db.query(
      `UPDATE core.records
       SET data       = data || $1::jsonb,
           updated_by = $2,
           version    = version + 1,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(completionData), userId, exportJobRecordId],
    );

    // ── Step 6: Emit audit event ─────────────────────────────────────────────
    await insertAuditEvent(db, {
      tenantId,
      aggregateType: 'Record',
      aggregateId:   exportJobRecordId,
      action:        'ExportCompleted',
      actorId:       userId,
      delta: {
        before: { status: 'processing' },
        after:  completionData,
      },
      metadata: {
        jobId:      meta.jobId,
        entitySlug,
        format,
        rowCount,
      },
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simulates the CPU/IO cost of file generation.
 * Replace with real implementation: csv-stringify, pdfkit, S3 upload.
 */
async function mockFileGeneration(
  format:   'csv' | 'pdf',
  rowCount: number,
): Promise<void> {
  const estimatedMs = format === 'pdf'
    ? Math.min(rowCount * 2, 5_000)    // PDFs are heavier
    : Math.min(rowCount * 0.1, 1_000); // CSV is fast

  await new Promise<void>((resolve) => setTimeout(resolve, estimatedMs));
}
