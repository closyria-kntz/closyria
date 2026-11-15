/**
 * Runs the reads all at once on the pool, one after another in a transaction: a transaction is one connection, and
 * pg sends nothing while a query runs (pg 8 warns, pg 9 refuses). Each read is a function, so none starts early.
 * A Drizzle transaction is told apart by its `rollback`.
 */
export async function readAll<T extends readonly (() => PromiseLike<unknown>)[]>(
  db: object,
  reads: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  type Results = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
  if (!("rollback" in db)) return (await Promise.all(reads.map((read) => read()))) as Results;
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as Results;
}
