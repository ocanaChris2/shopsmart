import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { login } from '../controllers/authController';
import { env }   from '../config/env';

const loginBodySchema = z.object({
  email:       z.string().email(),
  password:    z.string().min(8),
  tenant_slug: z.string().optional(),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: z.infer<typeof loginBodySchema> }>(
    '/login',
    {
      config: {
        rateLimit: {
          max:        env.AUTH_RATE_LIMIT_MAX,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email:       { type: 'string', format: 'email' },
            password:    { type: 'string', minLength: 8 },
            tenant_slug: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              token:      { type: 'string' },
              expires_in: {},
              user: {
                type: 'object',
                properties: {
                  id:           { type: 'string' },
                  email:        { type: 'string' },
                  display_name: { type: 'string' },
                },
              },
              tenant: {
                type: 'object',
                properties: {
                  id:   { type: 'string' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  plan: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    login,
  );
}
