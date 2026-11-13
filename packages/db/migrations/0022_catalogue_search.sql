-- Lowercase and fold accents (« Écru » -> « ecru », « cœur » -> « coeur ») for the catalogue search, with no extension.
CREATE OR REPLACE FUNCTION catalog_fold(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT replace(replace(translate(lower(input), 'àáâãäåāçćèéêëēìíîïñòóôõöøùúûüýÿ', 'aaaaaaacceeeeeiiiinoooooouuuuyy'), 'œ', 'oe'), 'æ', 'ae') $$;--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin (to_tsvector('simple'::regconfig, catalog_fold(coalesce("name", '') || ' ' || coalesce("brand", ''))));