import React, { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';

import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

import { DynamicTable } from './DynamicTable';
import { DynamicForm }  from './DynamicForm';
import { useEntitySchema } from '../hooks/useEntitySchema';
import type { RecordRow } from '../types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DynamicDataViewProps {
  entitySlug: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Orchestrates the table + form for any entity.
 * A single `<DynamicDataView slug="vehicle" />` renders a full CRUD module.
 */
export function DynamicDataView({ entitySlug }: DynamicDataViewProps) {
  const [isFormOpen,       setIsFormOpen]       = useState(false);
  const [selectedRecord,   setSelectedRecord]   = useState<RecordRow | null>(null);

  const { data: schema, isLoading } = useEntitySchema(entitySlug);

  const openCreate = () => {
    setSelectedRecord(null);
    setIsFormOpen(true);
  };

  const openEdit = (record: RecordRow) => {
    setSelectedRecord(record);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedRecord(null);
  };

  const handleFormSuccess = () => {
    closeForm();
  };

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          {isLoading ? (
            <>
              <Skeleton className="h-7 w-40 mb-1" />
              <Skeleton className="h-4 w-64" />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">
                {schema?.entity.name ?? entitySlug}
              </h1>
              {schema?.entity.description && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {schema.entity.description}
                </p>
              )}
            </>
          )}
        </div>

        <Button onClick={openCreate} disabled={isLoading}>
          <Plus className="mr-2 h-4 w-4" />
          New {schema?.entity.name ?? ''}
        </Button>
      </div>

      {/* ── Data table ────────────────────────────────────────────────────── */}
      <DynamicTable
        entitySlug={entitySlug}
        selectedRowId={selectedRecord?.id}
        onRowClick={openEdit}
      />

      {/* ── Create / Edit dialog ───────────────────────────────────────────── */}
      <Dialog open={isFormOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedRecord
                ? <><Pencil className="h-4 w-4" /> Edit {schema?.entity.name}</>
                : <><Plus   className="h-4 w-4" /> New {schema?.entity.name}</>
              }
              {selectedRecord && (
                <span className="font-mono text-sm font-normal text-muted-foreground">
                  {selectedRecord.record_number}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {/*
            `key` forces DynamicForm to fully remount when switching between
            create (no recordId) and edit (with recordId), preventing stale
            form state from bleeding across interactions.
          */}
          <DynamicForm
            key={`${entitySlug}-${selectedRecord?.id ?? 'new'}`}
            entitySlug={entitySlug}
            recordId={selectedRecord?.id}
            onSuccess={handleFormSuccess}
            onCancel={closeForm}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
