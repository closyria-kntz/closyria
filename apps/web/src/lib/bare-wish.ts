import type { ItemView } from "@closyria/shared";

/** A simple wish: spotted and favorite, with nothing of hers on it. Un-hearting it removes it (« Annuler » restores it). */
export function isBareWish(item: ItemView): boolean {
  return (
    item.stage === "spotted" &&
    item.favorite &&
    item.sizeLabel === null &&
    item.sizeNote === null &&
    item.notes === null &&
    item.pricePaidCents === null &&
    item.salePriceCents === null &&
    item.saleChannel === null &&
    item.nameOverride === null &&
    item.brandOverride === null &&
    item.categoryId === null &&
    item.colorId === null &&
    item.tags.length === 0 &&
    item.wishlistIds.length === 0 &&
    !item.photos.some((photo) => photo.source === "private")
  );
}
