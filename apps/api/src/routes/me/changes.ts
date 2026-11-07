import { schema, sql } from "@closyria/db";
import { changesSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";

const getRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/changes",
    summary: "A fingerprint of her data",
    description:
      "Asked every few seconds by an open page: when the stamp differs from the previous one, something changed " +
      "(on another device or tab) and the page reads its data again.",
    responses: {
      200: { description: "The current stamp", content: { "application/json": { schema: changesSchema } } },
    },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

/**
 * The whole rows, not an `updated_at`: some tables have none, and some writes (a profile deleted, its items moved)
 * do not bump it. Her data is small; one indexed query per open page every few seconds.
 */
export async function changesStamp(db: WardrobeDeps["db"], userId: string): Promise<string> {
  const rowsOf = (alias: string) =>
    sql.raw(`coalesce(md5(string_agg(${alias}::text, ',' order by ${alias}::text)), '')`);
  const result = await db.execute<{ stamp: string }>(sql`
    select md5(concat_ws('|',
      (select ${rowsOf("i")} from ${schema.items} i where i.user_id = ${userId}),
      (select coalesce(max(p.updated_at)::text, '') from ${schema.items} i
         join ${schema.products} p on p.id = i.product_id where i.user_id = ${userId}),
      (select ${rowsOf("e")} from ${schema.itemEvents} e
         join ${schema.items} i on i.id = e.item_id where i.user_id = ${userId}),
      (select ${rowsOf("m")} from ${schema.itemMedia} m
         join ${schema.items} i on i.id = m.item_id where i.user_id = ${userId}),
      (select ${rowsOf("it")} from ${schema.itemTags} it
         join ${schema.items} i on i.id = it.item_id where i.user_id = ${userId}),
      (select ${rowsOf("p")} from ${schema.profiles} p where p.user_id = ${userId}),
      (select ${rowsOf("w")} from ${schema.wishlists} w where w.user_id = ${userId}),
      (select ${rowsOf("wi")} from ${schema.wishlistItems} wi
         join ${schema.wishlists} w on w.id = wi.wishlist_id where w.user_id = ${userId}),
      (select ${rowsOf("t")} from ${schema.tags} t where t.user_id = ${userId}),
      (select ${rowsOf("l")} from ${schema.loveLevels} l where l.user_id = ${userId}),
      (select ${rowsOf("b")} from ${schema.budgets} b where b.user_id = ${userId})
    )) as stamp`);
  const stamp = result.rows[0]?.stamp;
  if (!stamp) throw new Error("changes stamp: no row");
  return stamp;
}

export function changesRoutes(deps: WardrobeDeps) {
  const app = new OpenAPIHono<AccessEnv>();
  return app.openapi(getRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ stamp: await changesStamp(deps.db, userIdOf(c)) }, 200);
  });
}
