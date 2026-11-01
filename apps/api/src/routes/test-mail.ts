import type { MailMessage } from "@closyria/auth";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { type AccessEnv, defineAccess } from "../access";

/** The memory mailer's messages, read by the browser tests to sign in with a code. */
export type TestMailDeps = { messages: readonly MailMessage[] };

const testEmailsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/test/emails",
    summary: "E-mails kept in memory (APP_ENV=test only)",
    description:
      "Exists only when APP_ENV=test, where the API runs on the memory mailer: the browser tests read their " +
      "sign-in codes here. Never registered in development, on dev.closyria.com or in prod.",
    request: { query: z.object({ to: z.email() }) },
    responses: {
      200: {
        description: "Messages sent to this address, oldest first",
        content: {
          "application/json": {
            schema: z.object({
              messages: z.array(z.object({ to: z.string(), subject: z.string(), text: z.string() })),
            }),
          },
        },
      },
    },
  }),
  "public",
);

export function testMailRoutes(deps: TestMailDeps) {
  return new OpenAPIHono<AccessEnv>().openapi(testEmailsRoute, (c) => {
    const { to } = c.req.valid("query");
    const messages = deps.messages
      .filter((message) => message.to === to)
      .map(({ to, subject, text }) => ({ to, subject, text }));
    return c.json({ messages }, 200);
  });
}
