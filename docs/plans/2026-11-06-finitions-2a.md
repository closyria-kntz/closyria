# Finitions du 2a : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**But :** corriger ce que les tests en dev du 2a ont montré : fiches perdues, ♡ retiré qui laisse l'article dans
Envies, photos qu'on ne peut pas agrandir, ajout de photo limité à l'envoi de fichier, fiche sans structure.

**Architecture :** une migration (0013) ajoute deux tables à l'utilisatrice : `recent_products` (fiches ouvertes en
collant un lien) et `photo_imports` (photo ajoutée par lien). L'image d'un lien est téléchargée par le **worker**
(seul processus derrière la barrière réseau systemd, avec `safeFetch`), jamais par l'API ; l'API la rattache à
l'article quand l'application vient chercher le résultat. Le reste est du web : visionneuse, fenêtre « Ajouter une
photo », nouvelle mise en page de la fiche.

**Stack :** Next 16 (App Router), Hono + zod-openapi, pg-boss, Drizzle, PostgreSQL 18, sharp (`normalizeImage` de
`@closyria/storage`), Vitest, Playwright + axe.

**Spec :** `docs/specs/2026-11-06-retours-tests-2a.md` (points 1 à 5), dans le cadre de
`docs/specs/2026-11-05-chantier-2a-garder.md`.

**Branche :** worktree `~/projects/closyria-finitions-2a`, branche `finitions-2a` depuis `dev`.

## Décisions prises en écrivant le plan (écarts avec la spec)

- **Derniers liens : une table, pas `captures.requested_by`.** Une lecture déjà en cours pour le même lien n'écrit
  pas de nouvelle ligne de capture : la seconde personne n'aurait pas vu le lien dans ses « Derniers liens ». Et la
  fusion anonyme → compte doit les déplacer. D'où `recent_products`, une ligne par (utilisatrice, fiche).
- **Photo par lien : téléchargée par le worker.** L'API ne peut pas avoir la barrière `IPAddressDeny` (elle reçoit
  Caddy sur 127.0.0.1). Le worker l'a déjà et possède `safeFetch`.

## Global Constraints

- Code en anglais, interface et documentation en français ; textes dans `packages/i18n/messages/fr.json`
  uniquement (`en.json` et `es.json` sont vides).
- Toute donnée qui traverse une frontière est validée avec Zod ; schémas partagés dans `packages/shared`.
- Styles : tokens seulement (`node scripts/check-design-tokens.ts`, lancé par `pnpm lint`) ; pas de valeur
  arbitraire `[…]`.
- Accessibilité : cibles tactiles `min-h-touch-target`, focus visible, `aria-*` sur les boutons à état ; les
  tests e2e passent `axe` sur les pages touchées.
- Responsive : téléphone, tablette, ordinateur (projets Playwright existants).
- « Annuler » pendant 8 s (`UNDO_DELAY_MS`) après toute action qui retire quelque chose.
- Photo : 20 Mo au plus (`MAX_IMAGE_BYTES`), JPEG/PNG/WebP/AVIF, réencodée en WebP par `normalizeImage`, 10 photos
  privées par article (`MAX_ITEM_PHOTOS`), mêmes limites de débit que l'envoi (`pipeline.limits`).
