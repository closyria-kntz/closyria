import { and, eq, schema, sql } from "@closyria/db";
import { budgetHistorySchema, budgetInputSchema, budgetViewSchema, wardrobeErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { type BudgetScope, budgetHistory, budgetView } from "../../wardrobe/budgets";
import type { WardrobeDeps } from "../../wardrobe/deps";
import type { Tx } from "../../wardrobe/events";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});
const json = <S extends z.ZodType>(description: string, schema: S) => ({
  description,
  content: { "application/json": { schema } },
});
const idParams = z.object({ id: z.uuid() });

type Target = "profiles" | "wishlists";

/** The five budget routes of a profile (`profiles`) or of a list (`wishlists`), spec §3.7. */
function routesOf<T extends Target>(target: T) {
  const owner = target === "profiles" ? "profile" : "list";
  const base = `/me/${target}/{id}/budget` as const;
  const notFoundContent = errorContent(`Unknown or another account's ${owner}, or no budget (not_found)`);
  const malformed = errorContent("Malformed id (invalid_request)");
  return {
    get: defineAccess(
      createRoute({
        method: "get",
        path: base,
        summary: `The budget of a ${owner}`,
        description:
          "With its current period (Europe/Paris, end exclusive) and what is already ordered in it (`spentCents`).",
        request: { params: idParams },
        responses: { 200: json("The budget", budgetViewSchema), 400: malformed, 404: notFoundContent },
      }),
      "user",
    ),
    put: defineAccess(
      createRoute({
        method: "put",
        path: base,
        summary: `Set the budget of a ${owner}`,
        description: "Creates it or replaces its amount, period and dates; a reset of a budget without period is kept.",
        request: {
          params: idParams,
          body: { required: true, content: { "application/json": { schema: budgetInputSchema } } },
        },
        responses: {
          200: json("The budget", budgetViewSchema),
          400: errorContent("Invalid body (invalid_request)"),
          404: notFoundContent,
        },
      }),
      "user",
    ),
    delete: defineAccess(
      createRoute({
        method: "delete",
        path: base,
        summary: `Remove the budget of a ${owner}`,
        request: { params: idParams },
        responses: { 204: { description: "Removed" }, 400: malformed, 404: notFoundContent },
      }),
      "user",
    ),
    history: defineAccess(
      createRoute({
        method: "get",
        path: `${base}/history`,
        summary: `Past periods of the budget of a ${owner}`,
        description: "Weekly: the 8 last weeks; monthly: the 12 last months; never before its creation. Else empty.",
        request: { params: idParams },
        responses: { 200: json("Past periods", budgetHistorySchema), 400: malformed, 404: notFoundContent },
      }),
      "user",
    ),
    reset: defineAccess(
      createRoute({
        method: "post",
        path: `${base}/reset`,
        summary: `Start the budget of a ${owner} over`,
        description: "Without period only: what was ordered before now no longer counts.",
        request: { params: idParams },
        responses: {
          200: json("The budget", budgetViewSchema),
          400: malformed,
          404: notFoundContent,
          409: errorContent("The budget has a period (budget_not_resettable)"),
        },
      }),
      "user",
    ),
  };
}

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

function scopedBudgetRoutes<T extends Target>(deps: WardrobeDeps, target: T) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const routes = routesOf(target);
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const scopeOf = (id: string): BudgetScope => (target === "profiles" ? { profileId: id } : { wishlistId: id });
  const budgetColumn = target === "profiles" ? schema.budgets.profileId : schema.budgets.wishlistId;

  /** Her profile or list, locked against its deletion (and the merge) for the transaction. */
  async function ownsTarget(tx: Tx, userId: string, id: string): Promise<boolean> {
    const table = target === "profiles" ? schema.profiles : schema.wishlists;
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.userId, userId)))
      .for("share");
    return row !== undefined;
  }

  /** Her budget of that profile or list; none when the profile or list is not hers. */
  async function findBudget(tx: Tx, userId: string, id: string) {
    const [row] = await tx
      .select()
      .from(schema.budgets)
      .where(and(eq(budgetColumn, id), eq(schema.budgets.userId, userId)));
    return row ?? null;
  }

  return app
    .openapi(routes.get, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const view = await db.transaction(async (tx) => {
        const budget = await findBudget(tx, userId, id);
        return budget && (await budgetView(tx, scopeOf(id), budget, now()));
      });
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(routes.put, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const values = {
        amountCents: input.amountCents,
        period: input.period,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
      };
      const view = await db.transaction(async (tx) => {
        if (!(await ownsTarget(tx, userId, id))) return null;
        // One budget per profile or list: a second PUT changes it (its creation date and reset are kept).
        const [budget] = await tx
          .insert(schema.budgets)
          .values({ userId, ...(target === "profiles" ? { profileId: id } : { wishlistId: id }), ...values })
          .onConflictDoUpdate({
            target: budgetColumn,
            targetWhere: sql`${budgetColumn} is not null`,
            set: { ...values, updatedAt: now() },
          })
          .returning();
        if (!budget) throw new Error("budget not written");
        return budgetView(tx, scopeOf(id), budget, now());
      });
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(routes.delete, async (c) => {
      const [deleted] = await db
        .delete(schema.budgets)
        .where(and(eq(budgetColumn, c.req.valid("param").id), eq(schema.budgets.userId, userIdOf(c))))
        .returning({ id: schema.budgets.id });
      return deleted ? c.body(null, 204) : c.json(notFound, 404);
    })
    .openapi(routes.history, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const history = await db.transaction(async (tx) => {
        const budget = await findBudget(tx, userId, id);
        return budget && (await budgetHistory(tx, scopeOf(id), budget, now()));
      });
      return history ? c.json(history, 200) : c.json(notFound, 404);
    })
    .openapi(routes.reset, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const outcome = await db.transaction(async (tx) => {
        const budget = await findBudget(tx, userId, id);
        if (!budget) return "not_found" as const;
        if (budget.period !== "none") return "not_resettable" as const;
        const at = now();
        const [reset] = await tx
          .update(schema.budgets)
          .set({ resetAt: at, updatedAt: at })
          .where(eq(schema.budgets.id, budget.id))
          .returning();
        if (!reset) throw new Error("budget not reset");
        return budgetView(tx, scopeOf(id), reset, at);
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "not_resettable") return c.json({ error: "budget_not_resettable" } as const, 409);
      return c.json(outcome, 200);
    });
}

/** Budgets of her profiles and of her lists (spec §3.7, §5.2). */
export function budgetsRoutes(deps: WardrobeDeps) {
  return new OpenAPIHono<AccessEnv>()
    .route("/", scopedBudgetRoutes(deps, "profiles"))
    .route("/", scopedBudgetRoutes(deps, "wishlists"));
}
