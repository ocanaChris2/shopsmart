import { FastifyInstance } from 'fastify';
import { list, findOne, create, update } from '../controllers/dataController';

// Reusable Fastify JSON schema for a single record response.
// Explicit serialization schema prevents leaking unexpected DB columns and
// gives Fastify's fast-json-stringify a type map for maximum throughput.
const recordResponseSchema = {
  type: 'object',
  properties: {
    id:            { type: 'string' },
    tenant_id:     { type: 'string' },
    entity_id:     { type: 'string' },
    record_number: { type: 'string' },
    data:          { type: 'object', additionalProperties: true },
    status:        { type: 'string' },
    created_by:    { type: 'string' },
    updated_by:    { type: ['string', 'null'] },
    created_at:    { type: 'string' },
    updated_at:    { type: 'string' },
    version:       { type: 'integer' },
  },
};

export async function dataRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/v1/data/:entitySlug ─────────────────────────────────────────
  fastify.get<{
    Params:      { entitySlug: string };
    Querystring: { page?: number; limit?: number; status?: string; filter?: string };
  }>(
    '/:entitySlug',
    {
      schema: {
        params: {
          type: 'object',
          required: ['entitySlug'],
          properties: { entitySlug: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          properties: {
            page:   { type: 'integer', minimum: 1, default: 1 },
            limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            status: { type: 'string' },
            filter: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: { type: 'array', items: recordResponseSchema },
              meta: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  page:  { type: 'integer' },
                  limit: { type: 'integer' },
                  pages: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    list,
  );

  // ── GET /api/v1/data/:entitySlug/:id ─────────────────────────────────────
  fastify.get<{ Params: { entitySlug: string; id: string } }>(
    '/:entitySlug/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['entitySlug', 'id'],
          properties: {
            entitySlug: { type: 'string' },
            id:         { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: recordResponseSchema },
      },
    },
    findOne,
  );

  // ── POST /api/v1/data/:entitySlug ────────────────────────────────────────
  fastify.post<{
    Params: { entitySlug: string };
    Body:   { data: Record<string, unknown> };
  }>(
    '/:entitySlug',
    {
      schema: {
        params: {
          type: 'object',
          required: ['entitySlug'],
          properties: { entitySlug: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { type: 'object', additionalProperties: true },
          },
        },
        response: { 201: recordResponseSchema },
      },
    },
    create,
  );

  // ── PATCH /api/v1/data/:entitySlug/:id ───────────────────────────────────
  fastify.patch<{
    Params: { entitySlug: string; id: string };
    Body:   { data: Record<string, unknown>; version: number };
  }>(
    '/:entitySlug/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['entitySlug', 'id'],
          properties: {
            entitySlug: { type: 'string' },
            id:         { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['data', 'version'],
          properties: {
            data:    { type: 'object', additionalProperties: true },
            version: { type: 'integer', minimum: 1 },
          },
        },
        response: { 200: recordResponseSchema },
      },
    },
    update,
  );
}
