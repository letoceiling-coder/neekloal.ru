import type { ReactNode } from "react";
import { cn } from "./cn";

export type ListProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  className?: string;
};

export function List<T>({ items, getKey, renderItem, className }: ListProps<T>) {
  return (
    <ul className={cn("list-none", className)}>
      {items.map((item) => (
        <li key={getKey(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}
