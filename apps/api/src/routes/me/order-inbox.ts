import { randomInt } from "node:crypto";
import { and, type Database, eq, schema } from "@closyria/db";
import {
  ORDER_INBOX_CODE_ALPHABET,
  ORDER_INBOX_CODE_LENGTH,
  orderInboxLocalPart,
  orderInboxViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { pgCode } from "../../pg-code";
import { rateLimit } from "../../rate-limit";
import { firstNameOf } from "../../wardrobe/home";

export type OrderInboxDeps = {
  db: Database;
  /** The order addresses' domain (`orderInboxDomain`). */
  domain: string;
  /** Clock of the rate limit, injectable for tests. */
  nowMs?: () => number;
};

/** « Changer d'adresse » 10 times an hour per account at most. */
const ROTATION_LIMIT = { max: 10, windowMs: 60 * 60_000 };
/** A drawn address already taken (31⁴ codes per first name): drawn again, a few times at most. */
const MAX_DRAWS = 8;

const accountRequired = { error: "account_required" } as const;
const json = (description: string) => ({
  description,
  content: { "application/json": { schema: orderInboxViewSchema } },
});
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});
const accountRequiredContent = errorContent("A guest: create an account first (account_required)");

const getRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/order-inbox",
    summary: "« Mes commandes par e-mail »: her order address",
    description: "Her active address, or null before she asked for one. Accounts only.",
    responses: { 200: json("Her address"), 403: accountRequiredContent },
  }),
  "user",
);

const postRoute = (nowMs?: () => number) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/me/order-inbox",
      summary: "Create her order address, or change it (« Changer d'adresse »)",
      description:
        "`{first name}-{4 characters}` (« commande » without a first name), from an alphabet without look-alike " +
        "characters. With an address already, it is replaced: the former one stops working at once (its e-mails " +
        "are ignored, nothing kept). Accounts only; 10 an hour.",
      middleware: [
        rateLimit<AccessEnv>(
          { ...ROTATION_LIMIT, key: (c) => `order-inbox:${c.var.session?.user.id ?? ""}` },
          (c) => c.json({ error: "rate_limited" }, 429),
          nowMs,
        ),
      ],
      responses: {
        200: json("Her new address"),
        403: accountRequiredContent,
        429: errorContent("Too many changes this hour (rate_limited)"),
      },
    }),
    "user",
  );

function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

/** Read from the table, not the session: the session may be older than her account. */
async function accountOf(db: Database, userId: string) {
  const [row] = await db
    .select({ name: schema.user.name, isAnonymous: schema.user.isAnonymous })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row && row.isAnonymous !== true ? row : null;
}

function drawCode(): string {
  let code = "";
  for (let i = 0; i < ORDER_INBOX_CODE_LENGTH; i++)
    code += ORDER_INBOX_CODE_ALPHABET[randomInt(ORDER_INBOX_CODE_ALPHABET.length)];
  return code;
}

export function orderInboxRoutes(deps: OrderInboxDeps) {
  const { db, domain } = deps;
  const address = (localPart: string) => `${localPart}@${domain}`;
  return new OpenAPIHono<AccessEnv>()
    .openapi(getRoute, async (c) => {
      const userId = userIdOf(c);
      if (!(await accountOf(db, userId))) return c.json(accountRequired, 403);
      const [row] = await db
        .select({ localPart: schema.orderInboxes.localPart })
        .from(schema.orderInboxes)
        .where(and(eq(schema.orderInboxes.userId, userId), eq(schema.orderInboxes.active, true)));
      return c.json({ address: row ? address(row.localPart) : null }, 200);
    })
    .openapi(postRoute(deps.nowMs), async (c) => {
      const userId = userIdOf(c);
      const account = await accountOf(db, userId);
      if (!account) return c.json(accountRequired, 403);
      const firstName = firstNameOf({ name: account.name, isAnonymous: false });
      for (let draw = 0; draw < MAX_DRAWS; draw++) {
        const localPart = orderInboxLocalPart(firstName, drawCode());
        try {
          // One transaction: the former address stops and the new one starts together (the partial unique index
          // allows one active address per account; an e-mail being filed holds the former one, and waits).
          await db.transaction(async (tx) => {
            await tx
              .update(schema.orderInboxes)
              .set({ active: false })
              .where(and(eq(schema.orderInboxes.userId, userId), eq(schema.orderInboxes.active, true)));
            await tx.insert(schema.orderInboxes).values({ userId, localPart });
          });
          return c.json({ address: address(localPart) }, 200);
        } catch (error) {
          // Taken (by anyone, former addresses included: never given twice), or a change at the same time: again.
          if (pgCode(error) !== "23505") throw error;
        }
      }
      throw new Error("no free order address after several draws");
    });
}
