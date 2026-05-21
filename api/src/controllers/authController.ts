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

  // Use a constant-time comparison even on "not found" to prevent timing attacks.
  const dummyHash = '$2b$10$invalidhashfortimingprotectionXXXXXXXXXXXXXXXXXXXXXX';
  const hashToCompare = found?.user.password_hash ?? dummyHash;
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
