import Fastify, { FastifyInstance } from 'fastify';
import fastifyHelmet      from '@fastify/helmet';
import fastifyJwt         from '@fastify/jwt';
import fastifyRateLimit   from '@fastify/rate-limit';
import { env }            from './config/env';
import { registerRoutes } from './routes';
import { AppError, ValidationError } from './errors/AppError';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level:     env.LOG_LEVEL,
      // Render streams logs as JSON; structured logging plays well with their console.
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    // Fastify generates a unique ID per request — visible in audit.events.metadata.
    genReqId: (req) =>
      (req.headers['x-request-id'] as string | undefined) ??
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    trustProxy: true, // required to read X-Forwarded-For on Render
  });

  // ── Decorate request BEFORE any plugin/route registers ────────────────────
  // Must be at root level so all scopes (including protected) can read these.
  app.decorateRequest('db',       null);
  app.decorateRequest('tenantId', '');
  app.decorateRequest('userId',   '');

  // ── Security headers ──────────────────────────────────────────────────────
  // Helmet sets X-Content-Type-Options, X-Frame-Options, HSTS, etc.
  // HSTS tells browsers to only contact this host over HTTPS for 1 year.
  await app.register(fastifyHelmet, {
    hsts: {
      maxAge:            31_536_000,  // 1 year in seconds
      includeSubDomains: true,
      preload:           true,
    },
    // This is a pure JSON API; no HTML/scripts/images served.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // not relevant for JSON APIs
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // Global default: 100 req/min per IP. Auth routes override this to 10 req/min.
  // In-memory store is fine for a single Render free-tier instance.
  await app.register(fastifyRateLimit, {
    global:     true,
    max:        env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    // Prefer X-Forwarded-For (set by Render's proxy) over socket IP.
    keyGenerator: (req) => {
      const fwd = req.headers['x-forwarded-for'];
      return Array.isArray(fwd) ? fwd[0]! : (fwd ?? req.ip);
    },
    errorResponseBuilder: () => ({
      error: {
        statusCode: 429,
        message:    'Too many requests. Please slow down.',
        code:       'RATE_LIMITED',
      },
    }),
  });

  // ── JWT ───────────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign:   { expiresIn: env.JWT_EXPIRES_IN },
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await registerRoutes(app);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      error: {
        statusCode: 404,
        message:    'Route not found',
        code:       'NOT_FOUND',
      },
    });
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    const isAppError = error instanceof AppError;

    // Never surface raw 500 internals to the client.
    const statusCode = error.statusCode ?? 500;
    const clientMessage =
      statusCode === 500 && !isAppError
        ? 'Internal Server Error'
        : error.message;

    request.log.error(
      { err: error, requestId: request.id },
      `[${statusCode}] ${error.message}`,
    );

    const body: Record<string, unknown> = {
      error: {
        statusCode,
        message: clientMessage,
        code:    isAppError ? (error as AppError).code : 'INTERNAL_ERROR',
      },
    };

    // Attach Zod issues for validation errors so the client knows what to fix.
    if (error instanceof ValidationError && error.issues) {
      (body.error as Record<string, unknown>).issues = error.issues;
    }

    // Fastify validation errors (from route schemas) produce a 400 with .validation
    if ((error as { validation?: unknown }).validation) {
      body.error = {
        statusCode: 400,
        message:    'Request validation failed',
        code:       'SCHEMA_VALIDATION_ERROR',
        issues:     (error as { validation?: unknown }).validation,
      };
      reply.status(400).send(body);
      return;
    }

    reply.status(statusCode).send(body);
  });

  return app;
}
