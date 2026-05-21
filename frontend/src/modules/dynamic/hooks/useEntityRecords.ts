import {
  useQuery, useMutation, useQueryClient,
  keepPreviousData, type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient }  from '@/services/apiClient';
import { queryKeys }  from '@/services/queryClient';
import type { RecordRow, PaginatedResponse, RecordQueryParams } from '../types';

// ── List records ──────────────────────────────────────────────────────────────

/**
 * Fetches a paginated list of records for an entity.
 * `keepPreviousData` ensures the table never flickers to empty during
 * page transitions — the old page stays visible until the new one arrives.
 */
export function useEntityRecords(
  entitySlug: string,
  params:     RecordQueryParams = {},
): UseQueryResult<PaginatedResponse<RecordRow>> {
  return useQuery<PaginatedResponse<RecordRow>>({
    queryKey:         queryKeys.records(entitySlug, params),
    queryFn:          () =>
      apiClient
        .get<PaginatedResponse<RecordRow>>(`/api/v1/data/${entitySlug}`, {
          params: {
            page:   params.page  ?? 1,
            limit:  params.limit ?? 20,
            status: params.status,
            filter: params.filter ? JSON.stringify(params.filter) : undefined,
          },
        })
        .then((r) => r.data),
    enabled:          !!entitySlug,
    placeholderData:  keepPreviousData,
    staleTime:        30_000,   // 30 seconds for live data
  });
}

// ── Single record ─────────────────────────────────────────────────────────────

export function useEntityRecord(
  entitySlug: string,
  recordId:   string,
): UseQueryResult<RecordRow> {
  return useQuery<RecordRow>({
    queryKey:  queryKeys.record(entitySlug, recordId),
    queryFn:   () =>
      apiClient
        .get<RecordRow>(`/api/v1/data/${entitySlug}/${recordId}`)
        .then((r) => r.data),
    enabled:   !!entitySlug && !!recordId,
    staleTime: 30_000,
  });
}

// ── Create record ─────────────────────────────────────────────────────────────

export function useCreateRecord(entitySlug: string) {
  const qc = useQueryClient();

  return useMutation<RecordRow, Error, Record<string, unknown>>({
    mutationFn: (data) =>
      apiClient
        .post<RecordRow>(`/api/v1/data/${entitySlug}`, { data })
        .then((r) => r.data),
    onSuccess: () => {
      // Invalidate the list — new record should appear immediately.
      void qc.invalidateQueries({ queryKey: queryKeys.records(entitySlug) });
    },
  });
}

// ── Update record (PATCH with optimistic update) ──────────────────────────────

interface UpdatePayload {
  data:    Record<string, unknown>;
  version: number;
}

export function useUpdateRecord(entitySlug: string, recordId: string) {
  const qc = useQueryClient();

  return useMutation<RecordRow, Error, UpdatePayload>({
    mutationFn: ({ data, version }) =>
      apiClient
        .patch<RecordRow>(`/api/v1/data/${entitySlug}/${recordId}`, { data, version })
        .then((r) => r.data),

    // ── Optimistic update ────────────────────────────────────────────────────
    onMutate: async ({ data: patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.record(entitySlug, recordId) });
      const previous = qc.getQueryData<RecordRow>(queryKeys.record(entitySlug, recordId));

      qc.setQueryData<RecordRow>(queryKeys.record(entitySlug, recordId), (old) => {
        if (!old) return old;
        return { ...old, data: { ...old.data, ...patch } };
      });

      return { previous };
    },

    // ── Rollback on error ─────────────────────────────────────────────────────
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: RecordRow } | undefined;
      if (ctx?.previous) {
        qc.setQueryData(queryKeys.record(entitySlug, recordId), ctx.previous);
      }
    },

    // ── Ensure fresh data after success or error ──────────────────────────────
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.record(entitySlug, recordId) });
      void qc.invalidateQueries({ queryKey: queryKeys.records(entitySlug) });
    },
  });
}
