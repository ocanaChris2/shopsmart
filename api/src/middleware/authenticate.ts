import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../errors/AppError';

/**
 * Hook: verifies the Bearer JWT on every request.
 * On success, @fastify/jwt populates request.user with the decoded payload.
 * Registered as an `onRequest` hook inside the protected /api/v1 scope.
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}
