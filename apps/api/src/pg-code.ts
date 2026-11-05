/** Postgres error code (`23503` foreign key, `23505` unique…), through Drizzle's wrapping. */
export function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}