- Jamais de `pkill -f`/`killall`, jamais les ports 3000/3001/3100/3101 ; commits avec
  `-c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com` et le trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` au vert avant chaque commit.

## Review Focus

1. Un texte collé dans « Ajouter une photo » qui est une adresse `http(s)` : il part en import par lien, sans
   message d'erreur (Task 7).
2. Un lien d'image qui pointe vers une adresse privée, une page HTML ou un fichier de plus de 20 Mo : l'import
   échoue avec un message clair, et aucun objet ni ligne `media` ne reste (Task 6).
3. Retirer le ♡ d'une envie qui est dans une liste (ou qui a une note, une taille, une étiquette, une photo à elle) :
   seul le favori part, l'article reste (Task 4).
4. Le même lien collé deux fois, ou par deux personnes pendant la même lecture : une seule ligne par personne,
   remontée en tête, et chacune la voit (Task 2).
5. La visionneuse avec une seule photo : pas de flèches ; en fermant, le focus revient sur la photo cliquée
   (Task 5).

---

### Task 1: Tables `recent_products` et `photo_imports`

**Files:**
- Modify: `packages/db/src/schema/wardrobe.ts`
- Create: `packages/db/migrations/0013_*.sql` (généré : `pnpm --filter @closyria/db generate`)
- Modify: `apps/api/src/owned-tables.ts`, `apps/api/src/wardrobe/merge.ts`
- Modify: `apps/worker/src/wardrobe/purge-trash.ts` (ou nouveau `purge-transient.ts` appelé par le même job)
- Test: `apps/api/src/wardrobe/merge.integration.test.ts` (ou le test de fusion existant), test du worker de purge

**Interfaces:**
- Produces (Drizzle) :
  - `recentProducts` : `userId` (`owner()`, cascade), `productId` (FK `products`, cascade), `visitedAt`
    (timestamptz, not null) ; clé primaire (`user_id`, `product_id`) ; index (`user_id`, `visited_at` desc).
  - `photoImports` : `id` uuid, `userId` (`owner()`), `itemId` (FK `items`, cascade), `url` text (≤ 2 048),
    `status` text CHECK `queued|ready|failed|attached`, `errorCode` text nullable CHECK
    `blocked|timeout|too_large|unsupported|failed`, `mediaKey`, `contentType`, `sizeBytes`, `width`, `height`
    (nullable, remplis à `ready`), `createdAt`, `updatedAt`.
  - `mergeRecentProducts(fromUserId, toUserId, tx)` : insère les lignes de l'anonyme dans le compte
    (`on conflict` → `visited_at = greatest(...)`), puis supprime celles de l'anonyme.
- Constantes partagées (`packages/shared/src/wardrobe.ts`) : `RECENT_PRODUCTS_LIMIT = 20`,
  `RECENT_RETENTION_DAYS = 90`, `PHOTO_IMPORT_RETENTION_HOURS = 24`, `photoImportStatusSchema`,
  `photoImportErrorSchema`.

- [x] **Step 1 : tests.** Fusion : un anonyme avec 2 récents (dont 1 aussi chez le compte, plus récent côté
  anonyme) → le compte a 3 lignes et la date la plus récente pour le doublon ; l'anonyme n'en a plus. Purge (horloge
  injectée) : un récent de 91 jours supprimé, un de 89 jours gardé ; un import `ready` de plus de 24 h supprimé
  **avec son objet** (`store.delete(mediaKey)`), un import `attached` de plus de 24 h supprimé sans toucher l'objet.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** tables, migration générée (relire le SQL : uniquement des `CREATE`), `registerOwnedTable` pour
  `recentProducts` (avec `mergeRecentProducts`) et pour `photoImports` (déplacement simple), après `items` dans
  `owned-tables.ts`. Purge dans le job `wardrobe-purge` existant (03:30 UTC), ligne de journal seulement si quelque
  chose a été supprimé.
- [x] **Step 4 :** tests au vert, `pnpm typecheck`.
- [x] **Step 5 :** commit `feat(db): derniers liens et imports de photo (0013)`.

### Task 2: API des derniers liens

**Files:**
- Modify: `apps/api/src/routes/captures.ts` (enregistrer la visite)
- Create: `apps/api/src/routes/me/recents.ts` (+ montage dans `apps/api/src/app.ts`)
- Modify: `packages/shared/src/wardrobe.ts`
- Test: `apps/api/src/routes/me/recents.integration.test.ts`, `apps/api/src/routes/captures.integration.test.ts`

**Interfaces:**
- Consumes : `recentProducts` (Task 1), `loadProductViews` (`apps/api/src/catalog/product-view.ts`).
- Produces :
  - `recentProductViewSchema = z.object({ product: productViewSchema, visitedAt: dateTimeSchema })`,
    `recentListSchema = z.object({ recents: z.array(recentProductViewSchema) })`.
  - `GET /api/me/recents` (accès `user`) → 200 `RecentList` : les `RECENT_PRODUCTS_LIMIT` plus récentes, **sans** les
    fiches qu'elle garde déjà (un article non supprimé sur ce produit, quel que soit le profil).
  - `DELETE /api/me/recents/{productId}` → 204 (aussi si la ligne n'existe pas), 400 pour un id mal formé.
  - `POST /api/captures` fait un upsert `recent_products (user, product, visited_at = now())` pour **toutes** ses
    issues (lecture lancée, fraîche, en cours, boutique manuelle).

- [x] **Step 1 : tests.** `it("records the visit even when a capture is already running for another user")` : deux
  sessions collent la même adresse pendant qu'une lecture est `queued` → chacune a sa ligne. `it("moves a pasted
  link back to the top")` : coller A, B, puis A → `recents[0].product.id === A`. `it("leaves out the products she
  keeps")`. `it("keeps 20 at most")`. `it("forgets one")` (DELETE puis GET). 401 sans session.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** routes et enregistrement (l'upsert hors de la transaction de capture, après elle ; un échec de
  l'upsert ne fait pas échouer la capture : il est journalisé).
- [x] **Step 4 :** tests au vert.
- [x] **Step 5 :** commit `feat(api): derniers liens collés`.

### Task 3: « Derniers liens » sur l'accueil

**Files:**
- Create: `apps/web/src/components/recent-products.tsx`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/lib/wardrobe-client.ts` (+ test),
  `packages/i18n/messages/fr.json` (`Home.recents`)
- Test: `apps/web/src/lib/wardrobe-client.test.ts`, `e2e/tests/capture.spec.ts`

**Interfaces:**
- Consumes : `GET /api/me/recents`, `DELETE /api/me/recents/{productId}` (Task 2).
- Produces : `fetchRecents(deps?): Promise<RecentList | null>` (null sur 401), `forgetRecent(productId, deps?)`.

- [x] **Step 1 : tests.** Client : 401 → `null` ; réponse invalide → erreur. E2E : coller un lien, revenir à
  l'accueil → « Derniers liens » montre la fiche (vignette, boutique, nom) ; ✕ la retire ; une fiche gardée (♡)
  n'y est plus.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** composant sous le formulaire de l'accueil : titre « Derniers liens », liste de vignettes 3:4
  (photo entière, `object-contain`) avec boutique et nom, lien vers `/produits/<id>`, bouton ✕ « Retirer de la
  liste » (`aria-label` avec le nom). Rien du tout sans session, sans récent ou en cas d'erreur. Textes :
  `"recents": { "title": "Derniers liens", "forget": "Retirer {name} de la liste" }`.
- [x] **Step 4 :** tests au vert, `pnpm e2e` sur `capture.spec.ts`.
- [x] **Step 5 :** commit `feat(web): derniers liens sur l'accueil`.

### Task 4: Retirer le ♡ d'une simple envie la retire

**Files:**
- Create: `apps/web/src/lib/bare-wish.ts` (+ `bare-wish.test.ts`)
- Modify: `apps/web/src/app/(app)/produits/[id]/item-panel.tsx`, `packages/i18n/messages/fr.json`
  (`Item.toast.wishRemoved`)
- Test: `e2e/tests/views.spec.ts`

**Interfaces:**
- Produces : `isBareWish(item: ItemView): boolean`.

- [x] **Step 1 : tests.** `isBareWish` vrai pour `stage: "spotted"`, `favorite: true` et tout le reste vide
  (`sizeLabel`, `sizeNote`, `notes`, `pricePaidCents`, `salePriceCents`, `saleChannel`, `nameOverride`,
  `brandOverride`, `categoryId`, `colorId` à null ; `tags`, `wishlistIds` vides ; aucune photo `source: "private"`).
  Faux dès qu'un seul de ces champs est rempli (un cas par champ, `it.each`), et faux pour toute autre étape.
  E2E : ♡ puis ♡ à nouveau → message « Retiré de tes envies · Annuler », la fiche montre « Garder cet article »,
  Envies est vide ; « Annuler » le remet. Même geste sur une envie ajoutée à une liste → seul « Retiré des
  favoris ».
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** dans `toggleFavorite`, si `item.favorite && isBareWish(item)` : `trashItem(item.id)`, puis
  `onGone()` et `pushUndo(t("toast.wishRemoved"), undoWith(result.undo, reload))` ; sinon le comportement actuel.
  Texte : `"wishRemoved": "Retiré de tes envies"`.
- [x] **Step 4 :** tests au vert.
- [x] **Step 5 :** commit `feat(web): retirer le ♡ d'une simple envie la retire`.

### Task 5: Visionneuse de photos

**Files:**
- Create: `apps/web/src/components/photo-viewer.tsx`
- Modify: `apps/web/src/app/(app)/produits/[id]/product-view.tsx`,
  `apps/web/src/app/(app)/produits/[id]/photo-manager.tsx`, `apps/web/src/app/l/[token]/page.tsx`,
  `packages/i18n/messages/fr.json` (`Media.viewer`)
- Test: `e2e/tests/capture.spec.ts` (ou nouveau `e2e/tests/photos.spec.ts`)

**Interfaces:**
- Produces : `PhotoViewer({ photos, index, alt, onClose }: { photos: { url: string; width: number; height: number }[];
  index: number | null; alt: string; onClose: () => void })` ; `index === null` → fermé.

- [x] **Step 1 : tests e2e.** Clic sur la 2e photo → la visionneuse s'ouvre sur « 2 / 3 » ; → et ← changent de
  photo, glisser aussi sur le projet téléphone ; clic sur la photo → taille réelle (`data-zoom="actual"`), la zone
  défile ; second clic → retour à l'ajustement ; Échap ferme et le focus revient sur la vignette cliquée ; avec une
  seule photo, pas de flèches ni de compteur ; `axe` sans violation, visionneuse ouverte.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** `<dialog>` plein écran (`showModal`, comme `components/dialog.tsx`) ; défilement horizontal
  `snap-x snap-mandatory` (le glissement est natif) ; flèches précédent/suivant et clavier ←/→ ; compteur
  « {current} / {total} » ; bouton ✕ « Fermer » ; clic sur la photo bascule entre « ajustée à l'écran »
  (`object-contain`) et « taille réelle » (image à `width`×`height` naturels dans un conteneur `overflow-auto`) ;
  `prefers-reduced-motion` respecté. Chaque vignette des trois pages devient un `<button>` « Agrandir la photo
  {n} ». Textes : `"viewer": { "open": "Agrandir la photo {n}", "close": "Fermer", "previous": "Photo précédente",
  "next": "Photo suivante", "counter": "{current} / {total}", "actualSize": "Voir en taille réelle",
  "fit": "Ajuster à l'écran" }`.
- [x] **Step 4 :** tests au vert sur les trois formats.
- [x] **Step 5 :** commit `feat(web): visionneuse de photos`.

### Task 6: Photo par lien (worker + API)

**Files:**
- Create: `apps/worker/src/wardrobe/photo-import.ts` (+ test), enregistrement dans `apps/worker/src/wardrobe/queues.ts`
- Create: routes dans `apps/api/src/routes/me/item-media.ts` ; `recordStored` dans `apps/api/src/routes/media.ts`
- Modify: `apps/api/src/catalog/capture-queue.ts` (nom de file `photo-import`), `packages/shared/src/wardrobe.ts`
- Test: `apps/worker/src/wardrobe/photo-import.test.ts`, `apps/api/src/routes/me/item-media.integration.test.ts`

**Interfaces:**
- Consumes : `photoImports` (Task 1), `safeFetch(url, { accept: "image", maxBytes: MAX_IMAGE_BYTES, ... })`
  (`apps/worker/src/capture/safe-fetch.ts`), `normalizeImage` (`@closyria/storage`), `attachPhoto`
  (`apps/api/src/wardrobe/item-photos.ts`).
- Produces :
  - File pg-boss `photo-import` (donnée : `{ importId }`), traitée par `runPhotoImport(importId, deps)` : télécharge,
    réencode, range l'objet sous `users/<userId>/<uuid>.webp`, passe l'import à `ready` (champs média remplis) ou à
    `failed` avec `errorCode` (`blocked` adresse refusée ou HTTP 4xx/5xx, `timeout`, `too_large`, `unsupported`,
    `failed` sinon). Aucun objet ne reste sur un échec.
  - `POST /api/me/items/{id}/media/imports` `{ url }` → 202 `{ importId }` ; mêmes limites que l'envoi
    (`pipeline.limits`) ; 400 adresse non `http(s)` ou > 2 048 caractères ; 404 article inconnu ; 409
    `too_many_photos` / `item_deleted` vérifiés avant de mettre en file.
  - `GET /api/me/items/{id}/media/imports/{importId}` → 200 `photoImportViewSchema` :
    `{ status: "queued" } | { status: "failed", error } | { status: "attached", item: ItemView }`. Quand l'import
    est `ready`, cette lecture le rattache (dans une transaction : ligne `media` + `attachPhoto`, via
    `pipeline.recordStored`) et le passe à `attached` ; si le rattachement est refusé (10 photos, corbeille), l'objet
    est supprimé et la réponse est `failed` avec `too_many_photos` ou `item_deleted`. Deux lectures simultanées ne
    rattachent qu'une fois (verrou sur la ligne d'import).
  - `MediaPipeline.recordStored(userId, stored: { id; key; contentType; sizeBytes; width; height }, attach)` : la
    partie « insérer `media` puis `attach` » de `record`, que `record` réutilise.

