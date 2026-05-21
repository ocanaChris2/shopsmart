import React, { lazy, Suspense } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster }             from 'sonner';
import { Loader2 }             from 'lucide-react';

import { AuthProvider }    from '@/context/AuthContext';
import { ProtectedRoute }  from '@/components/ProtectedRoute';
import { queryClient }     from '@/services/queryClient';

// ── Route-level code splitting ────────────────────────────────────────────────
// Each lazy import becomes its own chunk in the Vite build.
// The user only downloads the code for pages they actually visit.

const LoginPage      = lazy(() => import('@/pages/LoginPage'));
const DashboardLayout = lazy(() => import('@/pages/DashboardLayout'));
const EntityPage     = lazy(() => import('@/pages/EntityPage'));

// ── Shared suspense fallback ──────────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />

              {/* Protected: every /dashboard/* route requires a valid JWT */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardLayout />}>
                  {/*
                    The single generic entity route.
                    /dashboard/vehicles  → entitySlug = "vehicles"
                    /dashboard/patients  → entitySlug = "patients"
                    /dashboard/invoices  → entitySlug = "invoices"
                    All handled by ONE component with NO hardcoded logic.
                  */}
                  <Route path=":entitySlug" element={<EntityPage />} />

                  {/* Default: redirect to the first entity (user sees the sidebar) */}
                  <Route index element={
                    <div className="flex h-64 items-center justify-center text-muted-foreground">
                      Select a module from the sidebar to get started.
                    </div>
                  } />
                </Route>
              </Route>

              {/* Catch-all → login */}
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </Router>

        {/* Global toast notifications (sonner) */}
        <Toaster position="bottom-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
