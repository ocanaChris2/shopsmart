import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

// =============================================================================
//  RLS Transaction Middleware — Supabase Session Pooler Safety Proof
// =============================================================================
//
//  Problem: We use PgBouncer (via Supabase's Session Pooler) to share physical
//  Postgres connections across many Node.js clients. In a naive implementation,
//  a leaked session variable (SET app.current_tenant_id) could bleed into a
//  subsequent request on the same pooled connection, creating a data-leakage
//  security hole.
//
//  Solution: SET LOCAL (not SET or SET SESSION).
//
//  PostgreSQL's three scopes:
//    SET <var> = val           → session scope  (persists until connection ends)
//    SET SESSION <var> = val   → session scope  (same as above; explicit)
//    SET LOCAL <var> = val     → transaction scope (auto-cleared on COMMIT/ROLLBACK)
//
//  Our lifecycle (per HTTP request):
//
//    ① pool.connect()
//         → physical connection leased from PgBouncer session pool
//    ② BEGIN
//         → transaction opened
//    ③ SET LOCAL app.current_tenant_id = '<uuid>'
//         → variable is active ONLY within this transaction
//    ④ [handler executes SQL — all RLS-protected tables filter by the variable]
//    ⑤ COMMIT or ROLLBACK
//         → transaction ends → SET LOCAL variable is automatically cleared
//         → PostgreSQL resets to the pre-transaction value (NULL / empty)
//    ⑥ client.release()
//         → physical connection returned to PgBouncer pool
//         → next borrower sees NO tenant context
//
//  This is safe even in PgBouncer Session Mode because the variable lifetime
//  is bound to the transaction, not the session. A leaked SET LOCAL is
//  structurally impossible: the variable vanishes when the transaction ends,
//  before the connection is released.
//
//  NEVER use SET or SET SESSION here — those persist for the connection's
//  lifetime and WOULD leak across pooled connections.
//
// =============================================================================

// ── Hook: acquire client, open transaction, set RLS variable ─────────────────
// Runs as a `preHandler` hook AFTER authenticate, so request.user is available.
export async function rlsPreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const { sub, tenant_id } = request.user;

  const client = await pool.connect();
  try {
    // ① Open transaction
    await client.query('BEGIN');

    // ② Scope the tenant ID to this transaction using SET LOCAL.
    //    This is the ONLY correct variant to use with a connection pooler.
    //    See the safety analysis in the module header above.
    await client.query('SET LOCAL app.current_tenant_id = $1', [tenant_id]);

    request.db       = client;
    request.tenantId = tenant_id;
    request.userId   = sub;
  } catch (err) {
    // If setup fails, release the connection immediately — don't leave it
    // hanging in a half-initialised state in the pool.
    client.release();
    throw err;
  }
}

// ── Hook: commit or rollback before the response bytes are flushed ────────────
// MUST return the payload unchanged; Fastify will error if it returns nothing.
export async function rlsOnSend(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (!request.db) return payload;

  try {
    if (reply.statusCode < 400) {
      await request.db.query('COMMIT');
      // After COMMIT: SET LOCAL is cleared. The connection is clean.
    } else {
      await request.db.query('ROLLBACK');
      // After ROLLBACK: SET LOCAL is also cleared. Always safe.
    }
  } catch (commitErr) {
    request.log.error({ err: commitErr }, 'Transaction finalization failed');
    await request.db.query('ROLLBACK').catch(() => undefined);
  }

  return payload;
}

// ── Hook: release the pg client back to the pool ──────────────────────────────
// Safety net ROLLBACK ensures the connection is clean even if onSend was skipped.
export async function rlsOnResponse(request: FastifyRequest): Promise<void> {
  if (!request.db) return;
  await request.db.query('ROLLBACK').catch(() => undefined);
  request.db.release();
  request.db = null;
}

// ── Hook: clean up if the HTTP client disconnects mid-flight ─────────────────
export async function rlsOnRequestAbort(request: FastifyRequest): Promise<void> {
  if (!request.db) return;
  await request.db.query('ROLLBACK').catch(() => undefined);
  request.db.release();
  request.db = null;
}
