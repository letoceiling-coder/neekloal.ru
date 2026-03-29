import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";

export type CommandSelectOption = { value: string; label: string };

type AdminCommandSelectProps = {
  id?: string;
  label?: string;
  options: CommandSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
};

export function AdminCommandSelect({
  id,
  label,
  options,
  value,
  onChange,
  placeholder = "Выберите…",
  searchPlaceholder = "Поиск…",
  emptyText = "Ничего не найдено",
  disabled,
  className,
}: AdminCommandSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative min-w-[200px]", className)}>
      {label ? (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-600">
          {label}
        </label>
      ) : null}
      <Button
        id={id}
        type="button"
        variant="secondary"
        disabled={disabled}
        className={cn(
          "h-9 w-full justify-between px-3 py-2 font-normal",
          !selected && "text-neutral-500"
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="truncate">{selected || placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </Button>
      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg"
          role="listbox"
        >
          <Command className="rounded-lg bg-white" shouldFilter>
            <CommandInput
              placeholder={searchPlaceholder}
              className="h-10 border-b border-neutral-100 px-3 text-sm outline-none"
            />
            <CommandList className="max-h-56 overflow-y-auto p-1">
              <CommandEmpty className="px-3 py-6 text-center text-sm text-neutral-500">
                {emptyText}
              </CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value || "__empty__"}
                    value={`${opt.label} ${opt.value}`}
                    onSelect={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-900 data-[selected=true]:bg-neutral-100"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        value === opt.value ? "opacity-100" : "opacity-0"
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
