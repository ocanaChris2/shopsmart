import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient }    from '@/services/apiClient';
import { queryKeys, SCHEMA_STALE_TIME, SCHEMA_GC_TIME } from '@/services/queryClient';
import type { EntitySchema, EntityDefinition } from '../types';

// ── Single entity schema (entity + fields) ────────────────────────────────────

/**
 * Fetches and caches the field definitions for a given entity slug.
 *
 * Cache strategy: staleTime = 4 hours (matches Cloudflare edge cache TTL).
 * Effect: React Query will NEVER make a network request for a schema it already
 * has until 4 hours pass, even after tab switches or component remounts.
 * This means cold page loads after the first fetch cost 0 API calls for schema.
 */
export function useEntitySchema(entitySlug: string): UseQueryResult<EntitySchema> {
  return useQuery<EntitySchema>({
    queryKey:  queryKeys.entitySchema(entitySlug),
    queryFn:   () =>
      apiClient
        .get<EntitySchema>(`/api/v1/meta/entities/${entitySlug}/fields`)
        .then((r) => r.data),
    enabled:   !!entitySlug,
    staleTime: SCHEMA_STALE_TIME,
    gcTime:    SCHEMA_GC_TIME,
  });
}

// ── List of all entities (for sidebar navigation) ─────────────────────────────

export function useEntityList(): UseQueryResult<{ entities: EntityDefinition[] }> {
  return useQuery<{ entities: EntityDefinition[] }>({
    queryKey:  queryKeys.entities(),
    queryFn:   () =>
      apiClient
        .get<{ entities: EntityDefinition[] }>('/api/v1/meta/entities')
        .then((r) => r.data),
    staleTime: SCHEMA_STALE_TIME,
    gcTime:    SCHEMA_GC_TIME,
  });
}