- [x] **Step 1 : tests.** Worker (avec `lookup`/`policy` injectés comme `copy-images`) : image PNG servie par un
  serveur local autorisé → `ready`, objet présent ; adresse privée → `failed/blocked`, aucun objet ; page HTML →
  `failed/unsupported` ; corps de 21 Mo → `failed/too_large`. API : POST puis GET `queued` ; import `ready` simulé →
  GET rattache et renvoie l'article avec une photo de plus ; deux GET en parallèle → une seule photo ; article à 10
  photos → 409 au POST ; import d'une autre utilisatrice → 404.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** implémentation. Le worker n'applique pas robots.txt aux photos (comme `copy-images`).
- [x] **Step 4 :** tests au vert.
- [x] **Step 5 :** commit `feat: photo ajoutée par lien`.

### Task 7: Fenêtre « Ajouter une photo »

**Files:**
- Create: `apps/web/src/components/add-photo-dialog.tsx`, `apps/web/src/lib/photo-source.ts` (+ test)
- Modify: `apps/web/src/app/(app)/produits/[id]/photo-manager.tsx`, `apps/web/src/lib/wardrobe-client.ts`
  (+ test), `packages/i18n/messages/fr.json` (`Item.addPhoto`)
- Test: `apps/web/src/lib/photo-source.test.ts`, `e2e/tests/photos.spec.ts`

