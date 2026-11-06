import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readdir, readFile, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrateTestDatabase, startTestDatabase, type TestDatabase } from "@closyria/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Sauvegardes automatiques (plan docs/plans/2026-11-06-sauvegardes-prod.md, tâche 1) : the bash scripts against a
// disposable database and a local folder standing in for the OVH bucket.
const run = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), "../deploy/backup");
const SCRATCH = "closyria_restore_check_test";

let database: TestDatabase;
let work: string;
let store: string;
let identity: string;
let recipient: string;

async function psql(sql: string, url = database.url): Promise<string> {
  const { stdout } = await run("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", url, "-c", sql]);
  return stdout.trim();
}

type Result = { code: number; out: string };

async function script(name: string, args: string[], env: Record<string, string> = {}, bin = BIN): Promise<Result> {
  try {
    const { stdout, stderr } = await run(join(bin, name), args, {
      env: {
        PATH: process.env.PATH ?? "",
        DATABASE_URL: database.url,
        BACKUP_STORE: store,
        BACKUP_AGE_RECIPIENT: recipient,
        BACKUP_AGE_IDENTITY: identity,
        BACKUP_ADMIN_URL: database.url,
        BACKUP_SCRATCH_DB: SCRATCH,
        ...env,
      },
    });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, out: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

const copies = async (): Promise<string[]> => {
  try {
    return (await readdir(join(store, "dev"))).sort();
  } catch {
    return [];
  }
};
const scratchExists = async () => (await psql(`select count(*) from pg_database where datname = '${SCRATCH}'`)) === "1";

beforeAll(async () => {
  database = await startTestDatabase();
  await migrateTestDatabase(database.url);
  work = await mkdtemp(join(tmpdir(), "closyria-backup-test-"));
  identity = join(work, "backup.key");
  await run("age-keygen", ["-o", identity]);
  recipient = (await run("age-keygen", ["-y", identity])).stdout.trim();
  await psql(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ('u-secret', 'Test', 'secret-de-test@example.com', true, now(), now())`,
  );
}, 120_000);

afterAll(async () => {
  await database?.stop();
  if (work) await rm(work, { recursive: true, force: true });
});

beforeEach(async () => {
  store = await mkdtemp(join(work, "store-"));
});

describe("closyria-backup et closyria-backup-check", () => {
  it("sauvegarde puis vérification : la copie est chiffrée et se restaure", async () => {
    const saved = await script("closyria-backup", ["dev"]);
    expect(saved.code, saved.out).toBe(0);
    const files = await copies();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^closyria-dev-\d{8}T\d{6}Z\.dump\.age$/);
    const bytes = await readFile(join(store, "dev", files[0] ?? ""));
    expect(bytes.subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    expect(bytes.includes("secret-de-test@example.com")).toBe(false);

    const checked = await script("closyria-backup-check", ["dev"]);
    expect(checked.code, checked.out).toBe(0);
    expect(checked.out).toMatch(/^ok: dev\/closyria-dev-.+ restored, \d+ tables$/m);
    expect(await scratchExists()).toBe(false);
  }, 60_000);

  it("une copie de plus de 6 h est refusée (une nuit manquée alerte dès le matin)", async () => {
    expect((await script("closyria-backup", ["dev"])).code).toBe(0);
    const file = join(store, "dev", (await copies())[0] ?? "");
    const old = new Date(Date.now() - 7 * 3600 * 1000);
    await utimes(file, old, old);
    const checked = await script("closyria-backup-check", ["dev"]);
    expect(checked.code).not.toBe(0);
    expect(checked.out).toContain("older than 6 h");
  }, 60_000);

  it("une table comptée absente de la vraie base (prod du chantier 0) est sautée", async () => {
    await psql("alter table public.products rename to products_hidden");
    try {
      expect((await script("closyria-backup", ["dev"])).code).toBe(0);
      const checked = await script("closyria-backup-check", ["dev"]);
      expect(checked.code, checked.out).toBe(0);
      expect(checked.out).toMatch(/^ok: /m);
    } finally {
      await psql("alter table public.products_hidden rename to products");
    }
  }, 60_000);

  it("lib.sh absent : les scripts échouent au lieu de passer", async () => {
    const bin = await mkdtemp(join(work, "bin-"));
    for (const name of ["closyria-backup", "closyria-backup-check"]) await copyFile(join(BIN, name), join(bin, name));
    const saved = await script("closyria-backup", ["dev"], {}, bin);
    expect(saved.code).not.toBe(0);
    const checked = await script("closyria-backup-check", ["dev"], {}, bin);
    expect(checked.code).not.toBe(0);
    expect(checked.out).not.toContain("ok:");
  });

  it("dev et prod vérifiés en même temps : chacun sa base jetable", async () => {
    expect((await script("closyria-backup", ["dev"])).code).toBe(0);
    expect((await script("closyria-backup", ["prod"])).code).toBe(0);
    const [dev, prod] = await Promise.all(
      (["dev", "prod"] as const).map((env) => script("closyria-backup-check", [env], { BACKUP_SCRATCH_DB: "" })),
    );
    expect(dev?.code, dev?.out).toBe(0);
    expect(prod?.code, prod?.out).toBe(0);
    expect(await psql("select count(*) from pg_database where datname like 'closyria_restore_check%'")).toBe("0");
  }, 120_000);

  it("S3 : envoi avec MD5 et sommes de contrôle CRC désactivées (OVH)", async () => {
    const bin = await mkdtemp(join(work, "fake-aws-"));
    const calls = join(bin, "calls.log");
    await writeFile(
      join(bin, "aws"),
      `#!/usr/bin/env bash\necho "$AWS_REQUEST_CHECKSUM_CALCULATION $AWS_RESPONSE_CHECKSUM_VALIDATION $*" >>"${calls}"\n`,
    );
    await chmod(join(bin, "aws"), 0o755);
    // The fake aws stores nothing, so the size check fails afterwards: only the upload call matters here.
    await script("closyria-backup", ["dev"], {
      BACKUP_STORE: "s3://closyria-backups",
      S3_ENDPOINT: "https://s3.sbg.io.cloud.ovh.net",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    });
    const log = await readFile(calls, "utf8");
    const put = log.split("\n").find((line) => line.includes("put-object")) ?? "";
    expect(put).toMatch(/^when_required when_required /);
    expect(put).toContain("--content-md5");
    expect(put).toContain("--endpoint-url https://s3.sbg.io.cloud.ovh.net");
  }, 60_000);

  it("aucune copie : la vérification échoue", async () => {
    const checked = await script("closyria-backup-check", ["dev"]);
    expect(checked.code).not.toBe(0);
    expect(checked.out).toContain("no backup");
  });

  it("pg_dump en échec : pas de copie", async () => {
    const missing = database.url.replace(/(postgresql:\/\/[^/]*\/)[^?]*/, "$1closyria_does_not_exist");
    const saved = await script("closyria-backup", ["dev"], { DATABASE_URL: missing });
    expect(saved.code).not.toBe(0);
    expect(await copies()).toEqual([]);
  });

  it("une copie tronquée est refusée et la base jetable est supprimée", async () => {
    expect((await script("closyria-backup", ["dev"])).code).toBe(0);
    const file = join(store, "dev", (await copies())[0] ?? "");
    await truncate(file, Math.floor((await stat(file)).size / 2));
    const checked = await script("closyria-backup-check", ["dev"]);
    expect(checked.code).not.toBe(0);
    expect(await scratchExists()).toBe(false);
  }, 60_000);

  it("une table manquante dans la copie est signalée", async () => {
    expect((await script("closyria-backup", ["dev"])).code).toBe(0);
    await psql("create table public.added_after_backup (id int)");
    try {
      const checked = await script("closyria-backup-check", ["dev"]);
      expect(checked.code).not.toBe(0);
      expect(checked.out).toContain("added_after_backup");
      expect(await scratchExists()).toBe(false);
    } finally {
      await psql("drop table public.added_after_backup");
    }
  }, 60_000);
});

describe("closyria-backup-alert", () => {
  it("l'alerte sans Brevo écrit le message", async () => {
    const sent = await script("closyria-backup-alert", ["closyria-backup@dev.service"], {
      BACKUP_ALERT_TO: "x@example.com",
    });
    expect(sent.code, sent.out).toBe(0);
    expect(sent.out).toContain("closyria-backup@dev.service");
  });
});
