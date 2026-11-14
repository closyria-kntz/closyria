import { type Database, sql } from "@closyria/db";
import type { ShopCard, ShopDirectory } from "@closyria/shared";
import {
  type Caller,
  inCatalogue,
  isPrivileged,
  partnerShop,
  shopInCatalogue,
  showsShopMedia,
  visibleTo,
} from "./catalogue";
import { catalogImageUrl } from "./product-view";

type Row = {
  id: string;
  name: string;
  domain: string;
  item_count: number;
  known_count: number | null;
  image_id: string | null;
};

const byCountThenName = (a: ShopCard, b: ShopCard) =>
  b.itemCount - a.itemCount || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1);

/**
 * The « boutique de la semaine »: the shop of « Découvrir » (`shopInCatalogue`) with a domain featured most recently,
 * or null.
 */
export async function featuredShopId(db: Database): Promise<string | null> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select s.id from shops s
    where ${shopInCatalogue} and s.featured_at is not null
      and exists (select 1 from shop_domains d where d.shop_id = s.id)
    order by s.featured_at desc, s.id limit 1`);
  return rows[0]?.id ?? null;
}

/**
 * The shops of « Découvrir »: published, not merged, not a « grande enseigne », with a domain to open. Only shop
 * facts leave this function (name, main domain, how many of its articles « Découvrir » shows, one photo of the newest
 * of them, « Nouveautés » order, only for a shop with an agreement or an admin / « Testeuse »), never who pasted them. The featured one is the shop whose `featured_at` is the most recent; it is left out of `shops`.
 */
export async function loadShopDirectory(db: Database, caller: Caller): Promise<ShopDirectory> {
  // Catalogue conforme: she counts only what « Découvrir » shows her, and a tile has a shop's photo only when the
  // shop agreed (or she is an admin / « Testeuse »).
  const viewer = { privileged: await isPrivileged(db, caller) };
  const { rows } = await db.execute<Row>(sql`
    select s.id, s.name, d.domain,
      (select count(*)::int from products p where p.shop_id = s.id and ${inCatalogue} and ${visibleTo(viewer)})
        as item_count,
      -- « {n} articles chez elle » on a shop without agreement: everything Closyria knows of its catalogue.
      case when ${partnerShop} then null
        else (select count(*)::int from products p where p.shop_id = s.id and ${inCatalogue}) end as known_count,
      (select pi.id from products p join product_images pi on pi.product_id = p.id
        where p.shop_id = s.id and ${inCatalogue} and ${showsShopMedia(viewer)}
        order by p.published_at desc nulls last, p.shop_rank nulls last, p.id, pi.position, pi.id limit 1) as image_id
    from shops s
    join lateral (
      select domain from shop_domains where shop_id = s.id order by length(domain), domain limit 1
    ) d on true
    where ${shopInCatalogue}`);
  const featuredId = await featuredShopId(db);
  const featuredRow = rows.find((r) => r.id === featuredId);
  const card = (r: Row): ShopCard => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    itemCount: Number(r.item_count),
    knownCount: r.known_count === null ? null : Number(r.known_count),
    imageUrl: r.image_id ? catalogImageUrl(r.image_id) : null,
  });
  return {
    featured: featuredRow ? card(featuredRow) : null,
    shops: rows
      .filter((r) => r !== featuredRow)
      .map(card)
      .sort(byCountThenName),
  };
}
