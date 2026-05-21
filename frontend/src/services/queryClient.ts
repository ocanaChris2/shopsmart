import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dynamic data (records): considered fresh for 30 seconds.
      staleTime:            30_000,
      // Items are garbage-collected 5 minutes after unmounting.
      gcTime:               5 * 60_000,
      // Retry once on failure with a 2-second delay.
      retry:                1,
      retryDelay:           2_000,
      // Don't refetch on window focus — users expect data to stay stable.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// ── Query key factories ───────────────────────────────────────────────────────
// Centralised so every component uses consistent, cache-busting key shapes.

export const queryKeys = {
  entities:       ()                      => ['entities']                           as const,
  entitySchema:   (slug: string)          => ['schema', slug]                       as const,
  records:        (slug: string, params?: object) => ['records', slug, params ?? {}] as const,
  record:         (slug: string, id: string)      => ['record', slug, id]            as const,
} as const;

// ── Stale-time overrides ──────────────────────────────────────────────────────
// Metadata changes rarely (admin-driven) so we cache it aggressively to match
// the Cloudflare edge cache TTL (4 hours). This means a cached schema at the
// edge AND in the browser never requires a network round-trip for 4 hours.

export const SCHEMA_STALE_TIME = 4 * 60 * 60_000;   // 4 hours
export const SCHEMA_GC_TIME    = 8 * 60 * 60_000;   // 8 hours
