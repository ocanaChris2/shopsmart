import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useForm }          from 'react-hook-form';
import { zodResolver }      from '@hookform/resolvers/zod';
import { z }                from 'zod';
import { Loader2 }          from 'lucide-react';
import { toast }            from 'sonner';

import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { useAuth }          from '@/hooks/useAuth';
import { getErrorMessage }  from '@/services/apiClient';

// ── Validation ─────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:       z.string().email('Invalid email address'),
  password:    z.string().min(8, 'Password must be at least 8 characters'),
  tenant_slug: z.string().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const location = useLocation();
  const [showTenant, setShowTenant] = useState(false);

  // Redirect to the page the user was trying to access, or the dashboard.
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/dashboard';

  const form = useForm<LoginFormValues>({
    resolver:      zodResolver(loginSchema),
    defaultValues: { email: '', password: '', tenant_slug: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login({
        email:       values.email,
        password:    values.password,
        tenant_slug: values.tenant_slug || undefined,
      });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Login failed. Check your credentials.'));
    }
  };

  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo / Brand */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            {import.meta.env.VITE_APP_NAME ?? 'ShopSmart ERP'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your workspace
          </p>
        </div>

        {/* Form */}
        <div className="rounded-xl border bg-card p-8 shadow-sm">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {showTenant && (
                <FormField
                  control={form.control}
                  name="tenant_slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workspace slug</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="my-company" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Sign in
              </Button>
            </form>
          </Form>

          <button
            type="button"
            onClick={() => setShowTenant(!showTenant)}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showTenant ? 'Hide workspace selector' : 'Sign in to a specific workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
