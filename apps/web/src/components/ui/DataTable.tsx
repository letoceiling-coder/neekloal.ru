import type { ReactNode } from "react";
import { Card } from "./Card";
import { cn } from "./cn";
import { EmptyState } from "./EmptyState";
import { Loader } from "./Loader";
import { Skeleton } from "./Skeleton";

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  /** skeleton: таблица-заглушка без мерцания контента */
  loadingMode?: "spinner" | "skeleton";
  skeletonRows?: number;
  emptyTitle: string;
  emptyDescription?: string;
  className?: string;
  /** Клик по строке (не мешает кнопкам с stopPropagation). */
  onRowClick?: (row: T) => void;
  getRowClassName?: (row: T) => string | undefined;
};

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  isLoading,
  loadingMode = "spinner",
  skeletonRows = 8,
  emptyTitle,
  emptyDescription,
  className,
  onRowClick,
  getRowClassName,
}: DataTableProps<T>) {
  if (isLoading && loadingMode === "skeleton") {
    const n = columns.length;
    return (
      <Card className={cn("overflow-hidden p-0", className)}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                {columns.map((col) => (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn("px-4 py-3 font-medium text-neutral-600", col.className)}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: skeletonRows }).map((_, ri) => (
                <tr key={ri} className="border-b border-neutral-100 last:border-b-0">
                  {Array.from({ length: n }).map((_, ci) => (
                    <td key={ci} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={cn("overflow-hidden p-0", className)}>
        <div className="flex min-h-[120px] items-center justify-center px-4 py-8">
          <Loader />
        </div>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} className={className} />
    );
  }

  return (
    <Card className={cn("overflow-hidden p-0", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    "px-4 py-3 font-medium text-neutral-600",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  "border-b border-neutral-100 last:border-b-0",
                  onRowClick && "cursor-pointer hover:bg-neutral-50/90",
                  getRowClassName?.(row)
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn("px-4 py-3 text-neutral-900", col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
