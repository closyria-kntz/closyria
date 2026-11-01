import { inject } from "vitest";
import { createDatabaseFromTemplate, type TestDatabase, type TestServerInfo } from "./postgres";

declare module "vitest" {
  export interface ProvidedContext {
    closyriaTestServer: TestServerInfo;
  }
}

/**
 * A fresh, migrated database for one test file, copied from the template that the package's
 * globalSetup (`@closyria/testing/global-setup`) prepared. Drop it with `stop()` in afterAll.
 */
export function createTestDatabase(): Promise<TestDatabase> {
  const server = inject("closyriaTestServer");
  if (!server)
    throw new Error("No test server: add @closyria/testing's global-setup to this package's vitest.config.ts");
  return createDatabaseFromTemplate(server);
}
