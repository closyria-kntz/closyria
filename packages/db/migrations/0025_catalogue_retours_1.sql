-- Retours fondatrice n°1 (catalogue « Découvrir »): several sizes per kind in « Mes tailles » (each saved size becomes
-- a one-size list), the progress of a Shopify import on `shops`, and the size matching of « Ma taille en stock ».
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_size_top_check";--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_size_bottom_check";--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_size_shoes_check";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_top" SET DATA TYPE text[] USING (CASE WHEN btrim("size_top") <> '' THEN ARRAY[btrim("size_top")] ELSE '{}'::text[] END);--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_top" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_top" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_bottom" SET DATA TYPE text[] USING (CASE WHEN btrim("size_bottom") <> '' THEN ARRAY[btrim("size_bottom")] ELSE '{}'::text[] END);--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_bottom" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_bottom" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_shoes" SET DATA TYPE text[] USING (CASE WHEN btrim("size_shoes") <> '' THEN ARRAY[btrim("size_shoes")] ELSE '{}'::text[] END);--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_shoes" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "size_shoes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_state" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_pages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_seen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "last_import_seen" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "last_import_created" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "last_import_removed" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_import_state_check" CHECK ("shops"."import_state" IS NULL OR "shops"."import_state" IN ('queued', 'running'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_size_top_check" CHECK (cardinality("profiles"."size_top") <= 8);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_size_bottom_check" CHECK (cardinality("profiles"."size_bottom") <= 8);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_size_shoes_check" CHECK (cardinality("profiles"."size_shoes") <= 8);--> statement-breakpoint
-- The sizes a shop's label names, one comparable form each: the SQL twin of `sizeTokens` (packages/shared,
-- catalogue.ts); a test of apps/api/src/routes/catalogue.integration.test.ts checks that both agree. « 38 FR »,
-- « EU38 », « T.38 » -> 38; « S/M » -> s, m; « 38,5 », « 38 1/2 » -> 38.5; « XXL » -> 2xl; « 1XL » -> xl;
-- « W28L32 », « W 28 L 32 » -> w28, l32; plus the whole label without spaces.
CREATE OR REPLACE FUNCTION catalog_size_tokens(label text) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  WITH normal AS (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(lower(replace(label, chr(160), ' ')), '(\d)\s*,\s*(\d)', '\1.\2', 'g'),
        '(\d+)(?:\s+1/2|\s*½)(?!\d)', '\1.5', 'g'),
      '\m([wlt])\s+(?=\d)', '\1', 'g') AS text
  ), words AS (
    SELECT regexp_replace(w, '^\.+|\.+$', '', 'g') AS word
    FROM normal, regexp_split_to_table(normal.text, '[\s/()|,;+-]+') AS w
  ), tokens AS (
    SELECT regexp_replace(normal.text, '\s+', '', 'g') AS token FROM normal
    UNION
    SELECT unnest(CASE
      WHEN word ~ '^(t\.?|taille|eu|fr)?\d+(\.\d+)?(fr|eu)?$' THEN ARRAY[substring(word FROM '\d+(?:\.\d+)?')]
      WHEN word ~ '^w\d+l\d+$' THEN ARRAY[substring(word FROM '^w\d+'), substring(word FROM 'l\d+$')]
      WHEN word ~ '^x{2,}[sl]$' THEN ARRAY[(length(word) - 1)::text || 'x' || right(word, 1)]
      WHEN word ~ '^1x[sl]$' THEN ARRAY['x' || right(word, 1)]
      ELSE ARRAY[word]
    END)
    FROM words
    WHERE word <> '' AND word NOT IN ('fr', 'eu', 'eur', 'taille', 't', 'size')
  )
  SELECT coalesce(array_agg(token ORDER BY token), '{}'::text[]) FROM tokens WHERE token <> ''
$$;--> statement-breakpoint
-- « Taille unique » as shops write it: the SQL twin of `isOneSize` (TU, T.U., Taille unique, One size, OS, Unique, U;
-- digits are kept, so « U 2 » is not one).
CREATE OR REPLACE FUNCTION catalog_is_one_size(label text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(label), '[^a-z0-9]', '', 'g') IN ('tu', 'tailleunique', 'onesize', 'os', 'unique', 'u')
$$;
