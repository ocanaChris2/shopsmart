import React from 'react';
import type { Control } from 'react-hook-form';
import {
  FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { getFormRenderer }  from '../schemaMapper';
import type { FieldDefinition } from '../types';

interface DynamicFieldProps {
  field:    FieldDefinition;
  control:  Control<Record<string, unknown>>;
  disabled?: boolean;
}

/**
 * Renders a single form field using the Schema Mapper.
 *
 * Acts as the glue between React Hook Form's <Controller> pattern
 * (via shadcn's <FormField>) and the correct UI widget for each field_type.
 */
export function DynamicField({ field, control, disabled }: DynamicFieldProps) {
  const FieldRenderer = getFormRenderer(field.field_type);

  return (
    <FormField
      control={control}
      name={field.slug}
      render={({ field: formField }) => (
        <FormItem>
          <FormLabel>
            {field.name}
            {field.is_required && (
              <span className="ml-1 text-destructive" aria-label="required">*</span>
            )}
          </FormLabel>
          <FormControl>
            {/* Each FieldRenderer is a proper React component so hooks inside
                (e.g. ReferenceField's useQuery) are always called correctly. */}
            <FieldRenderer
              field={field}
              formField={formField}
              disabled={disabled}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
