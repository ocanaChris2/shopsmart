import { PoolClient } from 'pg';
import { BaseHandler, JobMeta }                    from './baseHandler';
import { insertAuditEvent }                        from '../utils/audit';
import { ProcessAccountingReversalPayload, QUEUES } from '../types/jobs';

// ── DB row types (mirrors db/init.sql) ───────────────────────────────────────

interface JournalEntryRow {
  id:           string;
  tenant_id:    string;
  entry_number: string;
  source_type:  string;
  description:  string;
  entry_date:   Date;
  status:       string;
  is_reversal:  boolean;
  reversed_by:  string | null;
  reversal_of:  string | null;
}

interface JournalEntryLineRow {
  id:         string;
  account_id: string;
  debit:      string;   // pg returns NUMERIC as string
  credit:     string;
  description: string | null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export class ProcessAccountingReversalHandler
  extends BaseHandler<ProcessAccountingReversalPayload>
{
  readonly jobName = QUEUES.PROCESS_ACCOUNTING_REVERSAL;

  protected async execute(
    db:      PoolClient,
    payload: ProcessAccountingReversalPayload,
    meta:    JobMeta,
  ): Promise<void> {
    const { tenantId, userId, journalEntryIdToReverse } = payload;

    // ── Step 1: Fetch and lock the original journal entry ───────────────────
    // FOR UPDATE prevents a concurrent reversal of the same entry.
    const entryResult = await db.query<JournalEntryRow>(
      `SELECT id, tenant_id, entry_number, source_type, description,
              entry_date, status, is_reversal, reversed_by, reversal_of
       FROM fin.journal_entries
       WHERE id = $1
       FOR UPDATE`,
      [journalEntryIdToReverse],
    );

    if (entryResult.rowCount === 0) {
      throw new Error(
        `Journal entry ${journalEntryIdToReverse} not found ` +
        `(may belong to a different tenant — RLS active)`,
      );
    }

    const original = entryResult.rows[0]!;

    // ── Step 2: Validate business rules ─────────────────────────────────────

    if (original.status !== 'posted') {
      throw new Error(
        `Journal entry ${journalEntryIdToReverse} cannot be reversed: ` +
        `status is '${original.status}', expected 'posted'`,
      );
    }

    if (original.reversed_by !== null) {
      throw new Error(
        `Journal entry ${journalEntryIdToReverse} has already been reversed ` +
        `by entry ${original.reversed_by}`,
      );
    }

    // Prevent reversing a reversal (infinite reversal chain prevention).
    if (original.is_reversal) {
      throw new Error(
        `Journal entry ${journalEntryIdToReverse} is itself a reversal entry ` +
        `and cannot be reversed again`,
      );
    }

    // ── Step 3: Fetch the original lines ────────────────────────────────────
    const linesResult = await db.query<JournalEntryLineRow>(
      `SELECT id, account_id, debit, credit, description
       FROM fin.journal_entry_lines
       WHERE journal_entry_id = $1`,
      [journalEntryIdToReverse],
    );

    if (linesResult.rowCount === 0) {
      throw new Error(
        `Journal entry ${journalEntryIdToReverse} has no lines — data integrity issue`,
      );
    }

    const lines = linesResult.rows;

    // ── Step 4: Insert the reversal journal entry header ─────────────────────
    // entry_number = 'REV-' + original.entry_number.
    // Uniqueness is guaranteed because we checked reversed_by IS NULL above —
    // this can only ever produce one reversal per original entry.
    const reversalEntryResult = await db.query<{ id: string }>(
      `INSERT INTO fin.journal_entries
         (tenant_id, entry_number, source_type, source_id,
          description, entry_date, is_reversal, reversal_of,
          status, created_by)
       VALUES
         ($1, $2, 'REVERSAL', $3,
          $4, CURRENT_DATE, TRUE, $5,
          'posted', $6)
       RETURNING id`,
      [
        tenantId,
        `REV-${original.entry_number}`,
        original.id,
        `Reversal of: ${original.description}`,
        original.id,
        userId,
      ],
    );

    const reversalEntryId = reversalEntryResult.rows[0]!.id;

    // ── Step 5: Insert reversed lines (flip debits ↔ credits) ───────────────
    // The DEFERRABLE INITIALLY DEFERRED balance constraint fires at COMMIT,
    // so we can insert all lines before the check runs.
    // Original: Debit $100 Cash → Reversal: Credit $100 Cash  (and vice-versa)
    for (const line of lines) {
      await db.query(
        `INSERT INTO fin.journal_entry_lines
           (tenant_id, journal_entry_id, account_id,
            debit, credit, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenantId,
          reversalEntryId,
          line.account_id,
          line.credit,           // original credit becomes debit
          line.debit,            // original debit  becomes credit
          `Reversal: ${line.description ?? ''}`.trim(),
        ],
      );
    }

    // ── Step 6: Mark the original entry as reversed ──────────────────────────
    // Our DB trigger (guard_journal_entry_immutability) explicitly allows the
    // status transition posted → reversed and permits setting reversed_by.
    await db.query(
      `UPDATE fin.journal_entries
       SET status      = 'reversed',
           reversed_by = $1
       WHERE id = $2`,
      [reversalEntryId, journalEntryIdToReverse],
    );

    // ── Step 7: Emit audit event ─────────────────────────────────────────────
    await insertAuditEvent(db, {
      tenantId,
      aggregateType: 'JournalEntry',
      aggregateId:   journalEntryIdToReverse,
      action:        'JournalEntryReversed',
      actorId:       userId,
      delta: {
        before: { status: 'posted', reversed_by: null },
        after:  { status: 'reversed', reversed_by: reversalEntryId },
      },
      metadata: {
        jobId:            meta.jobId,
        reversalEntryId,
        originalEntryNumber: original.entry_number,
        lineCount:        lines.length,
      },
    });

    console.info(
      `[ProcessAccountingReversal] ` +
      `original=${journalEntryIdToReverse} ` +
      `reversal=${reversalEntryId} ` +
      `lines=${lines.length} ` +
      `tenant=${tenantId}`,
    );
  }
}
