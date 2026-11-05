# Chantier 1 — Capture et boutiques : plan d'implémentation

> **Pour les agents :** sous-skill requis : `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans`, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**But :** coller ou partager le lien d'un article donne une fiche produit partagée (nom, prix, photos, tailles) en
moins de 5 s sur les boutiques lisibles, avec une saisie manuelle pour les autres. La fondatrice gère les boutiques
et la santé des captures dans l'admin.

**Architecture :**
- `packages/extract` est du code pur : il transforme une page en fiche.
- Seul le worker sort sur Internet, avec `safeFetch` : contrôle des adresses, redirections vérifiées, limites de taille et de temps, `robots.txt`.
- L'API crée la fiche et met la capture en file d'attente (pg-boss). La page web interroge l'API jusqu'au résultat.
- Les photos sont copiées en WebP dans le stockage objet et servies par l'API.

**Stack :** celle du chantier 0 (Node 26, pnpm 12, TypeScript 7, Hono 4.13, Next 16.4, Drizzle 0.45, PostgreSQL 18,
pg-boss 12, sharp 0.35, Vitest 5, Playwright 1.64), plus `@vitest/coverage-v8` pour `extract`.
Vérifier l'API de pg-boss 12 avec context7 avant de l'utiliser dans l'API (envoi seul).

**Spec :** `docs/specs/2026-11-05-chantier-1-capture-boutiques.md`. Contexte de la mesure :
`docs/specs/2026-11-05-mesure-blocages-boutiques.md`. Conception V1 : `docs/specs/2026-11-01-v1-conception.md`.

**Branche :** worktree `chantier-1` créé depuis `dev` (skill `superpowers:using-git-worktrees`).

## Contraintes globales

- Code en anglais, interface et documentation en français, chaque texte dans `fr`, `en` et `es` (`packages/i18n/messages`).
- Toute donnée qui traverse une frontière est validée avec Zod, et les schémas partagés vivent dans `packages/shared`.
- Aucune valeur de style en dur dans `apps/web` : tokens uniquement (`pnpm lint` le vérifie).
- Montants en centimes (`integer`) avec une devise ISO 4217 sur 3 lettres. Dates en `timestamptz`, en UTC.
- Aucun accès Internet dans les tests. Jamais les ports 3000, 3001, 3100 ou 3101.
- Identifiant de robot exact : `Mozilla/5.0 (compatible; ClosyriaBot/1.0; +https://closyria.com)`.
- `safeFetch` : http/https, ports 80/443, sans identifiants, adresse ≤ 2 048 caractères, ≤ 5 redirections, ≤ 5 Mo, ≤ 15 s, sans cookies.
- La règle d'adresses est un **paramètre** de `safeFetch`, stricte par défaut, et **jamais** lue dans une variable d'environnement.
- Fiche : 8 photos au plus ; nom ≤ 300, marque ≤ 120, libellé de taille ≤ 40, description ≤ 5 000 caractères.
- Chaque route admin est déclarée `"admin"` avec `defineAccess`. Le journal admin enregistre déjà toute mutation admin.
- Commits avec `-c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com`, se terminant par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm format`, `pnpm lint`, `pnpm typecheck` et `pnpm test` passent avant chaque commit.

## Points de vigilance (non couverts par la spec, testés dans la tâche indiquée)

1. **Même article collé avec des paramètres de suivi différents ou une ancre** → une seule fiche, mais `?variant=` reste distinct (tâche 1).
2. **Domaine en sous-domaine** (`shop.mango.com`, `www2.hm.com`, `fr.shein.com`) → la boutique de départ est reconnue, aucune boutique « à valider » créée (tâches 1 et 9).
3. **Formats de prix variés** (`"1.299,00 €"`, `"29.99"`, `29.99` en nombre, devise absente) → bons centimes ; devise `EUR` par défaut (tâche 3).
4. **Deux personnes collent le même nouveau lien au même instant** → une seule fiche, aucune erreur 500 (tâche 9).
5. **Partage Android dont le lien est dans le texte** (« Regarde ça https://… ») → le lien est retrouvé (tâche 12).

**Décision ajoutée par le plan (à valider par l'utilisatrice) :** en plus des limites par utilisatrice (30/h anonyme,
100/h avec compte), une limite de **200 captures par heure par adresse IP**. Sans elle, il suffirait de recréer des
sessions anonymes pour lever la limite.

---

### Tâche 1 : Adresses et schémas partagés

**Fichiers :**
- Créer : `packages/shared/src/catalog-url.ts`, `packages/shared/src/catalog-url.test.ts`, `packages/shared/src/catalog.ts`, `packages/shared/src/catalog.test.ts`
- Modifier : `packages/shared/src/index.ts`

**Interfaces :**
- Produit : `canonicalizeUrl(input: string): string | null`. Renvoie `null` si l'adresse n'est pas http(s), dépasse 2 048 caractères ou contient des identifiants.
  - Hôte en minuscules, port par défaut retiré, fragment retiré.
  - Paramètres retirés : `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `_ga`, `ref`. Les autres sont gardés et triés.
  - `/` final retiré, sauf pour la racine.
