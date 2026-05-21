import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, LayoutGrid, Loader2 } from 'lucide-react';

import { Button }    from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton }  from '@/components/ui/skeleton';
import { cn }        from '@/lib/utils';
import { useAuth }   from '@/hooks/useAuth';
import { useEntityList } from '@/modules/dynamic/hooks/useEntitySchema';

export default function DashboardLayout() {
  const { user, tenant, logout }     = useAuth();
  const { data, isLoading }          = useEntityList();
  const navigate                     = useNavigate();
  const entities                     = data?.entities ?? [];

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="flex w-60 flex-col border-r bg-sidebar shrink-0">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <LayoutGrid className="h-5 w-5 text-sidebar-primary" />
          <span className="font-semibold text-sm truncate">
            {tenant?.name ?? 'ShopSmart'}
          </span>
        </div>

        {/* Entity navigation — dynamically generated from meta.entities */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))
            : entities.map((entity) => (
                <NavLink
                  key={entity.id}
                  to={`/dashboard/${entity.slug}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                        : 'text-sidebar-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  {entity.icon && (
                    <span className="text-base leading-none" aria-hidden>
                      {entity.icon}
                    </span>
                  )}
                  {entity.name}
                </NavLink>
              ))
          }
        </nav>

        {/* Footer: user info + logout */}
        <div className="border-t p-3">
          <Separator className="mb-3" />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{user?.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Sign out"
              className="shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-6">
          <React.Suspense fallback={
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }>
            <Outlet />
          </React.Suspense>
        </div>
      </main>
    </div>
  );
}
