import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// ── Token helpers ─────────────────────────────────────────────────────────────
// Storage choice: localStorage persists across tabs and page reloads.
// XSS risk is mitigated by:
//   1. Cloudflare's strict CSP (default-src 'none') blocks inline scripts.
//   2. React's JSX escaping prevents DOM-injection XSS in our own code.
//   3. No eval(), no dangerouslySetInnerHTML in this codebase.
// For a BFF (Backend For Frontend) setup, migrate to HttpOnly cookies.

const TOKEN_KEY = 'shopsmart_auth_token';

export const tokenStorage = {
  get:    ():     string | null => localStorage.getItem(TOKEN_KEY),
  set:    (t: string):    void  => localStorage.setItem(TOKEN_KEY, t),
  remove: ():             void  => localStorage.removeItem(TOKEN_KEY),
};

// ── Axios instance ────────────────────────────────────────────────────────────

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// ── Request interceptor: attach JWT ──────────────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = tokenStorage.get();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor: handle 401 / 403 globally ─────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — clear storage and redirect to login.
      // We dispatch a custom event so AuthContext can react without a circular
      // import (apiClient → AuthContext → apiClient).
      tokenStorage.remove();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    if (error.response?.status === 403) {
      window.dispatchEvent(new CustomEvent('auth:forbidden'));
    }

    return Promise.reject(error);
  },
);

// ── Typed response helper ─────────────────────────────────────────────────────

export type ApiErrorBody = {
  error: {
    statusCode: number;
    message:    string;
    code:       string;
    issues?:    unknown[];
  };
};

export function isApiError(err: unknown): err is AxiosError<ApiErrorBody> {
  return axios.isAxiosError(err);
}

export function getErrorMessage(err: unknown, fallback = 'An unexpected error occurred.'): string {
  if (isApiError(err)) {
    return err.response?.data?.error?.message ?? err.message ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
