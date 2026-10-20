import Link from "next/link";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  headClassName?: string;
  className?: string;
  /** Buttons in this cell stay clickable when the rest of the row is a link. */
  interactive?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  rowHref,
  rowLabel,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
  caption?: string;
  /** When set, the whole row navigates here. */
  rowHref?: (row: T) => string;
  /** Accessible name for that row link. */
  rowLabel?: (row: T) => string;
}) {
  return (
    <Table>
      {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id} className={column.headClassName}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="text-muted-foreground h-24 text-center whitespace-normal"
            >
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const href = rowHref?.(row);
            const label = rowLabel?.(row) ?? href;
            return (
              <TableRow
                key={rowKey(row)}
                className={
                  href
                    ? "group cursor-pointer hover:bg-muted/70 focus-within:bg-muted/70"
                    : undefined
                }
              >
                {columns.map((column, index) => (
                  <TableCell
                    key={column.id}
                    className={cn(href && "relative", column.className)}
                  >
                    {href && !column.interactive ? (
                      <Link
                        href={href}
                        aria-label={index === 0 ? label : undefined}
                        aria-hidden={index === 0 ? undefined : true}
                        tabIndex={index === 0 ? 0 : -1}
                        className="pointer-events-auto absolute inset-0 z-10 cursor-pointer touch-manipulation focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      />
                    ) : null}
                    <div className={href && !column.interactive ? "relative" : undefined}>
                      {column.cell(row)}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