- Produit : `shopDomain(url: string): string` : l'hôte sans `www.`.
- Produit : `domainCandidates(host: string): string[]` : l'hôte sans `www.`, puis chaque domaine parent jusqu'à deux niveaux (`shop.mango.com` → `["shop.mango.com", "mango.com"]`).
- Produit : `nameFromUrl(url: string): string | null` : dernier segment de chemin non vide, sans extension ni identifiant numérique final, tirets en espaces, majuscule initiale (`/products/robe-camelia-rose` → `"Robe camelia rose"`).
- Produit, dans `catalog.ts` :
  - **Énumérations Zod** :
    - `shopStatusSchema` (`pending|draft|published`)
    - `captureModeSchema` (`auto|manual`)
    - `listingKindSchema` (`catalog|secondhand`)
    - `platformSchema` (`shopify|other|unknown`)
    - `captureTriggerSchema` (`user|admin_test|monitor`)
    - `captureStatusSchema` (`queued|running|succeeded|failed|skipped_manual`)
    - `captureMethodSchema` (`shopify|jsonld|opengraph`)
    - `captureErrorCodeSchema` (`blocked|timeout|too_large|forbidden_address|robots_disallowed|not_a_product|http_error|invalid_data`)
  - **Fiches** :
    - `extractedProductSchema` : `name`, `brand?`, `description?`, `currency`, `priceCents`, `compareAtCents?`, `images: string[]` (≤ 8), `sizes: {label, available, priceCents?}[]`, `externalId?`, `siteName?`, `platform: "shopify"|"other"` ;
    - `productViewSchema` : `id`, `shop: {name, slug}`, `canonicalUrl`, `name|null`, `brand|null`, `currency|null`, `priceCents|null`, `compareAtCents|null`, `sizes`, `images: {id, url, width, height}[]`, `source`, `captureStatus`, `lastCapturedAt|null` ;
    - `captureViewSchema` : `id`, `status`, `dataReady`, `errorCode|null`, `product: ProductView|null` ;
    - `manualEntrySchema` : `name` (1–300), `priceCents` (entier ≥ 0, facultatif), `sizes` (chaînes 1–40, 30 au plus).
  - **Files** : `CAPTURE_QUEUES = { user: "capture-user", admin: "capture-admin", monitor: "capture-monitor" } as const`.

- [ ] **Étape 1 : tests qui échouent.**
  - `canonicalizeUrl` :
    - `"https://WWW.Shop.fr/products/a?utm_source=x&variant=2#top"` → `"https://www.shop.fr/products/a?variant=2"` ;
    - `"ftp://x"` → `null` ;
    - `"https://u:p@x.fr/"` → `null` ;
    - une adresse de 2 049 caractères → `null` ;
    - deux adresses qui ne diffèrent que par l'ordre des paramètres → même résultat.
  - `domainCandidates("www2.hm.com")` → `["www2.hm.com", "hm.com"]`, et `domainCandidates("www.zara.com")` → `["zara.com"]`.
  - `nameFromUrl` : les cas `products/robe-camelia-rose` et `/fr/robe-x-p12345678.html` → `"Robe x"`.
  - `extractedProductSchema` refuse 9 photos.
