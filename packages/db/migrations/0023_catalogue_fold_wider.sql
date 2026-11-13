-- `catalog_fold` covers the lowercase letters of Latin-1 and Latin Extended-A (« Šimić » -> « simic », « Łódź » ->
-- « lodz », « Straße » -> « strasse »), as `searchTerms` folds the words of a search in the API. The search index
-- is rebuilt with the new function.
CREATE OR REPLACE FUNCTION catalog_fold(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT replace(replace(replace(replace(replace(
  translate(lower(input),
    'àáâãäåçèéêëìíîïðñòóôõöøùúûüýÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĵķĸĺļľŀłńņňŋōŏőŕŗřśŝşšţťŧũūŭůűųŵŷźżžſ',
    'aaaaaaceeeeiiiidnoooooouuuuyyaaaccccddeeeeegggghhiiiiijkklllllnnnnooorrrsssstttuuuuuuwyzzzs'),
  'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'), 'ĳ', 'ij'), 'þ', 'th') $$;--> statement-breakpoint
REINDEX INDEX "products_search_idx";
