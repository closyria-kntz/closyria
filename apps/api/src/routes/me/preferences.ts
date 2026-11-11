import { and, eq, isNull, schema, sql } from "@closyria/db";
import {
  MAX_SEEN_TIPS,
  type PreferencesView,
  preferencesPatchSchema,
  preferencesViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";

const invalidRequest = { error: "invalid_request" } as const;
const viewResponse = {
  description: "What her account remembers",
  content: { "application/json": { schema: preferencesViewSchema } },
};

const getRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/preferences",
    summary: "Her closed tips and whether the first-opening discovery is done",
    description:
      "An account that already keeps articles (any, trash included) and never saw the discovery is marked done on " +
      "this read: the discovery is for new accounts only.",
    responses: { 200: viewResponse },
  }),
  "user",
);

const patchRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/preferences",
    summary: "Close tips, finish the discovery",
    description:
      `\`seenTips\` are added to the closed ones (once each, the ${MAX_SEEN_TIPS} latest kept); \`onboarded: true\` ` +
      "marks the discovery done (the first date stays).",
    request: { body: { required: true, content: { "application/json": { schema: preferencesPatchSchema } } } },
    responses: {
      200: viewResponse,
      400: {
        description: "Invalid body (invalid_request)",
        content: { "application/json": { schema: wardrobeErrorSchema } },
      },
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

export function preferencesRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const columns = { seenTips: schema.user.seenTips, onboardedAt: schema.user.onboardedAt };
  const toView = (row: { seenTips: string[]; onboardedAt: Date | null } | undefined): PreferencesView => {
    if (!row) throw new Error("preferences: signed-in user not found");
    return { seenTips: row.seenTips, onboardedAt: row.onboardedAt?.toISOString() ?? null };
  };

  return app
    .openapi(getRoute, async (c) => {
      const userId = userIdOf(c);
      // Existing accounts (articles kept before the discovery existed, or brought by an anonymous merge) are done.
      await db
        .update(schema.user)
        .set({ onboardedAt: now() })
        .where(
          and(
            eq(schema.user.id, userId),
            isNull(schema.user.onboardedAt),
            sql`exists (select 1 from ${schema.items} where ${schema.items.userId} = ${userId})`,
          ),
        );
      const [row] = await db.select(columns).from(schema.user).where(eq(schema.user.id, userId));
      return c.json(toView(row), 200);
    })
    .openapi(patchRoute, async (c) => {
      const userId = userIdOf(c);
      const { seenTips, onboarded } = c.req.valid("json");
      // The union keeps each tip once at its first place; past the cap, the oldest are forgotten.
      const tips = seenTips
        ? sql`(select coalesce(array_agg(tip order by first_at), '{}'::text[]) from (
              select tip, min(pos) as first_at
                from unnest(${schema.user.seenTips} || ${sql.param(seenTips)}::text[]) with ordinality as u(tip, pos)
               group by tip order by first_at desc limit ${MAX_SEEN_TIPS}) kept)`
        : undefined;
      const [row] = await db
        .update(schema.user)
        .set({
          ...(tips ? { seenTips: tips } : {}),
          ...(onboarded ? { onboardedAt: sql`coalesce(${schema.user.onboardedAt}, ${now()})` } : {}),
        })
        .where(eq(schema.user.id, userId))
        .returning(columns);
      return c.json(toView(row), 200);
    });
}
