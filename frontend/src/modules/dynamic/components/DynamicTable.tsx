import React, { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import { renderCellValue }     from '../schemaMapper';
import { useEntitySchema }     from '../hooks/useEntitySchema';
import { useEntityRecords }    from '../hooks/useEntityRecords';
import type { RecordRow, FieldDefinition } from '../types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DynamicTableProps {
  entitySlug:     string;
  onRowClick?:    (record: RecordRow) => void;
  selectedRowId?: string;
}

// ── Column factory ────────────────────────────────────────────────────────────

function buildColumns(fields: FieldDefinition[]): ColumnDef<RecordRow>[] {
  const displayFields = fields
    .filter((f) => f.field_type !== 'text')   // exclude long text from grid
    .slice(0, 6);                              // cap at 6 columns for readability

  const dynamicCols: ColumnDef<RecordRow>[] = displayFields.map((field) => ({
    id:         field.slug,
    header:     ({ column }) => (
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide hover:text-foreground transition-colors"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        {field.name}
        {column.getIsSorted() === 'asc'  ? <ArrowUp   className="h-3 w-3" /> :
         column.getIsSorted() === 'desc' ? <ArrowDown  className="h-3 w-3" /> :
                                           <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    ),
    // accessorFn unwraps the JSONB `data` column — the core of dynamic schema support.
    accessorFn:  (row: RecordRow) => row.data[field.slug],
    cell:        ({ getValue }) => renderCellValue(getValue(), field),
    // String fields are sortable client-side; for server-side sort, send sort param to API.
    sortingFn:   'alphanumeric',
  }));

  return [
    {
      id:        'record_number',
      header:    '#',
      accessorFn: (row) => row.record_number,
      cell:      ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">{String(getValue())}</span>
      ),
      size:  100,
    },
    ...dynamicCols,
    {
      id:        'updated_at',
      header:    'Modified',
      accessorFn: (row) => row.updated_at,
      cell:      ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {new Date(String(getValue())).toLocaleDateString()}
        </span>
      ),
      size: 100,
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DynamicTable({
  entitySlug, onRowClick, selectedRowId,
}: DynamicTableProps) {
  const [sorting, setSorting]     = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const { data: schema, isLoading: schemaLoading } = useEntitySchema(entitySlug);

  const { data: response, isLoading: dataLoading, isFetching } = useEntityRecords(
    entitySlug,
    {
      page:  pagination.pageIndex + 1,
      limit: pagination.pageSize,
    },
  );

  // Build columns only when schema changes (rare — cached for 4h).
  const columns = useMemo(
    () => schema ? buildColumns(schema.fields) : [],
    [schema],
  );

  const table = useReactTable<RecordRow>({
    data:              response?.data ?? [],
    columns,
    state:             { sorting, pagination },
    onSortingChange:   setSorting,
    onPaginationChange: setPagination,
    manualPagination:  true,                             // server-side pagination
    pageCount:         response?.meta.pages ?? -1,
    getCoreRowModel:   getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const isLoading = schemaLoading || dataLoading;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!schema) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Stale indicator */}
      {isFetching && !dataLoading && (
        <p className="text-xs text-muted-foreground animate-pulse">Refreshing…</p>
      )}

      {/* Table */}
      <div className="rounded-md border bg-card overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/40">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    className="px-4 py-3"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  No {schema.entity.name.toLowerCase()} records found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={selectedRowId === row.original.id ? 'selected' : undefined}
                  onClick={() => onRowClick?.(row.original)}
                  className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          {response ? (
            <>
              Showing {(pagination.pageIndex * pagination.pageSize) + 1}–
              {Math.min((pagination.pageIndex + 1) * pagination.pageSize, response.meta.total)} of{' '}
              {response.meta.total.toLocaleString()} records
            </>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {pagination.pageIndex + 1} / {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
