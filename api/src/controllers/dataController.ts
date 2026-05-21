import { FastifyRequest, FastifyReply } from 'fastify';
import { validatePayload }          from '../services/dynamicValidation';
import { nextRecordNumber }         from '../services/recordNumber';
import {
  listRecords,
  findRecordById,
  insertRecord,
  updateRecord,
  insertAuditEvent,
} from '../repositories/dataRepository';
import {
  NotFoundError,
  ConflictError,
  AppError,
} from '../errors/AppError';
import { AuditDelta, AuditMetadata } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMetadata(request: FastifyRequest): AuditMetadata {
  const fwd = request.headers['x-forwarded-for'];
  return {
    ip:         Array.isArray(fwd) ? fwd[0] : (fwd ?? request.ip),
    user_agent: request.headers['user-agent'],
    request_id: request.id,
  };
}

/** Compute a minimal delta that only captures changed fields. */
function computeDelta(
  oldData: Record<string, unknown>,
  patch:   Record<string, unknown>,
): AuditDelta {
  const before: Record<string, unknown> = {};
  const after:  Record<string, unknown> = {};

  for (const key of Object.keys(patch)) {
    if (JSON.stringify(oldData[key]) !== JSON.stringify(patch[key])) {
      before[key] = oldData[key];
      after[key]  = patch[key];
    }
  }

  return { before, after };
}

// ── Route params / body types ─────────────────────────────────────────────────

interface EntityParams { entitySlug: string }
interface RecordParams  { entitySlug: string; id: string }

interface ListQuery {
  page?:   number;
  limit?:  number;
  status?: string;
  filter?: string; // JSON string
}

interface CreateBody { data: Record<string, unknown> }
interface UpdateBody { data: Record<string, unknown>; version: number }

// ── Controllers ───────────────────────────────────────────────────────────────

export async function list(
  request: FastifyRequest<{ Params: EntityParams; Querystring: ListQuery }>,
  reply:   FastifyReply,
): Promise<void> {
  const db         = request.db!;
  const { entitySlug } = request.params;
  const page   = Math.max(1, request.query.page  ?? 1);
  const limit  = Math.min(100, Math.max(1, request.query.limit ?? 20));

  // Resolve entity slug to id under RLS (returns null if tenant doesn't own it)
  const { entity } = await validatePayload(db, request.tenantId, entitySlug, {}, false);

  let filter: Record<string, unknown> | undefined;
  if (request.query.filter) {
    try {
      filter = JSON.parse(request.query.filter) as Record<string, unknown>;
    } catch {
      throw new AppError(400, 'Invalid filter: must be a JSON object', 'INVALID_FILTER');
    }
  }

  const { rows, total } = await listRecords(db, entity.id, {
    page,
    limit,
    status: request.query.status,
    filter,
  });

  reply.status(200).send({
    data: rows,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}

export async function findOne(
  request: FastifyRequest<{ Params: RecordParams }>,
  reply:   FastifyReply,
): Promise<void> {
  const db  = request.db!;
  const { id } = request.params;

  const record = await findRecordById(db, id);
  if (!record) throw new NotFoundError('Record');

  reply.status(200).send(record);
}

export async function create(
  request: FastifyRequest<{ Params: EntityParams; Body: CreateBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const db = request.db!;

  // Dynamic validation: strips unknown keys, enforces required fields.
  const { entity, validatedData } = await validatePayload(
    db,
    request.tenantId,
    request.params.entitySlug,
    request.body.data,
    true, // requireAllFields = true for POST
  );

  const prefix = (entity.config.record_number_prefix as string | undefined)
    ?? entity.slug.toUpperCase().slice(0, 4);

  const recordNumber = await nextRecordNumber(
    db, request.tenantId, entity.id, prefix,
  );

  const record = await insertRecord(
    db,
    request.tenantId,
    entity.id,
    recordNumber,
    validatedData,
    request.userId,
  );

  await insertAuditEvent(db, {
    tenant_id:      request.tenantId,
    aggregate_type: 'Record',
    aggregate_id:   record.id,
    action:         'RecordCreated',
    actor_id:       request.userId,
    delta:          { after: validatedData },
    metadata:       buildMetadata(request),
  });

  reply.status(201).send(record);
}

export async function update(
  request: FastifyRequest<{ Params: RecordParams; Body: UpdateBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const db = request.db!;
  const { id } = request.params;

  // Validate the partial patch (requireAllFields = false for PATCH)
  const { entity, validatedData } = await validatePayload(
    db,
    request.tenantId,
    request.params.entitySlug,
    request.body.data,
    false,
  );

  // Silence "entity unused" — we resolve it to verify the slug is valid for this tenant.
  void entity;

  if (Object.keys(validatedData).length === 0) {
    throw new AppError(400, 'Patch body must contain at least one field', 'EMPTY_PATCH');
  }

  const result = await updateRecord(
    db,
    id,
    validatedData,
    request.userId,
    request.body.version,
  );

  if (!result) {
    // Distinguish 404 vs 409: check if the record exists at all.
    const exists = await findRecordById(db, id);
    if (!exists) throw new NotFoundError('Record');
    throw new ConflictError(
      'Version conflict: the record was modified by another request. ' +
      'Refresh and retry.',
    );
  }

  const delta = computeDelta(result.oldData, validatedData);

  await insertAuditEvent(db, {
    tenant_id:      request.tenantId,
    aggregate_type: 'Record',
    aggregate_id:   id,
    action:         'RecordUpdated',
    actor_id:       request.userId,
    delta,
    metadata:       buildMetadata(request),
  });

  reply.status(200).send(result.record);
}
