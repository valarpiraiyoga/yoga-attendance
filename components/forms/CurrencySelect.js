"use client";

import SearchSelect from "@/components/forms/SearchSelect";
import { DEFAULT_CURRENCY, currencyLabel, listCurrencies, searchCurrencies } from "@/lib/currencies";

// Built once: the list is fixed. "🇮🇳 INR — Indian Rupee (₹)".
const OPTIONS = listCurrencies().map((currency) => ({
  value: currency.code,
  label: currency.label,
  leading: currency.flag,
  search: currency.search,
}));

function filterGroups(groups, query) {
  const kept = new Set(
    searchCurrencies(
      groups[0].options.map((option) => ({ code: option.value, search: option.search })),
      query
    ).map((currency) => currency.code)
  );
  return [{ ...groups[0], options: groups[0].options.filter((option) => kept.has(option.value)) }];
}

/**
 * The centre's currency picker (Center Regional Settings): a searchable list of
 * ISO 4217 currencies, searchable by code, name or symbol. Submits `name`
 * ("currency") as the code ("INR"), never the symbol. Choosing a currency only
 * changes how amounts are displayed and which currency NEW memberships are
 * priced in - it never converts an existing amount.
 */
export default function CurrencySelect({ defaultValue = DEFAULT_CURRENCY, ...props }) {
  const known = OPTIONS.some((option) => option.value === defaultValue);
  const options = known ? OPTIONS : [{ value: defaultValue, label: currencyLabel(defaultValue), search: defaultValue.toLowerCase() }, ...OPTIONS];

  return (
    <SearchSelect
      name="currency"
      groups={[{ options }]}
      filter={filterGroups}
      defaultValue={defaultValue}
      placeholder="Select a currency"
      searchLabel="Search currencies"
      searchPlaceholder="Search code, name or symbol…"
      emptyText="No currency found."
      listLabel="Currencies"
      {...props}
    />
  );
}
