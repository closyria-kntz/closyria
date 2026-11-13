# Catalogue « Découvrir » — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un catalogue d'articles à parcourir dans Découvrir (articles collés + catalogues Shopify importés), avec filtres, fiche, « Je le veux », signalements et administration.

**Architecture:** Les `products` existants deviennent le catalogue : visibles si leur boutique est publiée, non masqués, non retirés, avec photo et prix. Le worker importe chaque nuit les boutiques Shopify activées (même écriture que la capture d'un lien) et classe chaque produit (catégorie, couleur) par une fonction pure. L'API expose le catalogue aux personnes connectées ; l'admin valide, classe et modère.

**Tech Stack:** Hono + zod-openapi, Drizzle (migration 0021), pg-boss (worker), Next 16, next-intl, Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-13-catalogue-decouvrir.md`

## Global Constraints

- Textes : « Je le veux », « Dans tes envies », « Voir chez {boutique} », « Ajouter à une liste », « Partager », « Aimé par {n} personnes » (seulement si n ≥ 3), « Ta taille en stock », « Tu as déjà quelque chose de proche », « De la même boutique », « Dans le même style », « Signaler », motifs « Pas de la mode » / « Contenu choquant » / « Autre », « Merci, on regarde. », « Aucun article avec ces filtres. », « Effacer les filtres », « Mes tailles », admin « À valider », « Valider », « Refuser », « Importer tout le catalogue », « À classer », « Signalements », « Masquer du catalogue », « Garder ».
- Valeurs de boutique : `made_in_france`, `second_hand`, `eco`, `free_returns` (libellés « Made in France », « Seconde main », « Éco-responsable », « Retours gratuits »).
- Tailles par profil : hauts, bas, chaussures, chacune facultative (texte ≤ 10 caractères, comparaison sans casse ni espaces).
- Limites : « proche » ≤ 3, « même boutique » ≤ 8, « même style » ≤ 8 ; pages de 24 articles ; import 1 fois par nuit par boutique, 1 requête à la fois par boutique, pause 1 s entre pages, 250 produits par page, arrêt au premier refus (robots.txt, 4xx/5xx répétés) avec `last_import_error`.
- Confidentialité : jamais qui a collé ou aime ; « Aimé par » = agrégat ≥ 3.
- Visibilité : boutique `published`, `products.hidden_at` nul, `products.removed_at` nul, au moins une image et un prix.
- Mêmes règles que la refonte (jetons, clair/sombre, axe, 44 px, code anglais / interface française, Zod aux frontières, commits `closyria-kntz` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, ports interdits, pas de `pkill -f`/`git stash` nu).

## Review Focus

1. Une boutique Shopify bloque l'import en cours (429 / robots.txt) : rien n'est supprimé, l'erreur s'affiche en admin, la nuit suivante réessaie — test en Task 2.
2. Un article importé disparaît de la boutique alors qu'une utilisatrice l'a en envie : il quitte le catalogue mais reste dans ses envies, avec sa fiche — test en Task 2.
3. Filtres combinés + « Ma taille en stock » sans tailles dans le profil : le filtre est grisé avec « Ajoute tes tailles » (lien vers Mes tailles), pas de liste vide inexpliquée — test en Task 5.
4. Un compte voit « Aimé par 2 personnes » : jamais (seuil 3) ; aucun nom dans les réponses — test en Task 3.
5. Retour arrière depuis une fiche du catalogue : position et filtres retrouvés — test en Task 5.

---

### Task 1: Données, schémas et fonctions de classement

**Files:** migration `packages/db/migrations/0021_catalogue.sql` (générée, renommée) + test `packages/testing/src/migration-0021.integration.test.ts` ; `packages/db/src/schema/{catalog,wardrobe}.ts` ; `packages/shared/src/catalogue.ts` (+ test) ; `packages/shared/src/classify.ts` (+ test) ; `packages/shared/src/index.ts`.

**Interfaces — Produces :**
- DB : `shops.values text[] default '{}'`, `shops.import_enabled bool default false`, `shops.last_import_at`, `shops.last_import_error text` ; `products.hidden_at`, `products.removed_at` (timestamptz) ; `products.category_source` (`auto|admin`, défaut `auto`) ; table `product_reports` (`id`, `product_id` cascade, `user_id` cascade, `reason` `not_fashion|shocking|other`, `created_at`, unique (`product_id`,`user_id`)) ; `profiles.size_top`, `profiles.size_bottom`, `profiles.size_shoes` (texte nullable ≤ 10).
- Shared : `shopValueSchema`, `catalogQuerySchema` ({ q?, category?, color?, priceMin?, priceMax?, mySize?: boolean, shop?, values?: ShopValue[], onSale?: boolean, isNew?: boolean, sort: "new"|"price_asc"|"price_desc"|"popular", cursor? }), `catalogCardSchema` ({ productId, name, shop: {id,name}, imageUrl, priceCents, previousPriceCents|null, currency, sizeInStock: boolean|null, wanted: boolean }), `catalogPageSchema` ({ items, nextCursor|null }), `catalogDetailSchema` (card + images[], sizes[{label, available}], likes: number|null, myItem: {itemId, stage}|null, close[], sameShop[], sameStyle[]), `reportInputSchema`, `profileSizesSchema`.
- `classify({ productType, tags, options, name }, reference: { categories: {id, keywords[]}[], colors: {id, keywords[]}[] }): { categoryId: string|null; colorId: string|null }` — mots-clés comparés sans accents ni casse, sur le mot entier ; priorité : type de produit > étiquettes > nom ; couleur : option « Couleur/Color » > étiquettes > nom.
- `sizeMatches(profileSize: string|null, available: string[]): boolean|null` (null si pas de taille de profil) et `sizeKindOf(categorySlug): "top"|"bottom"|"shoes"|null`.

- [x] Tests d'abord : `classify` (« Robe à carreaux » → robe ; type « Pull » → pull ; option Color « Bordeaux » → bordeaux ; « T-shirt écru » ; rien → null/null) ; `sizeMatches` (« m » vs [« S »,« M »] → true ; « 38 » vs [« 36 »] → false ; null → null) ; migration (valeurs par défaut, contrainte de motif, unicité du signalement).
- [x] Implémenter, relancer, `pnpm typecheck`, commit « feat(catalogue): données et classement ».

### Task 2: Import Shopify et classement à la capture

**Files:** `apps/worker/src/catalogue/import-shopify.ts` (+ test d'intégration), `apps/worker/src/capture/queues.ts` (file `catalogue-import`, planification nocturne 03:00 Europe/Paris, une boutique à la fois), `apps/worker/src/capture/run-capture.ts` (appel à `classify` après capture), `packages/extract/src/shopify.ts` si besoin (schéma de `/products.json`).

**Interfaces — Produces :** `importShopifyCatalog(deps, shopId): Promise<{ created: number; updated: number; removed: number; error: string|null }>` ; écrit produits, tailles, images comme la capture ; produits absents de l'import complet → `removed_at = now` (remis à nul s'ils reviennent) ; ne touche jamais aux `items`.

- [x] Tests d'intégration d'abord (serveur Shopify factice) : 2 pages → produits créés, classés ; second import avec un produit de moins → `removed_at` posé, envie existante intacte ; prix changé → mis à jour ; 429 / robots.txt interdit → `last_import_error`, rien supprimé, 1 seule requête par boutique à la fois, pause entre pages respectée (horloge injectée).
- [x] Implémenter, relancer, commit « feat(catalogue): import Shopify ».

### Task 3: API du catalogue

**Files:** `apps/api/src/catalog/catalogue.ts` (requêtes), `apps/api/src/routes/catalogue.ts` (+ test d'intégration), montage dans `app.ts`.

**Interfaces — Produces :** `GET /api/catalog` (session requise ; `catalogQuerySchema` → `catalogPageSchema`, 24 par page, curseur stable par tri) ; `GET /api/catalog/{productId}` (`catalogDetailSchema` ; 404 si non visible) ; `POST /api/catalog/{productId}/report` (`reportInputSchema`, 204, idempotent, limiteur 20/heure). `likes` = nombre d'items non supprimés sur ce produit (toutes utilisatrices), `null` si < 3. `close` = ses items Reçu/Dans mon dressing de même catégorie et couleur (≤ 3). `wanted`/`myItem` selon ses propres items. Recherche texte sur nom, boutique, catégorie, couleur (index trigramme ou tsvector, au choix, justifié dans le rapport).

- [x] Tests d'abord : visibilité (boutique non publiée, masqué, retiré, sans image → absent) ; chaque filtre et tri ; « Ma taille en stock » ; pagination sans doublon ; `likes` null à 2 et 3 à 3, aucune donnée d'une autre personne ; `close` limité à son dressing ; signalement idempotent ; 401 sans session.
- [x] Implémenter, relancer, commit « feat(catalogue): API ».

### Task 4: Administration du catalogue

**Files:** `apps/api/src/routes/admin/{shops,catalogue}.ts` (+ tests), pages admin `apps/web/src/app/admin/(shell)/boutiques/[id]/*`, nouvelles pages `admin/(shell)/catalogue/a-classer` et `admin/(shell)/catalogue/signalements`, `nav.ts` admin, `fr.json` (`Admin.*`).

**Interfaces — Produces :** `POST /api/admin/shops/{id}/publish|refuse` ; `PATCH /api/admin/shops/{id}` accepte `values`, `importEnabled` ; `POST /api/admin/shops/{id}/import` (lance un import maintenant) ; `GET /api/admin/catalogue/unclassified` + `PATCH /api/admin/products/{id}/classification` (`{ categoryId, colorId, applyToShopType?: boolean }`, `category_source = admin`) ; `GET /api/admin/catalogue/reports` + `POST /api/admin/products/{id}/hide|keep`. Tout est audité.

- [x] Tests d'abord (intégration + e2e admin) : valider une boutique rend ses produits visibles ; valeurs enregistrées ; import lancé ; classer un article (et « Appliquer aux articles du même type ») ; masquer un signalé le retire du catalogue sans toucher aux envies ; accès admin seulement ; audit.
- [x] Implémenter, relancer, commit « feat(catalogue): administration ».

### Task 5: Découvrir et fiche du catalogue

**Files:** `apps/web/src/app/(app)/decouvrir/page.tsx` et composants `catalogue-grid.tsx`, `catalogue-filters.tsx`, `catalogue-card.tsx` ; nouvelle page `apps/web/src/app/(app)/decouvrir/[productId]/page.tsx` + `catalogue-sheet.tsx` ; `apps/web/src/lib/catalogue-client.ts` ; `fr.json` (`Discover.*`) ; e2e `e2e/tests/catalogue.spec.ts`.

**Interfaces — Consumes :** API Task 3 ; ShareSheet ; création d'envie existante (« Je le veux » = même appel que garder un produit) ; ajout à une liste existant.

- [x] e2e d'abord (3 appareils, axe clair/sombre) : la une, la grille, la recherche, chaque filtre (dont « Ma taille en stock » sans tailles → grisé + « Ajoute tes tailles »), tri, défilement par pages, « Je le veux » (cœur plein, article dans Mes articles), fiche (tailles, « Aimé par », proche, même boutique, même style, Partager, Ajouter à une liste, Voir chez), « Signaler » + « Merci, on regarde. », retour arrière qui garde filtres et position, écran vide.
- [x] Implémenter (filtres dans l'adresse pour le retour arrière ; même modèle « Filtres et tri » que Mes articles), relancer, commit « feat(catalogue): Découvrir ».

### Task 6: Mes tailles

**Files:** API profils (`apps/api/src/routes/me/profiles.ts` + test : lecture/écriture `sizeTop/sizeBottom/sizeShoes`), page `apps/web/src/app/(app)/reglages/tailles/page.tsx` (+ ligne « Mes tailles » dans Compte), `fr.json`, e2e.

- [x] Tests d'abord : enregistrer et relire les tailles d'un profil ; un autre profil garde les siennes ; Compte → « Mes tailles » ; après saisie, « Ma taille en stock » s'active dans Découvrir et la fiche met sa taille en avant.
- [x] Implémenter, relancer, suite e2e complète, docs (spec § « Décisions de construction », plan coché), commit « feat(catalogue): mes tailles ».
