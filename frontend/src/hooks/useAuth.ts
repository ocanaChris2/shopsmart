// Re-export the hook so call sites import from a clean path.
// Having a dedicated hooks/ file also makes it easy to add local state
// (e.g. isLoggingOut) in one place without touching AuthContext.
export { useAuthContext as useAuth } from '@/context/AuthContext';
export type { AuthUser, AuthTenant, LoginCredentials } from '@/context/AuthContext';
