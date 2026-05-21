import React, {
  createContext, useContext, useReducer,
  useCallback, useEffect, type ReactNode,
} from 'react';
import { apiClient, tokenStorage } from '@/services/apiClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser   { id: string; email: string; display_name: string }
export interface AuthTenant { id: string; name: string; slug: string; plan: string }

interface AuthState {
  user:            AuthUser   | null;
  tenant:          AuthTenant | null;
  token:           string     | null;
  isLoading:       boolean;
  isAuthenticated: boolean;
}

type AuthAction =
  | { type: 'HYDRATE_START' }
  | { type: 'HYDRATE_FAIL' }
  | { type: 'LOGIN_SUCCESS'; user: AuthUser; tenant: AuthTenant; token: string }
  | { type: 'LOGOUT' };

export interface LoginCredentials {
  email:        string;
  password:     string;
  tenant_slug?: string;
}

interface AuthContextValue extends AuthState {
  login:  (creds: LoginCredentials) => Promise<void>;
  logout: () => void;
}

// ── Reducer ───────────────────────────────────────────────────────────────────

const initialState: AuthState = {
  user:            null,
  tenant:          null,
  token:           null,
  isLoading:       true,
  isAuthenticated: false,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'HYDRATE_START':
      return { ...state, isLoading: true };
    case 'HYDRATE_FAIL':
      return { ...initialState, isLoading: false };
    case 'LOGIN_SUCCESS':
      return {
        user:            action.user,
        tenant:          action.tenant,
        token:           action.token,
        isLoading:       false,
        isAuthenticated: true,
      };
    case 'LOGOUT':
      return { ...initialState, isLoading: false };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // ── Rehydrate from localStorage on mount ─────────────────────────────────
  // Validate the stored token is still fresh by checking the JWT expiry
  // client-side (no network call needed).
  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      dispatch({ type: 'HYDRATE_FAIL' });
      return;
    }

    try {
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(atob(payloadB64 ?? ''));
      const expiry   = (payload as { exp?: number }).exp;

      if (!expiry || expiry * 1000 < Date.now()) {
        tokenStorage.remove();
        dispatch({ type: 'HYDRATE_FAIL' });
        return;
      }

      // Token is still valid — restore auth state from the payload.
      const { sub, email, tenant_id, role } = payload as {
        sub: string; email: string; tenant_id: string; role: string;
      };

      // Fetch current user and tenant details to refresh display name etc.
      // If this fails (e.g. network offline), we fall back to the token data.
      apiClient
        .get<{ user: AuthUser; tenant: AuthTenant }>('/api/v1/auth/me')
        .then(({ data }) => {
          dispatch({ type: 'LOGIN_SUCCESS', user: data.user, tenant: data.tenant, token });
        })
        .catch(() => {
          // Offline or token invalid — use minimal data from the JWT.
          dispatch({
            type: 'LOGIN_SUCCESS',
            user:   { id: sub, email, display_name: email },
            tenant: { id: tenant_id, name: '', slug: '', plan: role },
            token,
          });
        });
    } catch {
      tokenStorage.remove();
      dispatch({ type: 'HYDRATE_FAIL' });
    }
  }, []);

  // ── Listen for global auth expiry events from the API interceptor ─────────
  useEffect(() => {
    const handleExpired = () => dispatch({ type: 'LOGOUT' });
    window.addEventListener('auth:expired',  handleExpired);
    window.addEventListener('auth:forbidden', handleExpired);
    return () => {
      window.removeEventListener('auth:expired',  handleExpired);
      window.removeEventListener('auth:forbidden', handleExpired);
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const login = useCallback(async (creds: LoginCredentials): Promise<void> => {
    const { data } = await apiClient.post<{
      token:      string;
      user:       AuthUser;
      tenant:     AuthTenant;
    }>('/auth/login', creds);

    tokenStorage.set(data.token);
    dispatch({ type: 'LOGIN_SUCCESS', user: data.user, tenant: data.tenant, token: data.token });
  }, []);

  const logout = useCallback((): void => {
    tokenStorage.remove();
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook (exported convenience — prevents direct context import) ──────────────

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>');
  return ctx;
}
