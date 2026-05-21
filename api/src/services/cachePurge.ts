import { env } from '../config/env';

const CF_ZONE_ID   = process.env.CF_ZONE_ID   ?? '';
const CF_API_TOKEN = process.env.CF_API_TOKEN  ?? '';

/**
 * Purges Cloudflare's edge cache for meta schema endpoints.
 *
 * Called automatically after any mutation to meta.entities or meta.fields.
 * On the free tier, purges specific known URLs.
 * Upgrade to Pro and switch to the prefix method for full coverage.
 *
 * No-ops silently in local dev (when CF vars are absent) so the service
 * stays testable without Cloudflare credentials.
 */
export async function purgeMetaCache(entitySlug?: string): Promise<void> {
  if (!CF_ZONE_ID || !CF_API_TOKEN) return;

  const base = env.API_BASE_URL;
  const urlsToPurge: string[] = [`${base}/api/v1/meta/entities`, `${base}/api/v1/meta/fields`];

  if (entitySlug) {
    urlsToPurge.push(
      `${base}/api/v1/meta/entities/${entitySlug}`,
      `${base}/api/v1/meta/fields/${entitySlug}`,
    );
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ files: urlsToPurge }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    // Non-fatal: log and continue — a stale cache is better than a failed mutation.
    console.error(`[CachePurge] Cloudflare returned ${response.status}: ${body}`);
    return;
  }

  const json = (await response.json()) as { success: boolean };
  if (!json.success) {
    console.error('[CachePurge] Cloudflare indicated failure:', json);
  }
}
