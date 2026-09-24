"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { countryForDialCode, searchCountries } from "@/lib/phone-countries";
import { DEFAULT_COUNTRY_CODE } from "@/lib/phone";
import { cn } from "@/lib/utils";

// A stored calling code that is not in the country list (a legacy or unusual
// code) is still shown, and kept, as itself.
function countryFor(dialCode) {
  const code = dialCode || DEFAULT_COUNTRY_CODE;
  return countryForDialCode(code) ?? { iso: "", name: "Other", dialCode: code, flag: "\u{1F310}" };
}

/**
 * The one phone-number field: a compact country-code selector joined to a
 * plain numeric input, so the two read as one control. The selector shows the
 * flag, the calling code and a chevron, and opens a searchable list of
 * countries; the number is a `type="tel"` input that keeps digits only.
 *
 * It submits TWO form values — `name` (the national digits) and
 * `countryCodeName` (the calling code, a hidden input) — never one merged
 * string, matching how Students and Instructors store a phone
 * (`phone_country_code` + `phone`). Both are uncontrolled from the form's point
 * of view, like every other field here: the number takes `defaultValue`, and the
 * selected country follows `defaultCountryCode` (a changed default — a failed
 * submission handing back what was typed — re-selects that country; a form
 * reset returns to it).
 *
 * The surface (height, border, radius, type, focus ring, error border) is the
 * standard `Input`'s, drawn once around both halves. Use it inside `FormField`:
 * `{(field) => <PhoneInput {...field} name="phone" ... />}` — `field` supplies
 * `id`, `aria-invalid` and `aria-describedby`, which land on the number input so
 * the error is associated with the phone field.
 *
 * Accessibility: the selector is a labelled button announcing the selected
 * country; the list is a labelled `listbox` of `option`s with `aria-selected`,
 * a search field to filter it, Arrow Up / Down to move, Enter to choose (Enter
 * in the search picks the first match), and Escape closes it.
 */
export default function PhoneInput({
  id,
  name = "phone",
  countryCodeName = "phone_country_code",
  defaultValue = "",
  defaultCountryCode = DEFAULT_COUNTRY_CODE,
  placeholder = "Enter phone number",
  required = false,
  disabled = false,
  onChange,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}) {
  const [country, setCountry] = useState(() => countryFor(defaultCountryCode));
  const [prevDefaultCode, setPrevDefaultCode] = useState(defaultCountryCode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listboxId = useId();
  const numberRef = useRef(null);
  const codeRef = useRef(null);
  const listRef = useRef(null);
  const defaultCodeRef = useRef(defaultCountryCode);

  // A new default (e.g. the values handed back after a failed submission)
  // re-selects that country.
  if (defaultCountryCode !== prevDefaultCode) {
    setPrevDefaultCode(defaultCountryCode);
    setCountry(countryFor(defaultCountryCode));
  }

  useEffect(() => {
    defaultCodeRef.current = defaultCountryCode;
  }, [defaultCountryCode]);

  // Cancel / a form reset returns the selector to its default too (the number
  // input resets natively).
  useEffect(() => {
    const form = codeRef.current?.form;
    if (!form) return undefined;
    const handleReset = () => setCountry(countryFor(defaultCodeRef.current));
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, []);

  const matches = searchCountries(query);

  function choose(next) {
    setCountry(next);
    setOpen(false);
    setQuery("");
    // Straight on to typing the number.
    setTimeout(() => numberRef.current?.focus(), 0);
  }

  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  }

  function options() {
    return [...(listRef.current?.querySelectorAll('[role="option"]') ?? [])];
  }

  function handleSearchKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      options()[0]?.focus();
    } else if (event.key === "Enter") {
      // Enter in the search must not submit the surrounding form.
      event.preventDefault();
      if (matches[0]) choose(matches[0]);
    }
  }

  function handleOptionKeyDown(event, index) {
    const items = options();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[Math.min(index + 1, items.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) event.currentTarget.closest("[data-phone-picker]")?.querySelector("input")?.focus();
      else items[index - 1]?.focus();
    }
  }

  function handleNumberChange(event) {
    event.target.value = event.target.value.replace(/\D/g, "");
    onChange?.(event);
  }

  return (
    <div
      className={cn(
        "flex h-10 w-full items-stretch rounded-input border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        ariaInvalid && "border-destructive ring-3 ring-destructive/20 focus-within:border-destructive",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <input ref={codeRef} type="hidden" name={countryCodeName} value={country.dialCode} />

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={`Country code: ${country.name} ${country.dialCode}. Change country code`}
          className="flex shrink-0 items-center gap-1.5 rounded-l-input border-r border-input px-3 text-body whitespace-nowrap text-text-primary outline-none hover:bg-muted focus-visible:bg-muted"
        >
          <span aria-hidden="true" className="text-base leading-none">
            {country.flag}
          </span>
          <span aria-hidden="true" className="tabular-nums">
            {country.dialCode}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-2" data-phone-picker>
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search country or code"
              aria-label="Search countries"
              aria-controls={listboxId}
              autoComplete="off"
              className="h-9 pl-9"
            />
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="Countries"
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {matches.length === 0 ? (
              <p className="px-3 py-4 text-center text-small text-text-secondary">No country found.</p>
            ) : (
              matches.map((item, index) => {
                const selected = item.iso === country.iso && item.dialCode === country.dialCode;
                return (
                  <button
                    key={item.iso}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(item)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                      selected && "bg-brand/10"
                    )}
                  >
                    <span aria-hidden="true" className="text-base leading-none">
                      {item.flag}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 text-small text-text-secondary tabular-nums">{item.dialCode}</span>
                    {selected ? <Check className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Input
        ref={numberRef}
        id={id}
        name={name}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="tel-national"
        required={required}
        disabled={disabled}
        defaultValue={defaultValue}
        onChange={handleNumberChange}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="h-full min-w-0 flex-1 rounded-l-none rounded-r-input border-0 bg-transparent focus-visible:border-0 focus-visible:ring-0"
        {...props}
      />
    </div>
  );
}
