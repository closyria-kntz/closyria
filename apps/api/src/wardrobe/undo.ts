import type { schema } from "@closyria/db";
import type { ItemBulk, ItemFields } from "@closyria/shared";

type Item = typeof schema.items.$inferSelect;

/** The item columns `setFields` can write, in a fixed order (stable grouping keys). */
export const ITEM_FIELD_KEYS = [
  "favorite",
  "sizeLabel",
  "sizeNote",
  "notes",
  "nameOverride",
  "brandOverride",
  "categoryId",
  "colorId",
  "coverMediaId",
  "pricePaidCents",
  "salePriceCents",
  "saleChannel",
] as const satisfies readonly (keyof ItemFields & keyof Item)[];
export type ItemFieldKey = (typeof ITEM_FIELD_KEYS)[number];
export type ItemFieldValues = Partial<Pick<Item, ItemFieldKey>>;

/** The defined fields of `values` that differ from the item's current ones. */
export function changedFields(item: Item, values: ItemFieldValues): ItemFieldKey[] {
  return ITEM_FIELD_KEYS.filter((key) => values[key] !== undefined && values[key] !== item[key]);
}

/** Groups `entries` by key, keeping the first-seen order of the keys and of the ids in each group. */
export function groupIds<K>(entries: { id: string; key: K }[], keyOf: (key: K) => string = String): [K, string[]][] {
  const groups = new Map<string, [K, string[]]>();
  for (const { id, key } of entries) {
    const k = keyOf(key);
    const group = groups.get(k);
    if (group) group[1].push(id);
    else groups.set(k, [key, [id]]);
  }
  return [...groups.values()];
}

/**
 * Undo of writing `values` on `items` (ruling R9): one `setFields` per distinct set of previous values, each item
 * getting back exactly the fields that changed on it. Items with nothing changed are left out.
 */
export function setFieldsUndo(items: Item[], values: ItemFieldValues): ItemBulk[] {
  const entries = items.flatMap((item) => {
    const keys = changedFields(item, values);
    if (keys.length === 0) return [];
    const previous: ItemFieldValues = Object.fromEntries(keys.map((key) => [key, item[key]]));
    return [{ id: item.id, key: previous }];
  });
  return groupIds(entries, (previous) => JSON.stringify(previous)).map(([fields, ids]) => ({
    ids,
    op: "setFields" as const,
    fields: fields as ItemFields,
  }));
}