**Interfaces:**
- Consumes : `uploadPhoto` (existant), routes d'import (Task 6), `checkPhoto` (`lib/photo-check.ts`), `pollUntil`
  (`lib/capture-poll.ts`).
- Produces : `photoSource(data: DataTransfer | null): { kind: "file"; file: File } | { kind: "url"; url: string } |
  { kind: "none" }` (premier fichier image, sinon texte qui est une adresse `http(s)`, sinon rien) ;
  `importPhoto(itemId, url, deps?)` et `fetchPhotoImport(itemId, importId, deps?)`.

- [x] **Step 1 : tests.** `photoSource` : fichier image → `file` ; fichier PDF seul → `none` ; texte
  `"https://x.test/a.jpg"` (espaces autour) → `url` ; texte `"bonjour"` → `none` ; `null` → `none`. E2E : coller
  une image (événement `paste` avec un `DataTransfer`) → photo ajoutée ; déposer un fichier → ajoutée ; coller une
  adresse → import par lien, attente puis photo ajoutée (le serveur de test sert l'image) ; texte non adresse →
  message « Colle une image ou un lien vers une image. » ; `axe` sans violation.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** un seul bouton « Ajouter une photo » ouvre la fenêtre (`components/dialog.tsx`) : zone qui
  accepte coller (Ctrl/Cmd+V partout dans la fenêtre) et glisser-déposer, bouton « Choisir un fichier »
  (`accept="image/*"`), bouton « Prendre une photo » (`capture="environment"`, seulement sur écran tactile), champ
  « Lien vers une image » + « Ajouter ». Pendant l'envoi ou l'import : état « Ajout… » ; la fenêtre se ferme sur le
  succès (message « Photo ajoutée » existant). Erreurs : celles de `Item.errors` existantes, plus
  `import_blocked` « Ce site ne laisse pas récupérer l'image. Enregistre-la puis ajoute le fichier. »,
  `import_timeout` « Le site n'a pas répondu à temps. », `import_unsupported` « Ce lien ne mène pas à une
  image. ». Le bouton n'apparaît plus à 10 photos.
- [x] **Step 4 :** tests au vert.
- [x] **Step 5 :** commit `feat(web): fenêtre « Ajouter une photo » (coller, glisser, fichier, lien)`.

### Task 8: Structure de la fiche

**Files:**
- Modify: `apps/web/src/app/(app)/produits/[id]/product-view.tsx`,
  `apps/web/src/app/(app)/produits/[id]/item-panel.tsx`, `packages/i18n/messages/fr.json`
- Test: `e2e/tests/layout.spec.ts`, `e2e/tests/capture.spec.ts`

**Interfaces:**
- Consumes : `ProductTraits`, `ProductDescription` (déjà livrés), `PhotoViewer` (Task 5).

- [x] **Step 1 : tests e2e.** Ordre des régions sur une fiche gardée : en-tête (`data-testid="product-header"` :
  boutique, marque, nom, prix, « Voir chez … »), puis `region` « Mon article », puis `region` « La fiche de la
  boutique » (tailles, caractéristiques, description, « Mis à jour le … »), puis « Autres actions » (déplacer vers
  un profil, supprimer). Fiche non gardée : en-tête, boutons « Garder cet article », « La fiche de la boutique ».
  Pas de défilement horizontal à 360 px ; `axe` sans violation.
- [x] **Step 2 :** lancer, vérifier l'échec.
- [x] **Step 3 :** mise en page : « Voir chez … » remonte dans l'en-tête ; « Mon article » dans un encadré
  (`rounded-card border border-line bg-surface-raised`) avec titres `h2` et sections dans l'ordre : étape (frise),
  taille et montants, notes, listes et étiquettes ; « La fiche de la boutique » sous un `h2` ; « Autres actions »
  en bas, séparé par une bordure. Aucune fonction ne change de comportement. Textes : `"sections": { "mine":
  "Mon article", "shop": "La fiche de la boutique", "more": "Autres actions" }` sous `Item`.
- [x] **Step 4 :** tests au vert sur les trois formats ; captures d'écran téléphone et ordinateur relues.
- [x] **Step 5 :** commit `feat(web): fiche structurée en trois parties`.

### Task 9: Docs et mise en service

**Files:**
- Modify: `docs/specs/2026-11-06-retours-tests-2a.md` (statuts), `docs/plans/2026-11-05-mise-en-service-chantier-1.md`
  (migration 0013 en dev et en prod, file `photo-import`), ce plan (cases et « Bilan »)

- [x] **Step 1 :** statuts des points 1 à 5 « fait sur la branche `finitions-2a` » ; liste de mise en service :
  0013 nouvelle en dev ; en prod, migrations 0007 à 0013 ; vérifier `photo-import` dans le journal du worker.
- [x] **Step 2 :** `pnpm test` et `pnpm e2e` complets au vert.
- [x] **Step 3 :** commit `docs: finitions du 2a`.

## Bilan de l'exécution

**Statut :** terminé sur la branche `finitions-2a` ; pas encore fusionné dans `dev`, ni déployé. Mise en service :
voir `docs/plans/2026-11-05-mise-en-service-chantier-1.md` (migration 0013, file `photo-import`).

Décisions prises pendant l'exécution :

- Tâche 7 : le test e2e de l'import par lien remplace les deux routes d'import de l'API par des réponses simulées
  (`page.route` de Playwright : en file, puis rattachée). Le vrai chemin de lecture est couvert par les tests du
  worker et de l'API (tâche 6) avec une politique d'adresses injectée, car le worker refuse les adresses locales par
  conception. Coût si on se trompe : le lien web ↔ API des imports n'est vérifié que par les tests unitaires de
  `wardrobe-client`.
- Tâche 3 : pas d'« Annuler » sur le ✕ d'un dernier lien (ce ne sont pas ses données, recoller le lien le
  rétablit). Coût si on se trompe : un petit « Annuler » à ajouter plus tard.
- Tâche 5 : la visionneuse d'une liste partagée n'affiche que la couverture de l'article (l'API ajoute
  `imageWidth` et `imageHeight`, pas toutes les photos), car la page publique n'expose que le contenu du G4 et les
  photos privées ne doivent pas fuiter. Coût si on se trompe : visionneuse à une seule photo sur les listes partagées.
