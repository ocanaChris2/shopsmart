import { PoolClient } from 'pg';
import { JWTPayload } from './index';

// Augment Fastify's request interface so every handler knows about our custom
// properties without using `any` casts everywhere.
declare module 'fastify' {
  interface FastifyRequest {
    // Set by rlsTransaction middleware inside the protected /api/v1 scope.
    // Guaranteed non-null for any route that runs behind that middleware.
    db:       PoolClient | null;
    tenantId: string;
    userId:   string;
  }
}

// Teach @fastify/jwt about our payload shape so request.user is fully typed.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: JWTPayload;
  }
}
