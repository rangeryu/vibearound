import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ModelIdComboboxOption {
  id: string;
  label?: string | null;
  aliases?: string[] | null;
  contextText?: string | null;
  inputText?: string | null;
}

interface ModelIdComboboxProps {
  value: string;
  options: readonly ModelIdComboboxOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  maxSuggestions?: number;
  disabled?: boolean;
}

export function ModelIdCombobox({
  value,
  options,
  onValueChange,
  placeholder,
  inputClassName = "h-7 w-full font-mono text-xs",
  dropdownClassName,
  maxSuggestions = 8,
  disabled = false,
}: ModelIdComboboxProps) {
  const [open, setOpen] = useState(false);
  const suggestions = disabled ? [] : modelIdSuggestions(options, value, maxSuggestions);

  return (
    <div className="relative">
      <Input
        value={value}
        className={inputClassName}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      {open && suggestions.length > 0 && (
        <div
          role="listbox"
          className={cn(
            "absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg",
            dropdownClassName,
          )}
        >
          {suggestions.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              className="grid w-full min-w-0 gap-1 rounded px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(event) => {
                event.preventDefault();
                onValueChange(candidate.id);
                setOpen(false);
              }}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-mono text-xs text-foreground">
                  {candidate.id}
                </span>
                {candidate.label && candidate.label !== candidate.id && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {candidate.label}
                  </span>
                )}
              </span>
              {candidate.contextText && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {candidate.contextText}
                </span>
              )}
              {candidate.inputText && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {candidate.inputText}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function modelIdSuggestions(
  options: readonly ModelIdComboboxOption[],
  value: string,
  maxSuggestions: number,
): ModelIdComboboxOption[] {
  const trimmed = value.trim();
  const query = trimmed.toLowerCase();
  const exactValue = options.some((option) => option.id === trimmed);
  const filtered = query
    ? exactValue
      ? options
      : options.filter((option) => modelIdOptionMatches(option, query))
    : options;
  return filtered.slice(0, maxSuggestions);
}

function modelIdOptionMatches(option: ModelIdComboboxOption, query: string): boolean {
  return [
    option.id,
    option.label ?? "",
    option.contextText ?? "",
    option.inputText ?? "",
    ...(option.aliases ?? []),
  ].some((value) => value.toLowerCase().includes(query));
}
