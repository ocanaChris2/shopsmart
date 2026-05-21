import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { DynamicDataView } from '@/modules/dynamic/components/DynamicDataView';

/**
 * Generic entity page — handles every route at `/dashboard/:entitySlug`.
 *
 * This is intentionally the ONLY entity page in the entire frontend.
 * The DynamicDataView component reads the entitySlug, fetches the schema,
 * and renders the appropriate table + form entirely from API metadata.
 *
 * To "add" a new business object (e.g. "Fleet Vehicle", "Insurance Claim"):
 *   1. Insert rows into meta.entities and meta.fields in the database.
 *   2. No frontend code changes needed — this page handles it automatically.
 */
export default function EntityPage() {
  const { entitySlug } = useParams<{ entitySlug: string }>();

  if (!entitySlug) return <Navigate to="/dashboard" replace />;

  return <DynamicDataView entitySlug={entitySlug} />;
}
