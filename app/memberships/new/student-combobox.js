"use client";

import { useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, Search, XIcon } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";

/**
 * Searchable student picker for Add Membership's Select Student step. An
 * accessible Base UI combobox (input + listbox, arrow-key navigation,
 * Enter to choose, Escape to close) over the already-loaded student options —
 * no request is made while typing. Typing matches the student's name or
 * student ID. Each result shows the shared `Avatar` (photo, else initials),
 * the name and the ID; the chosen student's avatar sits in the field and the
 * input reads "Name (ID)". The field is the application's search field: the
 * shared `Input` with the same leading search icon `SearchInput` uses (list
 * pages), and the popup follows `SelectContent`.
 *
 * `name` submits the chosen student's id with the surrounding form, exactly as
 * the native select did.
 *
 * Filtering runs on every keystroke (the input's own value drives it). While
 * the field has text, a "Clear search" button empties only that text, restores
 * the full list and keeps the popup open and focused; it never changes the
 * selected student.
 */
function toItem(student) {
  return {
    value: student.id,
    label: `${student.full_name} (${student.student_code})`,
    name: student.full_name,
    code: student.student_code,
    photoUrl: student.photo_url ?? null,
  };
}

function matches(item, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle);
}

export default function StudentCombobox({ id, name, students, value, onValueChange }) {
  const items = students.map(toItem);
  const selected = items.find((item) => item.value === value) ?? null;
  const inputRef = useRef(null);
  const [inputValue, setInputValue] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);

  function clearSearch() {
    setInputValue("");
    setOpen(true);
    inputRef.current?.focus();
  }

  return (
    <Combobox.Root
      name={name}
      items={items}
      value={selected}
      onValueChange={(item) => onValueChange(item?.value ?? "")}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      open={open}
      onOpenChange={setOpen}
      filter={matches}
      autoHighlight
    >
      <Combobox.InputGroup className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden="true"
        />
        {selected ? (
          <Avatar
            name={selected.name}
            src={selected.photoUrl}
            size="sm"
            className="pointer-events-none absolute top-1/2 left-8 z-10 size-8 -translate-y-1/2"
          />
        ) : null}
        <Combobox.Input
          ref={inputRef}
          id={id}
          render={<Input />}
          placeholder="Search by student name or ID…"
          autoComplete="off"
          className={`truncate ${selected ? "pl-18" : "pl-9"} ${inputValue ? "pr-18" : "pr-10"}`}
        />
        {inputValue ? (
          <button
            type="button"
            aria-label="Clear search"
            // A pointer shortcut: it stays out of the tab order (the popup marks
            // everything outside it aria-hidden while open) and never takes focus
            // from the input, so the combobox's keyboard behaviour is untouched.
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSearch}
            className="absolute top-0 right-10 flex h-10 w-8 items-center justify-center rounded-input text-text-secondary outline-none hover:text-text-primary"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <Combobox.Trigger
          aria-label="Show students"
          className="absolute top-0 right-0 flex h-10 w-10 items-center justify-center rounded-input text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={4}>
          <Combobox.Popup className="w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            <Combobox.Empty>
              <div className="px-3 py-4 text-center text-body text-text-secondary">No students found</div>
            </Combobox.Empty>
            <Combobox.List className="max-h-64 overflow-x-hidden overflow-y-auto overscroll-contain outline-none data-empty:hidden">
              {(item) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="relative flex w-full cursor-default items-center gap-3 rounded-md py-1.5 pr-8 pl-1.5 text-body outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <Avatar name={item.name} src={item.photoUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-primary">{item.name}</span>
                    <span className="block truncate text-small text-text-secondary">{item.code}</span>
                  </span>
                  <Combobox.ItemIndicator className="absolute right-2 flex items-center justify-center">
                    <CheckIcon className="size-4" aria-hidden="true" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
