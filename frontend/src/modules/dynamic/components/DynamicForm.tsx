import React, { useMemo, useEffect } from 'react';
import { useForm }          from 'react-hook-form';
import { zodResolver }      from '@hookform/resolvers/zod';
import { toast }            from 'sonner';
import { Loader2 }          from 'lucide-react';

import { Button }            from '@/components/ui/button';
import { Form }              from '@/components/ui/form';
import { Skeleton }          from '@/components/ui/skeleton';
import { getErrorMessage }   from '@/services/apiClient';
import { DynamicField }      from './DynamicField';
import { useEntitySchema }   from '../hooks/useEntitySchema';
import { useEntityRecord, useCreateRecord, useUpdateRecord } from '../hooks/useEntityRecords';
import { buildZodSchema, buildDefaultValues } from '../zodBuilder';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DynamicFormProps {
  entitySlug: string;
  recordId?:  string;                    // undefined = create mode, string = edit mode
  onSuccess?: (record: { id: string }) => void;
  onCancel?:  () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DynamicForm({
  entitySlug, recordId, onSuccess, onCancel,
}: DynamicFormProps) {
  const isEditing = !!recordId;

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: schema, isLoading: schemaLoading, error: schemaError } =
    useEntitySchema(entitySlug);

  const { data: record, isLoading: recordLoading } =
    useEntityRecord(entitySlug, recordId ?? '');

  const createMutation = useCreateRecord(entitySlug);
  const updateMutation = useUpdateRecord(entitySlug, recordId ?? '');

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // ── Build Zod schema ───────────────────────────────────────────────────────
  // Memoised: only recalculates when the schema definition changes (rare).
  const zodSchema = useMemo(
    () => schema ? buildZodSchema(schema.fields) : null,
    [schema],
  );

  // ── React Hook Form ────────────────────────────────────────────────────────
  const form = useForm<Record<string, unknown>>({
    resolver:      zodSchema ? zodResolver(zodSchema) : undefined,
    defaultValues: {},
    mode:          'onBlur',
  });

  // Reset form whenever the schema or the existing record data loads.
  // The `key` prop on the parent (in DynamicDataView) handles remounting
  // between create/edit, but this handles async load completion.
  useEffect(() => {
    if (!schema) return;
    const defaults = buildDefaultValues(
      schema.fields,
      isEditing ? record?.data : undefined,
    );
    form.reset(defaults);
  }, [schema, record, isEditing, form]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      if (isEditing && record) {
        const updated = await updateMutation.mutateAsync({
          data:    values,
          version: record.version,
        });
        toast.success('Record updated successfully');
        onSuccess?.({ id: updated.id });
      } else {
        const created = await createMutation.mutateAsync(values);
        toast.success(`${schema?.entity.name ?? 'Record'} ${created.record_number} created`);
        onSuccess?.({ id: created.id });
        form.reset();
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  const isLoading = schemaLoading || (isEditing && recordLoading);
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (schemaError || !schema) {
    return (
      <p className="text-sm text-destructive">
        Failed to load form schema. Please refresh and try again.
      </p>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const sortedFields = [...schema.fields].sort((a, b) => a.display_order - b.display_order);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">

        {/* Dynamic field grid — 1 column on mobile, 2 on medium+ screens */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          {sortedFields.map((field) => (
            <div
              key={field.id}
              className={
                // Full-width for text areas and fields that need space
                ['text', 'multi_enum', 'reference'].includes(field.field_type)
                  ? 'col-span-full'
                  : ''
              }
            >
              <DynamicField
                field={field}
                control={form.control as unknown as Parameters<typeof DynamicField>[0]['control']}
                disabled={isSubmitting}
              />
            </div>
          ))}
        </div>

        {/* Action row */}
        <div className="flex justify-end gap-3 pt-2 border-t">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Save changes' : `Create ${schema.entity.name}`}
          </Button>
        </div>
      </form>
    </Form>
  );
}
