import { type Database, sql } from "@closyria/db";
import type { ShopCard, ShopDirectory } from "@closyria/shared";
import { catalogImageUrl } from "./product-view";

type Row = {
  id: string;
  name: string;
  domain: string;
  item_count: number;
  image_id: string | null;
};

const byCountThenName = (a: ShopCard, b: ShopCard) =>
  b.itemCount - a.itemCount || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1);

/** The « boutique de la semaine »: the published, unmerged shop with a domain featured most recently, or null. */
export async function featuredShopId(db: Database): Promise<string | null> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select s.id from shops s
    where s.status = 'published' and s.merged_into_id is null and s.featured_at is not null
      and exists (select 1 from shop_domains d where d.shop_id = s.id)
    order by s.featured_at desc, s.id limit 1`);
  return rows[0]?.id ?? null;
}

/**
 * The shops of « Découvrir »: published and not merged, with a domain to open. Only shop facts leave this function
 * (name, main domain, how many products Closyria knows, one photo of the newest product that has one), never who
 * pasted them. The featured one is the shop whose `featured_at` is the most recent; it is left out of `shops`.
 */
export async function loadShopDirectory(db: Database): Promise<ShopDirectory> {
  const { rows } = await db.execute<Row>(sql`
    select s.id, s.name, d.domain,
      (select count(*)::int from products p where p.shop_id = s.id) as item_count,
      (select pi.id from products p join product_images pi on pi.product_id = p.id
        where p.shop_id = s.id
        order by p.created_at desc, p.id, pi.position, pi.id limit 1) as image_id
    from shops s
    join lateral (
      select domain from shop_domains where shop_id = s.id order by length(domain), domain limit 1
    ) d on true
    where s.status = 'published' and s.merged_into_id is null`);
  const featuredId = await featuredShopId(db);
  const featuredRow = rows.find((r) => r.id === featuredId);
  const card = (r: Row): ShopCard => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    itemCount: Number(r.item_count),
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