- [ ] **Étape 2 :** `pnpm --filter @closyria/shared test` → ÉCHEC.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat(shared): catalog URLs and schemas`.

### Tâche 2 : Tables du catalogue

**Fichiers :**
- Créer : `packages/db/src/schema/catalog.ts`, `packages/db/migrations/0007_catalog.sql` (générée), `packages/db/src/catalog.integration.test.ts`
- Modifier : `packages/db/src/schema/index.ts`, `packages/db/package.json` si besoin de `@closyria/testing` en dépendance de dev

**Interfaces :**
- Produit : les tables `shops`, `shopDomains`, `products`, `productImages`, `productSizes`, `productHistory` et `captures`, exactement comme dans la spec §4.
  - Les colonnes à valeurs fermées ont un `CHECK` (même style que `media_dimensions_check`).
  - Clés uniques :
    - `shops.slug` ;
    - `shop_domains.domain` ;
    - `products.canonical_url` ;
    - (`product_images.product_id`, `source_hash`) ;
    - (`product_sizes.product_id`, `label`).
  - Index : `captures (shop_id, created_at)` et `captures (status, created_at)`.
  - Suppressions en cascade : fiche → photos, tailles, historique.
  - Les captures gardent `product_id` (nullable) avec `on delete set null`.
  - `requested_by` vers `user.id` avec `on delete set null`.
- La migration est générée par `pnpm --filter @closyria/db generate`, jamais écrite à la main.

- [ ] **Étape 1 : test d'intégration qui échoue** (base de test migrée).
  - Une deuxième fiche avec la même `canonical_url` est refusée.
  - `capture_mode = 'other'` est refusé par le `CHECK`.
  - Supprimer une fiche supprime ses tailles et met `captures.product_id` à `null`.
- [ ] **Étape 2 :** le test échoue.
- [ ] **Étape 3 :** écrire le schéma, générer la migration, puis la relire.
- [ ] **Étape 4 :** le test passe et `pnpm --filter @closyria/db typecheck` passe.
- [ ] **Étape 5 :** commit `feat(db): catalog tables`.

### Tâche 3 : `packages/extract` — JSON-LD et Open Graph

**Fichiers :**
- Créer : `packages/extract/{package.json,tsconfig.json,vitest.config.ts}`, `packages/extract/src/{index.ts,extract.ts,jsonld.ts,opengraph.ts,clean.ts}`, `packages/extract/src/*.test.ts`, `packages/extract/fixtures/synthetic/*.html`

**Interfaces :**
- Produit : `extract(input: { url: string; contentType: string; body: string; shopifyJson?: string }): ExtractResult`, avec `ExtractResult = { ok: true; method: CaptureMethod; product: ExtractedProduct } | { ok: false; error: "not_a_product" | "invalid_data" }`.
  - Méthodes essayées dans l'ordre : `shopify` (tâche 4), puis `jsonld`, puis `opengraph`.
  - La première méthode qui donne un nom et un prix valides gagne.
  - Le résultat est validé par `extractedProductSchema`. S'il est refusé, c'est `invalid_data`.
- Produit : `isShopifyPage(body: string): boolean` (marqueurs `Shopify.shop` ou `cdn.shopify.com`) et `shopifyJsUrl(url: string): string | null` (`…/products/<handle>.js`, quel que soit le préfixe, par exemple `/collections/x/products/h`).
- Produit : `parsePriceCents(value: string | number): number | null`.
- Nettoyage (`clean.ts`) :
  - balises HTML et entités retirées, espaces normalisés ;
  - longueurs plafonnées (contraintes globales) ;
  - photos rendues absolues, `//` donne `https:`, http(s) seulement, sans doublon, 8 au plus.
- JSON-LD :
  - lit `Product`, `ProductGroup` et `@graph` ;
  - ignore un bloc JSON invalide et passe au suivant ;
  - pour les offres : `offers` (objet, tableau ou `AggregateOffer`), `priceCurrency`, `availability` (`InStock` vaut disponible) ;
  - les tailles viennent de `hasVariant[].size` ou des offres ;
  - `brand` peut être une chaîne ou `{name}`.
- Open Graph : `og:title`, `og:image` (plusieurs), `product:price:amount` ou `og:price:amount` et `…:currency`, `og:site_name`. Sans prix, `not_a_product`.
- La devise vaut `EUR` quand aucune n'est donnée.
- Couverture ≥ 90 % (lignes et branches) imposée dans `vitest.config.ts`.

- [ ] **Étape 1 : tests qui échouent**, sur des fixtures synthétiques.
  - JSON-LD simple → `method: "jsonld"`, `priceCents: 2999`.
  - `ProductGroup` à 3 variantes → 3 tailles avec leur disponibilité.
  - JSON-LD cassé suivi d'un JSON-LD valide → le valide est lu.
  - Page sans JSON-LD mais avec Open Graph et prix → `opengraph`.
  - Page d'accueil (Open Graph sans prix) → `not_a_product`.
  - `parsePriceCents` : `"1.299,00 €"` → 129900, `"29.99"` → 2999, `29.99` → 2999, `"gratuit"` → `null`.
  - Nom de 400 caractères → tronqué à 300.
  - 12 photos → 8.
  - `<script>` dans la description → retiré.
- [ ] **Étape 2 :** `pnpm --filter @closyria/extract test` → ÉCHEC.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert et couverture ≥ 90 %.
- [ ] **Étape 5 :** commit `feat(extract): JSON-LD and Open Graph extraction`.

### Tâche 4 : `extract` — Shopify et pages réelles enregistrées

**Fichiers :**
- Créer : `packages/extract/src/shopify.ts`, `packages/extract/src/shopify.test.ts`, `packages/extract/src/real-pages.test.ts`, `packages/extract/scripts/record-fixture.ts`, `packages/extract/fixtures/real/<boutique>.{html,js.json}`

**Interfaces :**
- Consomme : `extract`, `parsePriceCents` et `clean` (tâche 3).
- Produit : la branche `shopify` de `extract`, quand `shopifyJson` est fourni.
  - Prix en centimes directement, `compare_at_price` et `vendor` pour la marque.
  - Tailles : l'option dont le nom correspond à `/taille|size|pointure/i`, sinon la première option. Une taille est disponible si au moins une de ses variantes l'est.
  - `platform: "shopify"`, `externalId` = `id`.
- `record-fixture.ts <url> <nom>` : script manuel, **hors tests**, lancé une seule fois avec l'identifiant de robot.
  - Il enregistre le `<head>`, les blocs JSON-LD et les balises meta (le reste du `<body>` est retiré), plus `<adresse>.js` pour Shopify.
  - **Seules sorties réseau du plan pendant l'implémentation** : les 8 pages de référence ci-dessous, une fois chacune.

Pages de référence (celles de la mesure) :

| Boutique | Adresse |
|---|---|
| MCB Paris | `https://mcb-paris.fr/products/produit-5063` |
| Easy Clothes | `https://easy-clothes.com/products/jeans-joelle-bleu-240` |
| My1996 | `https://my1996.fr/products/robe-camelia-rose-fonce` |
| Ohlala | `https://ohlalaboutique.fr/products/veste-fourrure-bambi` |
| Le Dressing de Paolina | `https://ledressingdepaolina.fr/products/gilet-silvana-2` |
| Intemporel Shop | `https://intemporel.shop/products/jean-mahaut-a-pois` |
| Promod | `https://www.promod.fr/fr-fr/bonnet-chaud-avec-de-la-laine-chocolat--p255230/` |
| Zalando | `https://www.zalando.fr/adidas-sportswear-essentials-3-stripes-leggings-leggings-blackwhite-adq41e03i-q12.html` |

Si une page a disparu, prendre un autre article de la même boutique et noter l'adresse dans le rapport de tâche.

- [ ] **Étape 1 : tests qui échouent.**
  - `shopify.test.ts` : un `.js` synthétique avec l'option « Taille » (S, M, L ; M épuisée) donne 3 tailles, `M` indisponible, `priceCents` égal à `price`.
  - Option nommée « Color » seule : les tailles sont tirées de la première option.
  - `real-pages.test.ts` : pour chacune des 8 pages, `ok: true`, un nom non vide, un prix > 0 et au moins une photo. Méthode `shopify` pour les 6 Shopify ; au moins une taille pour les Shopify et Zalando.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter `shopify.ts`, enregistrer les 8 pages, vérifier qu'aucun cookie ni jeton n'est resté dans les fichiers.
- [ ] **Étape 4 :** tests au vert et couverture ≥ 90 %.
- [ ] **Étape 5 :** commit `feat(extract): Shopify products and recorded shop pages`.

### Tâche 5 : Fausse boutique de test

**Fichiers :**
- Créer : `packages/testing/src/fake-shop.ts`, `packages/testing/src/fake-shop.test.ts`
- Modifier : `packages/testing/src/index.ts`

**Interfaces :**
- Produit : `startFakeShop(routes: Record<string, FakeRoute>): Promise<{ origin: string; hits: string[]; close(): Promise<void> }>`.
  - Le serveur écoute sur `127.0.0.1`, sur un port libre qui n'est jamais 3000, 3001, 3100 ou 3101.
  - `FakeRoute = { status?: number; headers?: Record<string,string>; body?: string | Buffer; file?: string; delayMs?: number; redirect?: string }`.
  - `file` est relatif à `packages/extract/fixtures`.
  - `hits` enregistre chaque chemin demandé, dans l'ordre.

- [ ] **Étape 1 : test qui échoue** : une route `file` sert la fixture, une route `redirect` répond 302 avec `Location`, `delayMs` retarde la réponse, et `hits` contient les chemins.
- [ ] **Étape 2 :** le test échoue.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** le test passe.
- [ ] **Étape 5 :** commit `test: fake shop server`.

### Tâche 6 : `safeFetch` et règle d'adresses

**Fichiers :**
- Créer : `apps/worker/src/capture/{address-policy.ts,safe-fetch.ts,capture-error.ts}` et leurs tests, `apps/worker/vitest.config.ts`
- Modifier : `apps/worker/package.json` (scripts `test`, dépendances)

**Interfaces :**
- Produit : `class CaptureError extends Error { constructor(readonly code: CaptureErrorCode, readonly httpStatus?: number) }`.
- Produit : `type AddressPolicy = (ip: string) => boolean` (`true` = autorisée), avec :
  - `strictPolicy`, qui refuse toutes les plages de la spec §8 (IPv4 et IPv6, y compris `::ffff:x.x.x.x` vérifiée comme IPv4 et `64:ff9b::/96`) ;
  - `loopbackForTests`, qui accepte en plus `127.0.0.1` et refuse le reste comme `strictPolicy`.
- Produit : `safeFetch(url: string, options: SafeFetchOptions): Promise<SafeResponse>`.
  - `SafeFetchOptions = { policy?: AddressPolicy; accept: "page" | "json" | "image"; maxBytes?: number; timeoutMs?: number; maxRedirects?: number; lookup?: typeof dns.lookup }`, avec `policy` = `strictPolicy` par défaut.
  - `SafeResponse = { finalUrl: string; status: number; contentType: string; body: Buffer }`.
  - Implémentation : `node:http` et `node:https`, avec une option `lookup` qui résout toutes les adresses, refuse s'il y en a **une seule** interdite, puis connecte à l'adresse vérifiée.
  - Redirections : `redirect` manuel, chacune revérifiée (schéma, port, adresse).
  - Contenu compressé : gzip ou br, décompressé avec la limite appliquée **après** décompression.
  - Délai de 15 s pour l'ensemble de la requête, redirections comprises.
  - Pas d'en-tête `Cookie` ; identifiant de robot exact.
  - Codes d'erreur :
    - adresse interdite → `forbidden_address` ;
    - délai dépassé → `timeout` ;
    - plus de 5 Mo → `too_large` ;
    - 401, 403 ou 429, ou page de défi (`captcha-delivery`, `cf-chl`, `_incapsula_`) → `blocked` ;
    - autre 4xx/5xx → `http_error` (avec `httpStatus`) ;
    - type de contenu inattendu → `invalid_data`.
- `apps/worker/src/capture/policy-guard.test.ts` : vérifie que le code du worker (hors tests) ne référence `loopbackForTests` nulle part, en parcourant les sources `apps/worker/src` sans `*.test.ts`.

- [ ] **Étape 1 : tests qui échouent.**
  - `strictPolicy` refuse :
    - `127.0.0.1`, `10.1.2.3`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0` ;
    - `::1`, `fc00::1`, `fe80::1`, `::ffff:127.0.0.1`, `64:ff9b::7f00:1`.
  - `strictPolicy` accepte `51.38.1.1` et `2001:41d0::1`.
  - Avec la fausse boutique et `loopbackForTests` :
    - 200 HTML renvoie le corps ;
    - une redirection vers `http://10.0.0.1/` donne `forbidden_address` ;
    - 6 redirections donnent une erreur (`http_error`) ;
    - une réponse de 6 Mo donne `too_large` ;
    - une réponse gzip qui se décompresse à 6 Mo donne `too_large` ;
    - `delayMs: 200` avec `timeoutMs: 100` donne `timeout` ;
    - 403 donne `blocked` ;
    - un `lookup` simulé qui renvoie `[8.8.8.8, 10.0.0.1]` donne `forbidden_address` ;
    - le port `8080` est refusé ;
    - l'en-tête `user-agent` reçu est exact.
  - Avec `strictPolicy` (défaut), la fausse boutique sur `127.0.0.1` donne `forbidden_address`.
  - Le garde de règle passe.
- [ ] **Étape 2 :** `pnpm --filter @closyria/worker test` → ÉCHEC.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(worker): safe fetch with address policy`.

### Tâche 7 : `robots.txt` et rythme par domaine

**Fichiers :**
- Créer : `apps/worker/src/capture/{robots.ts,throttle.ts}` et leurs tests

**Interfaces :**
- Produit : `parseRobots(text: string, agent: "ClosyriaBot"): (path: string) => boolean`.
  - Groupe `ClosyriaBot` s'il existe, sinon `*`.
  - Règle `Allow` ou `Disallow` la plus longue, `Allow` gagnant à longueur égale. Jokers `*` et `$` gérés.
- Produit : `createRobotsCache(fetchText: (url: string) => Promise<string | null>, now: () => number): { allows(url: string): Promise<boolean> }`.
  - Cache de 24 h par origine.
  - 404 ou erreur réseau sur `robots.txt` : tout est autorisé.
  - Une page interdite donne l'erreur `robots_disallowed`, levée par l'appelant.
- Produit : `createThrottle(minIntervalMs = 2000, now = Date.now, sleep = setTimeout promis): { wait(domain: string): Promise<void> }`.
  - Les appels successifs sur un même domaine sont espacés d'au moins 2 s.
  - Les domaines différents ne s'attendent pas.

- [ ] **Étape 1 : tests qui échouent.**
  - `Disallow: /checkout` interdit `/checkout/x` et autorise `/products/a`.
  - Un groupe `ClosyriaBot` prioritaire sur `*`.
  - `Allow: /products/` plus long que `Disallow: /` : autorisé.
  - Le cache ne redemande pas avant 24 h, puis redemande.
  - Throttle avec horloge simulée : 2 appels sur `a.fr` espacés de 2 000 ms ; `b.fr` immédiat.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat(worker): robots.txt and per-domain pacing`.

### Tâche 8 : Tâche de capture

**Fichiers :**
- Créer : `apps/worker/src/capture/{run-capture.ts,copy-images.ts,decode.ts}`, `apps/worker/src/capture/run-capture.integration.test.ts`
- Modifier : `apps/worker/package.json` (dépendances `@closyria/db`, `@closyria/extract`, `@closyria/storage`, `drizzle-orm` ; `@closyria/testing` en dépendance de dev ; configuration Vitest avec `globalSetup` comme `packages/entitlements`)

**Interfaces :**
- Consomme : `extract`, `isShopifyPage`, `shopifyJsUrl` (tâches 3 et 4) ; `safeFetch`, `CaptureError` (tâche 6) ; robots et throttle (tâche 7) ; `normalizeImage` et `ObjectStore` (`@closyria/storage`).
- Produit : `runCapture(captureId: string, deps: CaptureDeps): Promise<void>`.
  - `CaptureDeps = { db: Database; store: ObjectStore; policy?: AddressPolicy; robots: RobotsCache; throttle: Throttle; now?: () => Date }`.
  - Lit la capture et sa boutique, passe la capture en `running`, puis :
    1. Lecture :
       - boutique `shopify` : `.js` d'abord (`accept: "json"`), puis la page HTML ;
       - sinon : la page HTML, puis le `.js` si `isShopifyPage`.
    2. `extract`. Le texte est décodé selon le `charset` de `content-type` (`decode.ts`, `utf-8` par défaut).
    3. Pour `trigger = user` :
       - en une transaction, met à jour la fiche (`source = captured`, `capture_status = ok`, `last_captured_at`), remplace ses tailles (aucune pour `secondhand`), ajoute une ligne `product_history` et passe `data_ready = true` ;
       - la boutique passe de `platform = unknown` à la plateforme détectée.
    4. Pour `admin_test` et `monitor` : écrit seulement `captures.result` (fiche extraite), sans toucher aux fiches.
    5. Photos (`trigger = user` seulement), via `copyImages` : `safeFetch(accept: "image")`, `normalizeImage`, clé `products/<productId>/<sha256 de l'adresse>.webp`, ligne `product_images`. Une photo déjà présente (même `source_hash`) n'est pas retéléchargée. Une photo en échec est ignorée.
    6. Capture `succeeded`, avec `method`, `http_status`, `duration_ms` et `finished_at`.
  - En cas d'échec :
    - capture `failed` avec `error_code` (une erreur inconnue donne `http_error`) ;
    - pour `trigger = user`, `products.capture_status = failed`, sauf si la fiche était déjà `ok` ;
    - aucune exception ne remonte à pg-boss : pas de nouvel essai automatique.
  - Chaque domaine lu passe par `throttle.wait` puis `robots.allows`.

- [ ] **Étape 1 : tests d'intégration qui échouent** (base migrée, `memoryStore`, fausse boutique, `loopbackForTests`).
  - Fixture Shopify réelle → fiche `ok`, tailles, 1 ligne d'historique, photos stockées en WebP, capture `succeeded` avec `method: "shopify"`.
  - Fixture JSON-LD Zalando → `jsonld`.
  - Page d'accueil → `failed` / `not_a_product`, fiche `failed`.
  - 403 → `blocked`.
  - `robots.txt` qui interdit → `robots_disallowed`, et la page n'est jamais demandée (`hits`).
  - Boutique `secondhand` → aucune taille.
  - `admin_test` → `result` rempli, aucune fiche modifiée.
  - Deuxième capture du même article → photos non retéléchargées (`hits`).
  - Page en `ISO-8859-1` avec « é » → nom correct.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat(worker): capture job`.

### Tâche 9 : API — capture et fiche

**Fichiers :**
- Créer : `apps/api/src/catalog/{capture-queue.ts,shops.ts}`, `apps/api/src/routes/{captures.ts,products.ts}`, `apps/api/src/routes/captures.integration.test.ts`, `apps/api/src/routes/products.integration.test.ts`
- Modifier : `apps/api/src/app.ts` (`AppDeps.catalog`), `apps/api/src/bootstrap.ts` (instance pg-boss d'envoi, sans maintenance ni planification), `apps/api/package.json` (`pg-boss`), `packages/shared/src/catalog.ts` si un schéma de réponse manque

**Interfaces :**
- Produit : `type CaptureQueue = { enqueue(queue: "capture-user" | "capture-admin", captureId: string): Promise<void> }`, avec :
  - `pgBossQueue(boss)` en production ;
  - un faux qui enregistre les appels, dans les tests.
- Produit : `findOrCreateShop(db, url): Promise<Shop>`. Cherche chaque `domainCandidates(host)` dans `shop_domains`, en suivant `merged_into_id`. À défaut, crée la boutique `pending` :
  - `name` = domaine ;
  - `slug` = domaine avec `.` remplacé par `-` ;
  - domaine = hôte sans `www.`.

  Une création concurrente est sans erreur : `on conflict do nothing`, puis relecture.
- Routes (`AppDeps.catalog = { db, store, queue, now?, limits? }`) :
  - `POST /api/captures { url }` (`user`).
    - Adresse invalide → 400 `{ error: "invalid_url" }`.
    - Sinon, la fiche est trouvée ou créée par `canonical_url` (`on conflict do nothing`, puis relecture), puis :
      - boutique `manual` → capture `skipped_manual`, fiche `capture_status = manual` ;
      - fiche `ok` capturée il y a moins de 24 h → capture `succeeded` immédiate (`data_ready = true`), sans tâche ;
      - une capture `queued` ou `running` existe déjà pour cette fiche → elle est renvoyée ;
      - sinon → capture `queued`, puis `queue.enqueue("capture-user", id)`.
    - Réponse 202 `{ productId, captureId, status }`.
    - Limites :
      - 30 par heure pour une session anonyme ;
      - 100 par heure avec un compte ;
      - 200 par heure par adresse ;
      - au-delà, 429 `{ error: "rate_limited" }`, avec `rateLimit` existant.
  - `GET /api/captures/:id` (`user`) → `captureViewSchema`. 404 si inconnue.
  - `GET /api/products/:id` (`public`) → `productViewSchema`. Les photos ont pour `url` `/api/catalog-images/<imageId>`.
  - `PUT /api/products/:id/manual` (`user`, `manualEntrySchema`). Remplit seulement les champs vides :
    - nom ;
    - prix (devise `EUR`) ;
    - tailles, s'il n'y en a aucune.

    Si la fiche n'a aucune donnée capturée, elle passe en `source = manual`. Les mêmes limites que la capture s'appliquent. Réponse : `productViewSchema`.
  - `GET /api/catalog-images/:id` (`public`) → l'image WebP du stockage, avec `Cache-Control: public, max-age=31536000, immutable`. 404 si inconnue.

- [ ] **Étape 1 : tests d'intégration qui échouent.**
  - Création :
    - lien d'une boutique de test `auto` → 202, une tâche dans la file ;
    - même lien avec `utm_source` → même `productId` ;
    - `shop.mango.com/…` avec le domaine `mango.com` enregistré → boutique existante ;
    - domaine inconnu → boutique `pending` créée.
  - Cas particuliers :
    - boutique `manual` → `skipped_manual`, aucune tâche ;
    - fiche `ok` d'il y a 2 h → `succeeded`, aucune tâche ;
    - deux `POST` simultanés (`Promise.all`) pour un nouveau lien → une seule fiche, aucun 500.
  - Limites :
    - 31ᵉ capture anonyme dans l'heure → 429 ;
    - `"javascript:alert(1)"` → 400.
  - Saisie manuelle :
    - elle ne remplace pas un nom capturé ;
    - elle remplit une fiche vide (`source = manual`).
  - Accès :
    - `GET /api/products/:id` répond sans session ;
    - `GET /api/catalog-images/:id` renvoie `image/webp` et l'en-tête `immutable`.
  - Le test existant des routes non déclarées (`findStrayRoutes`) passe toujours.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat(api): captures and product pages`.

### Tâche 10 : API — admin des boutiques et des captures

**Fichiers :**
- Créer : `apps/api/src/catalog/health.ts`, `apps/api/src/catalog/health.test.ts`, `apps/api/src/routes/admin/{shops.ts,captures.ts}`, `apps/api/src/routes/admin/shops.integration.test.ts`
- Modifier : `apps/api/src/routes/admin/overview.ts`, `packages/shared/src/admin.ts` (schémas de réponse admin), `apps/api/src/app.ts`

**Interfaces :**
- Produit : `shopHealth(input: { status; captureMode; lastMonitors: boolean[]; successRate7d: number | null }): "ok" | "degraded" | "down" | "not_applicable"`.
  - `not_applicable` si la boutique n'est pas `published` + `auto`.
  - `down` si les 2 dernières surveillances (les plus récentes d'abord) ont échoué.
  - Sinon `degraded` si `successRate7d < 0.8`.
  - Sinon `ok`.
- Routes, toutes `admin` :
  - `GET /api/admin/shops?status=&mode=&health=` : liste avec domaines, santé et dernière capture.
    - Les `pending` d'abord, triées par nombre de fiches créées sur 30 jours (décroissant), puis par nom.
    - Les boutiques fusionnées sont exclues.
  - `GET /api/admin/shops/:id` : réglages, domaines, santé, taux sur 7 jours, dernière surveillance, 10 dernières erreurs (`error_code`, `http_status`, date, adresse de la fiche).
  - `PATCH /api/admin/shops/:id` : `name`, `slug`, `status`, `captureMode`, `listingKind`, `testUrl`, `domains: string[]`. Un domaine déjà pris par une autre boutique → 409 `{ error: "domain_taken" }`.
  - `POST /api/admin/shops { url }` : boutique `draft` créée sur le domaine de l'adresse, ou 409 `domain_taken`. Lance une capture `admin_test` sur l'adresse. Réponse : `{ shopId, captureId }`.

    Quand la capture réussit, la page d'admin propose de reprendre `siteName` pour le nom et l'adresse pour `testUrl`, avec un `PATCH` explicite.
  - `POST /api/admin/shops/:id/merge { targetId }` : en une transaction, rattache les domaines et les fiches à la boutique cible et remplit `merged_into_id`. Refusé si la cible est la même boutique, ou si elle est elle-même fusionnée (400).
  - `POST /api/admin/captures/test { url }` : capture `admin_test` (boutique trouvée ou créée `pending`, sans fiche), mise dans `capture-admin`.
  - `GET /api/admin/captures/:id` : statut, méthode, durée, `error_code` et `result`.
  - `GET /api/admin/captures/failures?shopId=&errorCode=` : les 100 derniers échecs.
  - `POST /api/admin/captures/:id/retry` : nouvelle capture avec le même déclencheur, la même fiche et la même boutique.
- `GET /api/admin/overview` gagne `captures: { last24h, last7d, successRate7d, byMethod: { shopify, jsonld, opengraph }, medianDurationMs }` et `shops: { pending, down }`.

- [ ] **Étape 1 : tests qui échouent.**
  - `shopHealth` :
    - `[false, false]` → `down` ;
    - `[true]` avec un taux de 0,7 → `degraded` ;
    - un brouillon → `not_applicable`.
  - Intégration :
    - un utilisateur non admin reçoit 403 sur chaque route ;
    - le tri des `pending` par popularité ;
    - un `PATCH` avec un domaine pris → 409 ;
    - une fusion rattache domaines et fiches, et la boutique fusionnée disparaît de la liste ;
    - `retry` crée une nouvelle capture en file ;
    - les chiffres de `overview` sur un jeu de captures connu ;
    - chaque mutation admin écrit une ligne dans le journal admin.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat(api): shop and capture administration`.

### Tâche 11 : Worker — files, surveillance, boutiques de départ, barrière réseau

**Fichiers :**
- Créer : `apps/worker/src/capture/{queues.ts,monitor.ts,seed-shops.ts,starting-shops.ts,network-barrier.ts}` et leurs tests
- Modifier : `apps/worker/src/index.ts`, `apps/worker/src/env.ts` (variables S3, comme l'API, toutes ensemble ou aucune ; `memoryStore` en développement seulement)

**Interfaces :**
- Consomme : `runCapture` (tâche 8), `CAPTURE_QUEUES` (tâche 1).
- Produit : `registerCaptureQueues(boss, deps)`.
  - Crée les 3 files et les traite : `capture-user` avec 4 tâches en parallèle, les deux autres avec 1 tâche à la fois.
  - Planifie `capture-monitor` à `0 4 * * *`.
- Produit : `scheduleMonitors(db, queue)`. Appelée par la tâche planifiée, elle crée une capture `monitor` par boutique `published` + `auto` qui a une `test_url`, sans fiche, et la met en file.
- Produit : `seedStartingShops(db): Promise<number>`. Insère les boutiques de `STARTING_SHOPS` absentes (par `slug`), avec leurs domaines. Elle ne modifie **jamais** une boutique existante. Elle est appelée au démarrage du worker.
- `STARTING_SHOPS` : 18 entrées, toutes `published`.

| slug | nom | domaine | mode | type | page de test |
|---|---|---|---|---|---|
| mcb-paris | MCB Paris | mcb-paris.fr | auto | catalog | page de la tâche 4 |
| easy-clothes | Easy Clothes | easy-clothes.com | auto | catalog | idem |
| my1996 | My1996 | my1996.fr | auto | catalog | idem |
| ohlala | Ohlala | ohlalaboutique.fr | auto | catalog | idem |
| le-dressing-de-paolina | Le Dressing de Paolina | ledressingdepaolina.fr | auto | catalog | idem |
| intemporel-shop | Intemporel Shop | intemporel.shop | auto | catalog | idem |
| promod | Promod | promod.fr | auto | catalog | idem |
| zalando | Zalando | zalando.fr | auto | catalog | idem |
| zara | Zara | zara.com | manual | catalog | — |
| mango | Mango | mango.com | manual | catalog | — |
| hm | H&M | hm.com | manual | catalog | — |
| sezane | Sézane | sezane.com | manual | catalog | — |
| kiabi | Kiabi | kiabi.com | manual | catalog | — |
| etam | Etam | etam.com | manual | catalog | — |
| la-redoute | La Redoute | laredoute.fr | manual | catalog | — |
| shein | Shein | shein.com | manual | catalog | — |
| vinted | Vinted | vinted.fr | manual | secondhand | — |
| vestiaire-collective | Vestiaire Collective | vestiairecollective.com | manual | secondhand | — |

Plateforme : `shopify` pour les 6 premières, `other` pour les autres.

- Produit : `checkNetworkBarrier(): Promise<"active" | "absent">`.
  - Tente une connexion TCP **directe** (sans `safeFetch`) vers `127.0.0.1:9`.
  - `EPERM` ou `EACCES` → `active` ; tout autre résultat → `absent`.
  - Au démarrage, le worker l'écrit dans le journal : `network barrier: active`, ou un avertissement `network barrier: ABSENT` hors `development` et `test`.

- [ ] **Étape 1 : tests qui échouent.**
  - `seedStartingShops` deux fois → 18 boutiques, puis 0 ajout. Une boutique renommée par l'admin n'est pas écrasée.
  - `scheduleMonitors` ignore les `manual`, les `draft` et celles sans `test_url`.
  - `checkNetworkBarrier` en local → `absent`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter et brancher dans `index.ts`, en gardant `heartbeat` et l'arrêt propre.
- [ ] **Étape 4 :** les tests passent. `pnpm --filter @closyria/worker build` passe, et le bundle inclut sharp comme celui de l'API (`deploy/native-deps.mjs`).
- [ ] **Étape 5 :** commit `feat(worker): capture queues, daily monitor and starting shops`.

### Tâche 12 : Web — coller, partager, fiche produit

**Fichiers :**
- Créer :
  - `apps/web/src/components/capture-form.tsx` ;
  - `apps/web/src/app/produits/[id]/{page.tsx,product-view.tsx,manual-form.tsx}` ;
  - `apps/web/src/app/partager/page.tsx` ;
  - `apps/web/src/app/manifest.ts` ;
  - `apps/web/public/icons/{icon-192.png,icon-512.png}` ;
  - `apps/web/scripts/build-icons.ts` ;
  - `apps/web/src/lib/{shared-url.ts,shared-url.test.ts,capture-poll.ts,capture-poll.test.ts}`
- Modifier : `apps/web/src/app/page.tsx` (ajoute le champ), `apps/web/src/app/layout.tsx` (manifeste), en-têtes de sécurité si `img-src` ou `manifest-src` doivent l'autoriser, `packages/i18n/messages/{fr,en,es}.json` (espace `Capture`)

**Interfaces :**
- Consomme : `POST /api/captures`, `GET /api/captures/:id`, `GET /api/products/:id`, `PUT /api/products/:id/manual` (tâche 9).
- Produit : `extractSharedUrl(params: { url?: string; text?: string; title?: string }): string | null`. Prend `url` si c'est une adresse http(s), sinon la première adresse http(s) trouvée dans `text`, puis dans `title`.
- Produit : `pollCapture(id, fetchCapture, { intervalMs = 500, softTimeoutMs = 15000, onUpdate, onSoftTimeout }): () => void` (annulation).
  - Arrêt quand `status` vaut `succeeded`, `failed` ou `skipped_manual`, ou quand `dataReady` est vrai et que toutes les photos sont arrivées.
  - Après 15 s, `onSoftTimeout` est appelé et l'interrogation continue toutes les 3 s, pendant 60 s au plus.
- Manifeste :
  - `name: "Closyria"`, `display: "standalone"`, `start_url: "/"`, icônes 192 et 512 (générées par `build-icons.ts` à partir d'un monogramme aux couleurs des tokens, provisoires jusqu'au chantier 4) ;
  - `share_target: { action: "/partager", method: "GET", params: { title: "title", text: "text", url: "url" } }`.
- `/partager` :
  - lance la capture et redirige vers `/produits/<id>` ;
  - sans lien trouvé, affiche « Ce partage ne contient pas de lien. » avec le champ « Coller un lien ».
- `/produits/[id]` :
  - squelette animé (tokens `motion-*`, respecte `prefers-reduced-motion`) avec le nom de la boutique ;
  - texte affiché dès `dataReady`, photos ensuite ;
  - messages d'échec et de capture manuelle exactement comme dans la spec §6 ;
  - formulaire manuel avec le nom pré-rempli par `nameFromUrl` ;
  - bouton « Voir chez <boutique> » (`rel="noopener noreferrer"`, `target="_blank"`) ;
  - date de mise à jour.
- Libellés exacts :
  - champ : « Coller un lien » ;
  - bouton : « Ajouter » ;
  - adresse invalide : « Ce lien n'est pas valide. » ;
  - 429 : « Trop d'ajouts d'un coup. Réessaie dans une heure. ».

- [ ] **Étape 1 : tests qui échouent.**
  - `extractSharedUrl({ text: "Regarde ça https://zara.com/fr/x.html !" })` → `"https://zara.com/fr/x.html"`.
  - `extractSharedUrl({ text: "rien" })` → `null`.
  - `pollCapture` avec une horloge simulée : arrêt sur `succeeded` ; `onSoftTimeout` appelé après 15 s, puis passage à 3 s.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter les pages et les messages dans les 3 langues.
- [ ] **Étape 4 :** tests, `pnpm lint` (tokens) et `pnpm --filter @closyria/web build` au vert.
- [ ] **Étape 5 :** commit `feat(web): paste or share a link, product page`.

### Tâche 13 : Web — admin des boutiques et des captures

**Fichiers :**
- Créer :
  - `apps/web/src/app/admin/(shell)/boutiques/page.tsx` ;
  - `apps/web/src/app/admin/(shell)/boutiques/[id]/page.tsx` ;
  - `apps/web/src/app/admin/(shell)/boutiques/nouvelle/page.tsx` ;
  - `apps/web/src/app/admin/(shell)/captures/page.tsx` ;
  - composants à côté (`link-tester.tsx`, `merge-dialog.tsx`, `health-badge.tsx`)
- Modifier : `apps/web/src/app/admin/nav.ts` (entrées `shops` et `captures`), `apps/web/src/app/admin/(shell)/page.tsx` (tuiles de captures), `apps/web/src/lib/admin-api.ts` (appels), `packages/i18n/messages/*.json` (espace `Admin.shops`, `Admin.captures`)

**Interfaces :**
- Consomme : les routes de la tâche 10.
- Libellés de santé :
  - `ok` → « OK » ;
  - `degraded` → « Dégradée » ;
  - `down` → « En panne » ;
  - `not_applicable` → « — ».
- Le badge combine toujours une couleur (token) et un texte, jamais la couleur seule.
- « Tester un lien » interroge `GET /api/admin/captures/:id` toutes les 500 ms. Il affiche ensuite la méthode, la durée, le nom, le prix, les tailles et les miniatures (adresses d'origine affichées en texte, **jamais chargées** dans l'admin).
- La fusion demande une confirmation qui nomme les deux boutiques.

- [ ] **Étape 1 : tests qui échouent.** `nav.test.ts` contient les entrées `shops` et `captures`. Test unitaire des appels admin ajoutés dans `admin-api.test.ts` (adresse et validation de la réponse).
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter les écrans.
- [ ] **Étape 4 :** tests, lint et build au vert.
- [ ] **Étape 5 :** commit `feat(web): shop and capture admin`.

### Tâche 14 : Bout en bout

**Fichiers :**
- Créer : `packages/storage/src/fs.ts`, `packages/storage/src/fs.test.ts`, `e2e/fixtures/capture-worker.ts`, `e2e/tests/capture.spec.ts`, `e2e/tests/admin-shops.spec.ts`
- Modifier : `packages/storage/src/index.ts`, `apps/api/src/env.ts` et `bootstrap.ts`, `e2e/fixtures/stack.ts`, `e2e/package.json` (`@closyria/worker`), `apps/worker/package.json` (`exports` de `./capture`)

**Interfaces :**
- Produit : `fsStore(root: string): ObjectStore`, réservé aux tests.
  - L'API ne l'utilise que si `APP_ENV=test` **et** si `TEST_STORAGE_DIR` est défini. Dans tout autre environnement, `TEST_STORAGE_DIR` fait refuser le démarrage, sur le modèle de `testMail`.
  - Cette variable ne touche pas à la règle d'adresses.
- `e2e/fixtures/capture-worker.ts` : dans le processus Playwright, démarre pg-boss sur la base de test et `registerCaptureQueues`, avec :
  - `policy: loopbackForTests` ;
  - `fsStore(TEST_STORAGE_DIR)` ;
  - la fausse boutique (tâche 5).

  Les boutiques de test sont insérées directement en base, avec le domaine `127.0.0.1`.
- Parcours :
  - `capture.spec.ts` (téléphone et ordinateur) :
    - coller l'adresse de la fixture Shopify → nom, prix, tailles et au moins une photo visibles en moins de 5 s ;
    - adresse d'une boutique `manual` → message « … ne permet pas la lecture automatique… » et formulaire, puis saisie du nom et du prix → fiche affichée ;
    - `/partager?text=Regarde%20https://…` → fiche ;
    - axe sans violation sur la fiche.
  - `admin-shops.spec.ts` : admin avec passkey (fixture existante) → « Ajouter une boutique » depuis une adresse de la fausse boutique → brouillon créé ; « Tester un lien » → méthode et nom affichés.

- [ ] **Étape 1 : test qui échoue** : `fs.test.ts` (`put`, `get`, `delete`, `ObjectNotFoundError`), puis les deux parcours.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter `fsStore`, le branchement de l'API et les fixtures.
- [ ] **Étape 4 :** `pnpm build && pnpm e2e` au vert.
- [ ] **Étape 5 :** commit `test(e2e): capture and shop admin journeys`.

### Tâche 15 : Barrière systemd et mise en service

**Fichiers :**
- Modifier : `deploy/systemd/closyria-dev-worker.service`, `deploy/systemd/closyria-prod-worker.service`, `deploy/README.md`
- Créer : `docs/plans/2026-11-05-mise-en-service-chantier-1.md`

**Interfaces :**
- Ajouter aux deux unités worker, après `RestrictAddressFamilies`, le bloc exact de la spec §8 (`IPAddressDeny=…`, `IPAddressAllow=127.0.0.53/32`).
- Vérifier aussi l'accès au stockage S3 depuis le worker : `prod.env` et `dev.env` contiennent déjà les variables S3 de l'API, le worker lit le même fichier.
- Liste de mise en service (cases à cocher), à faire **par l'utilisatrice** avec sudo :
  1. Copier les unités, `systemctl daemon-reload`.
  2. Déployer en dev.
  3. Lire `network barrier: active` dans le journal du worker dev.
  4. Coller un lien Shopify sur dev.closyria.com et voir la fiche.
  5. Admin : santé visible.
  6. Le lendemain : la surveillance de 04:00 UTC est passée pour les 8 boutiques.
  7. Mêmes étapes en prod.

- [ ] **Étape 1 :** `systemd-analyze verify deploy/systemd/closyria-dev-worker.service` ne signale aucune erreur sur les nouvelles lignes. Les avertissements liés aux chemins absents en local sont acceptés et notés.
- [ ] **Étape 2 :** écrire la liste de mise en service et mettre à jour `deploy/README.md` (rôle de la barrière, vérification dans le journal).
- [ ] **Étape 3 :** commit `deploy: network barrier for the worker`.

---

## Après le plan

- Revue de toute la branche, puis fusion dans `dev` après accord de l'utilisatrice.
- Mise en service (tâche 15), puis cocher le chantier 1 dans la conception V1 une fois en prod.
