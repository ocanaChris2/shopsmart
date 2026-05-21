import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db';
import { findUserWithTenant, recordLoginSuccess, recordLoginFailure } from '../repositories/authRepository';
import { UnauthorizedError, AppError } from '../errors/AppError';

interface LoginBody {
  email:       string;
  password:    string;
  tenant_slug?: string;
}

export async function login(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { email, password, tenant_slug } = request.body;

  const found = await findUserWithTenant(pool, email, tenant_slug);

  // Use a real pre-computed bcrypt hash as the dummy to prevent user-enumeration
  // timing attacks. bcrypt.compare() on an invalid hash returns immediately,
  // making "user not found" measurably faster than "wrong password".
  // This hash is bcrypt('__timing_protection__', 10) — a valid but unusable hash.
  const DUMMY_HASH = '$2a$10$E3MKvGEK9JLxzy5SbgBZAeQSoFXkGmT6cZ4GzKMTH0OPnfN59ZHA.';
  const hashToCompare = found?.user.password_hash ?? DUMMY_HASH;
  const passwordValid  = await bcrypt.compare(password, hashToCompare);

  if (!found || !passwordValid) {
    if (found) {
      // Valid user, wrong password — track failure asynchronously
      recordLoginFailure(pool, found.user.id).catch(() => undefined);
    }
    throw new UnauthorizedError('Invalid email or password');
  }

  const { user, userTenant, tenant } = found;

  if (!user.is_active) {
    throw new UnauthorizedError('Account is deactivated');
  }

  if (user.locked_until && user.locked_until > new Date()) {
    const unlockAt = user.locked_until.toISOString();
    throw new AppError(429, `Account locked until ${unlockAt}`, 'ACCOUNT_LOCKED');
  }

  // Record success (resets failure counter) — fire-and-forget is fine here.
  recordLoginSuccess(pool, user.id).catch(() => undefined);

  const token = await reply.jwtSign({
    sub:       user.id,
    email:     user.email,
    tenant_id: tenant.id,
    role:      userTenant.role,
  });

  reply.status(200).send({
    token,
    expires_in: request.server.jwt.options.sign?.expiresIn ?? '24h',
    user: {
      id:           user.id,
      email:        user.email,
      display_name: user.display_name,
    },
    tenant: {
      id:   tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
    },
  });
}
