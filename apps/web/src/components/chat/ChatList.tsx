import { cn } from "../ui/cn";
import { Loader } from "../ui/Loader";

export type ChatListItem = {
  id: string;
  title: string;
  subtitle?: string;
};

export type ChatListProps = {
  items: ChatListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading?: boolean;
};

export function ChatList({
  items,
  selectedId,
  onSelect,
  isLoading,
}: ChatListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Loader />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-4">
        <p className="text-xs text-neutral-500">Нет диалогов для отображения.</p>
      </div>
    );
  }

  return (
    <nav
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
      aria-label="Диалоги"
    >
      {items.map((item) => {
        const active = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-200",
              active
                ? "bg-neutral-900 font-medium text-white"
                : "text-neutral-800 hover:bg-neutral-100"
            )}
          >
            <div className="truncate">{item.title}</div>
            {item.subtitle ? (
              <div
                className={cn(
                  "truncate text-xs font-normal",
                  active ? "text-neutral-300" : "text-neutral-500"
                )}
              >
                {item.subtitle}
              </div>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