- Tâche 5 : le test e2e du balayage sur téléphone passe par `scrollBy` sur la piste à accrochage (le balayage tactile
  de Playwright est peu fiable ; l'accrochage est natif). Coût si on se trompe : un défaut de balayage sur vrai
  téléphone ne se verrait qu'à la main.
- Tâche 6 : `recordStored` reçoit un 4e paramètre `claim`, ce qui corrige une vraie course à double rattachement qui
  supprimait l'objet du gagnant. Coût si on se trompe : une interface de pipeline un peu plus large.
- Tâche 6 : un rattachement refusé est enregistré en `failed`/`failed` (la contrainte de la base n'accepte que les
  codes du worker) ; seule la lecture qui rattache signale `too_many_photos` ou `item_deleted`. Coût si on se
  trompe : une lecture ultérieure affiche une erreur générique.
- Revue finale : une photo donnée par lien est aussi rattachée côté serveur à la lecture de l'article
  (`GET /api/me/items/{id}` et la liste `GET /api/me/items`, dont la lecture de la fiche par produit), avec le même
  rattachement verrouillé que l'interrogation de l'import. Fermer la fenêtre, quitter la page ou l'abandon de
  l'attente (~75 s) ne perdent donc plus la photo : elle est sur la fiche au prochain chargement, et la fenêtre dit
  « La photo arrive : elle apparaîtra sur la fiche dans un instant. » quand l'attente abandonne. Une fusion
  d'articles emporte aussi leurs imports de photo. Coût si on se trompe : une requête de plus (indexée, vide en
  général) à chaque lecture d'article.
