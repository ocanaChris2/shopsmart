import { Pool, PoolClient } from 'pg';
import { UserRow, UserTenantRow, TenantRow } from '../types';

// Auth queries bypass the tenant-scoped client because the user has not yet
// been authenticated. They operate directly on the pool using public.users
// and public.user_tenants, which have no RLS.

export interface UserWithFirstTenant {
  user: UserRow;
  userTenant: UserTenantRow;
  tenant: TenantRow;
}

/**
 * Find a user and their membership in a specific tenant (by slug), or their
 * first active tenant if no slug is provided.
 */
export async function findUserWithTenant(
  pool: Pool,
  email: string,
  tenantSlug?: string,
): Promise<UserWithFirstTenant | null> {
  const client = await pool.connect();
  try {
    // Single query join: no need for multiple round trips.
    const result = await client.query<
      UserRow & UserTenantRow & TenantRow & {
        ut_id: string; ut_role: string; ut_is_active: boolean; ut_joined_at: Date;
        t_id: string; t_name: string; t_slug: string; t_plan: string;
        t_locale: string; t_timezone: string; t_config: Record<string, unknown>;
        t_is_active: boolean;
      }
    >(
      `SELECT
         u.id,           u.email,       u.display_name, u.avatar_url,
         u.password_hash, u.is_active,  u.last_login_at,
         u.failed_login_count, u.locked_until,
         ut.id           AS ut_id,
         ut.role         AS ut_role,
         ut.is_active    AS ut_is_active,
         ut.joined_at    AS ut_joined_at,
         t.id            AS t_id,
         t.name          AS t_name,
         t.slug          AS t_slug,
         t.plan          AS t_plan,
         t.locale        AS t_locale,
         t.timezone      AS t_timezone,
         t.config        AS t_config,
         t.is_active     AS t_is_active
       FROM public.users u
       JOIN public.user_tenants ut ON ut.user_id = u.id AND ut.is_active = TRUE
       JOIN public.tenants      t  ON t.id = ut.tenant_id AND t.is_active = TRUE
       WHERE u.email = $1
         AND ($2::TEXT IS NULL OR t.slug = $2)
       ORDER BY ut.joined_at ASC
       LIMIT 1`,
      [email, tenantSlug ?? null],
    );

    if (!result.rows[0]) return null;

    const row = result.rows[0];

    return {
      user: {
        id: row.id, email: row.email, display_name: row.display_name,
        avatar_url: row.avatar_url, password_hash: row.password_hash,
        is_active: row.is_active, last_login_at: row.last_login_at,
        failed_login_count: row.failed_login_count, locked_until: row.locked_until,
        created_at: row.created_at, updated_at: row.updated_at,
      },
      userTenant: {
        id: row.ut_id, user_id: row.id, tenant_id: row.t_id,
        role: row.ut_role as UserWithFirstTenant['userTenant']['role'],
        is_active: row.ut_is_active, joined_at: row.ut_joined_at,
      },
      tenant: {
        id: row.t_id, name: row.t_name, slug: row.t_slug, plan: row.t_plan,
        locale: row.t_locale, timezone: row.t_timezone, config: row.t_config,
        is_active: row.t_is_active, created_at: row.created_at, updated_at: row.updated_at,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Record a successful login: reset failure counter, update last_login_at.
 */
export async function recordLoginSuccess(
  pool: Pool,
  userId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE public.users
       SET failed_login_count = 0, last_login_at = NOW(), locked_until = NULL
       WHERE id = $1`,
      [userId],
    );
  } finally {
    client.release();
  }
}

/**
 * Increment failure counter; lock account after 5 consecutive failures (15 min).
 */
export async function recordLoginFailure(
  pool: Pool,
  userId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE public.users
       SET failed_login_count = failed_login_count + 1,
           locked_until = CASE
             WHEN failed_login_count + 1 >= 5
             THEN NOW() + INTERVAL '15 minutes'
             ELSE locked_until
           END
       WHERE id = $1`,
      [userId],
    );
  } finally {
    client.release();
  }
}

/**
 * Check account lock status using a raw pool client (no RLS needed).
 */
export async function findUserById(
  db: PoolClient,
  userId: string,
): Promise<Pick<UserRow, 'id' | 'is_active' | 'locked_until'> | null> {
  const result = await db.query<Pick<UserRow, 'id' | 'is_active' | 'locked_until'>>(
    `SELECT id, is_active, locked_until FROM public.users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}
