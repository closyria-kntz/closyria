# Avis des amies (partie 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les amies donnent un avis (prénom, niveau de la fondatrice, petit mot) sur les articles d'une liste partagée, la fondatrice les voit dans l'app, et le lien de partage reste visible.

**Architecture:** Deux tables (`wishlist_opinions`, `wishlist_opinion_devices`) et cinq colonnes sur `wishlists`. API publique sous `/api/shared/{token}` (lecture étendue, écrire/effacer un avis avec une clé d'appareil), API de la fondatrice sous `/api/me/wishlists/...`. Le lien est chiffré (AES-256-GCM, clé `SHARE_LINK_KEY` passée par les dépendances). Côté web : la page `/l/[token]` gagne un composant client d'avis ; la fenêtre « feuille » de l'aperçu est factorisée et réutilisée.

**Tech Stack:** Hono + @hono/zod-openapi, Drizzle/Postgres, Zod (`packages/shared`), Next 16 + next-intl, Tailwind 4 + design tokens, Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-07-avis-des-amies.md`

## Global Constraints

- Code en anglais, interface et docs en français ; textes dans `packages/i18n/messages/fr.json`.
- Toute donnée qui traverse une frontière est validée par Zod ; les schémas vivent dans `packages/shared`.
- Aucune valeur Tailwind arbitraire, aucun style en ligne (`pnpm lint` lance `check-design-tokens`) ; couleurs par tokens uniquement.
- Prénom : 1 à 40 caractères après `trim()` ; petit mot : ≤ 200 caractères ; niveau : entier 1 à 4.
- Adresse web refusée dans le petit mot, message exact : « Les liens ne sont pas acceptés dans les avis. »
- Limites : 30 avis écrits/modifiés par heure par (clé d'appareil, liste) ; 120 par heure par (adresse réseau, liste) ; message : « Tu as donné beaucoup d'avis d'un coup. Réessaie dans un moment. »
- Réglages par liste et défauts : `allowOpinions` vrai, `showOwnerName` vrai, `showOwnerOpinions` vrai, `showBudget` faux.
- Le lien public ne montre jamais : photos privées, notes, tailles, profils, période du budget, déjà commandé.
- La clé d'appareil n'est jamais stockée en clair (SHA-256) ; le jeton de partage reste cherché par son empreinte (`share_token_hash`).
- `SHARE_LINK_KEY` : 32 octets en base64, obligatoire ; jamais dans le dépôt.
- Commits : `git -c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com commit`, message terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Avant les tests navigateur : `pnpm build` ; tests : `cd e2e && npx playwright test`.

## Review Focus

1. Deux envois simultanés du même prénom sur le même article → un seul avis, jamais d'erreur 500 (contrainte unique → réponse propre). Test : Task 4.
2. Stockage local indisponible (navigation privée, accès refusé) → l'amie peut quand même envoyer un avis pendant la visite (clé gardée en mémoire), sans plantage. Test : Task 7.
3. Prénoms et petits mots avec émojis ou accents combinés → la limite compte pareil à l'écran et dans l'API (même fonction de longueur partagée). Test : Task 1.
4. Une liste partagée avant cette version (empreinte seule) → l'ancien lien marche toujours et la page propose « Créer un lien à garder ». Test : Task 3.
5. La fondatrice renomme un niveau après des avis → le lien et l'app affichent le nouveau nom. Test : Task 4.

---

### Task 1: Schémas partagés des avis

**Files:**
- Create: `packages/shared/src/opinions.ts`
- Create: `packages/shared/src/opinions.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `packages/shared/src/wardrobe.ts` (`sharedWishlistViewSchema`, `wishlistViewSchema`, `shareResultSchema`)

**Interfaces:**
- Produces:
  - `OPINION_NAME_MAX = 40`, `OPINION_NOTE_MAX = 200`
  - `textLength(value: string): number` — nombre de graphèmes (`Intl.Segmenter`)
  - `opinionNameKey(name: string): string` — `trim`, espaces multiples réduits, minuscules (`toLocaleLowerCase("fr")`)
  - `containsWebAddress(text: string): boolean`
  - `deviceKeySchema` (base64url, 22 à 64 caractères)
  - `opinionInputSchema = { name, level: loveLevelSchema, note: string|null, deviceKey, claim?: boolean }`
  - `opinionDeleteSchema = { name, deviceKey }`
  - `opinionViewSchema = { id: uuid, name, level, note: string|null, createdAt, updatedAt, isNew: boolean }`
  - `wishlistSettingsSchema = { allowOpinions, showOwnerName, showOwnerOpinions, showBudget }` (booléens)
  - `sharedWishlistViewSchema` étendu : `ownerName: string|null`, `allowOpinions: boolean`, `levels: LoveLevelView[]`, `budget: { amountCents, currency } | null`, et par article `itemId: uuid`, `ownerOpinion: { level: LoveLevel|null, priority: boolean, why: string|null } | null`, `opinions: OpinionView[]` (`isNew` toujours faux côté public)
  - `wishlistViewSchema` étendu : `...wishlistSettingsSchema`, `newOpinions: number`
  - `shareLinkSchema = { url: string|null, legacy: boolean }`
  - `wishlistOpinionsSchema = { items: { itemId: uuid, opinions: OpinionView[] }[] }`
  - `itemOpinionsSchema = { lists: { wishlistId, wishlistName, opinions: OpinionView[] }[] }`
  - code d'erreur `"name_taken" | "opinions_closed" | "web_address" | "rate_limited"` ajoutés à `wardrobeErrorSchema`

- [x] **Step 1: Écrire les tests** (`opinions.test.ts`) :
  - `textLength("Léa 🔥👩‍👩‍👧")` vaut 6 ; `opinionInputSchema` refuse un nom de 41 graphèmes et accepte 40 graphèmes d'émojis.
  - `opinionNameKey("  Léa   M. ")` → `"léa m."` ; `opinionNameKey("LÉA")` → `"léa"`.
  - `containsWebAddress` vrai pour `"va sur http://x.fr"`, `"www.zara.com"`, `"zara.com/robe"`, `"Shop.FR"` ; faux pour `"trop bien !"`, `"taille 38.5"`, `"j'adore... vraiment"`.
  - `opinionInputSchema` refuse `level: 5`, une note de 201 graphèmes, un `deviceKey` de 10 caractères ; accepte `note: null`.
- [x] **Step 2: Lancer** `pnpm --filter @closyria/shared test` → échec (module absent).
- [x] **Step 3: Implémenter** `opinions.ts` et étendre `wardrobe.ts`. Règle d'adresse web : `/(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|fr|net|org|io|shop|store|co|eu|be|ch|ca|uk|de|it|es)\b/i`.
- [x] **Step 4: Lancer** `pnpm --filter @closyria/shared test` → PASS ; `pnpm typecheck` → les usages existants cassés par les nouveaux champs sont recensés (corrigés aux tâches 3 à 5 ; si la compilation de l'API casse, ajouter les champs avec des valeurs par défaut dans `listWishlistViews` / `loadSharedView` dès cette tâche).
- [x] **Step 5: Commit** `feat(shared): schémas des avis des amies`.

### Task 2: Migration (colonnes de `wishlists`, tables d'avis)

**Files:**
- Modify: `packages/db/src/schema/wardrobe.ts`
- Create: migration générée par `pnpm --filter @closyria/db generate` (dans `packages/db/migrations`)
- Modify: `apps/api/src/owned-tables.ts` et son test si les nouvelles tables doivent y figurer (suivre la règle du fichier).

**Interfaces:**
- Produces: `schema.wishlists.{shareTokenEncrypted, allowOpinions, showOwnerName, showOwnerOpinions, showBudget, opinionsSeenAt}` ; `schema.wishlistOpinions` (`id, wishlistId, itemId, authorName, authorNameKey, level, note, createdAt, updatedAt`, unique `(wishlistId, itemId, authorNameKey)`, index `(wishlistId, updatedAt)`, checks : longueur nom 1–40 en caractères, `level BETWEEN 1 AND 4`, note ≤ 400 octets-caractères pour tolérer les graphèmes multi-points) ; `schema.wishlistOpinionDevices` (`wishlistId, authorNameKey, deviceKeyHash, createdAt`, PK sur les trois premiers).
- Suppression en cascade depuis `wishlists` et `items`.

- [x] **Step 1:** Ajouter les colonnes et tables (défauts selon Global Constraints, `opinionsSeenAt` nullable).
- [x] **Step 2:** `pnpm --filter @closyria/db generate` → une nouvelle migration SQL ; la relire (aucune suppression).
- [x] **Step 3:** `pnpm --filter @closyria/api test` → `owned-tables.test.ts` dit si les tables doivent être déclarées ; corriger jusqu'au vert.
- [x] **Step 4: Commit** `feat(db): avis des amies et réglages de partage`.

### Task 3: Lien de partage chiffré

**Files:**
- Create: `apps/api/src/wardrobe/share-link.ts`, `apps/api/src/wardrobe/share-link.test.ts`
- Modify: `apps/api/src/env.ts` (+ `SHARE_LINK_KEY`), `apps/api/src/env.test.ts`
- Modify: `apps/api/src/wardrobe/deps.ts` (+ `shareLinkKey: Buffer`), `apps/api/src/bootstrap.ts`, `apps/api/src/catalog/test-app.ts` (clé de test fixe), `e2e/fixtures/stack.ts` (`SHARE_LINK_KEY: randomBytes(32).toString("base64")`)
- Modify: `apps/api/src/routes/me/wishlists.ts` (route share POST ; nouvelle route GET), `apps/api/src/routes/me/wishlists.integration.test.ts`
- Modify: `deploy/README.md` (ajouter la variable et la commande pour la générer : `openssl rand -base64 32`)

**Interfaces:**
- Produces: `encryptShareToken(token: string, key: Buffer): string` (format `v1.<iv b64url>.<tag b64url>.<data b64url>`) ; `decryptShareToken(value: string, key: Buffer): string | null` (null si altéré ou mauvaise clé) ; `parseShareLinkKey(value: string): Buffer` (exactement 32 octets) ; route `GET /api/me/wishlists/{id}/share` → `shareLinkSchema`.

- [x] **Step 1: Tests** : chiffrer puis déchiffrer redonne le jeton ; un caractère changé → `null` ; une autre clé → `null` ; `envSchema` refuse une clé absente ou de 31 octets. Intégration : après `POST .../share`, `GET .../share` renvoie `{ url: "/l/<même jeton>", legacy: false }` ; une liste dont on efface `share_token_encrypted` en base (simule l'ancien partage) renvoie `{ url: null, legacy: true }` et `GET /api/shared/<ancien jeton>` répond 200 ; liste non partagée → `{ url: null, legacy: false }` ; liste d'une autre utilisatrice → 404.
- [x] **Step 2:** Lancer les tests → échec.
- [x] **Step 3:** Implémenter (AES-256-GCM via `node:crypto`, IV 12 octets aléatoires). `POST .../share` enregistre `shareTokenHash` et `shareTokenEncrypted` ; `DELETE .../share` efface les deux et les avis de la liste.
- [x] **Step 4:** `pnpm --filter @closyria/api test` → PASS.
- [x] **Step 5: Commit** `feat(api): lien de partage gardé chiffré`.

### Task 4: API publique des avis

**Files:**
- Create: `apps/api/src/wardrobe/opinions.ts` (accès aux données des avis)
- Modify: `apps/api/src/routes/shared.ts`, `apps/api/src/wardrobe/wishlists.ts` (`loadSharedView`)
- Create: `apps/api/src/routes/shared.integration.test.ts` (ou étendre l'existant)

**Interfaces:**
- Consumes: Task 1 (schémas), Task 2 (tables).
- Produces:
  - `GET /api/shared/{token}` → `sharedWishlistViewSchema` étendu (prénom = premier mot de `user.name` si `showOwnerName`, sinon null ; `ownerOpinion` null si `showOwnerOpinions` est faux ou si rien n'est renseigné ; `budget` = montant et devise du budget de la liste si `showBudget`, sinon null ; `levels` = niveaux de la fondatrice avec défauts).
  - `PUT /api/shared/{token}/items/{itemId}/opinion` body `opinionInputSchema` → 200 `opinionViewSchema` ; 404 si l'article n'est pas dans la liste ; 403 `opinions_closed` ; 422 `web_address` ; 409 `name_taken` ; 429 `rate_limited`.
  - `DELETE /api/shared/{token}/items/{itemId}/opinion` body `opinionDeleteSchema` → 204 ; 403 si la clé n'est pas rattachée au prénom.
  - `upsertOpinion(db, input)`, `deleteOpinion(db, input)`, `opinionsByItem(db, wishlistId, seenAt: Date|null)` dans `wardrobe/opinions.ts`.
- Règle `name_taken` : si `(wishlistId, nameKey)` a déjà des appareils et que `sha256(deviceKey)` n'en fait pas partie → 409, sauf `claim: true` qui ajoute l'appareil. Si aucun appareil n'existe pour ce prénom, l'appareil est ajouté.

- [x] **Step 1: Tests d'intégration** :
  - écrire puis relire un avis (il apparaît dans `GET`, `isNew` faux) ; le réécrire avec la même clé le remplace (un seul avis) ;
  - même prénom en majuscules depuis une autre clé → 409 `name_taken` ; avec `claim: true` → 200 et remplace ;
  - une autre clé ne peut pas effacer (403) ; la bonne efface (204) ;
  - `allowOpinions` faux → 403 `opinions_closed`, les avis existants restent dans `GET` ;
  - note `"www.zara.com"` → 422 `web_address` ;
  - 31e écriture en une heure avec la même clé → 429 ;
  - deux `PUT` simultanés (`Promise.all`) même prénom, même clé → deux 200, un seul avis en base (Review Focus 1) ;
  - retirer l'article de la liste efface ses avis ; arrêter le partage efface tous les avis ;
  - la vue publique ne contient ni `notes`, ni `sizeLabel`, ni photos privées, ni période du budget (vérifier les clés JSON) ; `budget` null tant que `showBudget` est faux ;
  - renommer un niveau via `PUT /api/me/love-levels` → `levels` du `GET` public suit (Review Focus 5).
- [x] **Step 2:** Lancer → échec.
- [x] **Step 3:** Implémenter. Upsert par `INSERT ... ON CONFLICT (wishlist_id, item_id, author_name_key) DO UPDATE`. Limites : deux `rateLimit` (Global Constraints), clés `deviceKeyHash + listId` et `adresse + listId`. Retirer un article (`DELETE /me/wishlists/{id}/items/{itemId}`) efface ses avis dans la même transaction.
- [x] **Step 4:** `pnpm --filter @closyria/api test` → PASS.
- [x] **Step 5: Commit** `feat(api): avis des amies sur le lien de partage`.

### Task 5: API de la fondatrice (réglages, avis, vus, effacer, rafraîchissement)

**Files:**
- Modify: `apps/api/src/routes/me/wishlists.ts`, `apps/api/src/wardrobe/wishlists.ts` (`listWishlistViews` : réglages + `newOpinions`)
- Modify: `apps/api/src/routes/me/items.ts` (avis d'un article) ou nouvelle route dans `routes/me/wishlists.ts`
- Modify: `apps/api/src/routes/me/changes.ts` (+ `wishlist_opinions`, + colonnes de réglage), tests associés
- Modify: `apps/web/src/lib/wardrobe-client.ts` (fonctions client ci-dessous)

**Interfaces:**
- Produces (API) :
  - `PATCH /api/me/wishlists/{id}` accepte en plus `wishlistSettingsSchema.partial()`.
  - `GET /api/me/wishlists/{id}/opinions` → `wishlistOpinionsSchema` (`isNew` = `updatedAt > opinionsSeenAt`).
  - `POST /api/me/wishlists/{id}/opinions/seen` → 204 (met `opinionsSeenAt = now()`).
  - `DELETE /api/me/wishlists/{id}/opinions/{opinionId}` → 200 `{ opinion: OpinionView & { itemId } }` (pour « Annuler ») ; `POST /api/me/wishlists/{id}/opinions/restore` body = cet objet → 201.
  - `GET /api/me/items/{id}/opinions` → `itemOpinionsSchema` (listes partagées de la fondatrice contenant l'article).
- Produces (client web) : `fetchWishlistOpinions(id)`, `markOpinionsSeen(id)`, `deleteOpinion(listId, opinionId)`, `restoreOpinion(listId, opinion)`, `fetchItemOpinions(itemId)`, `fetchShareLink(id)`, `patchWishlistSettings(id, patch)`.

- [x] **Step 1: Tests d'intégration** : réglages modifiés puis relus ; `newOpinions` compte les avis postérieurs à `opinionsSeenAt` et tombe à 0 après `seen` ; effacer puis restaurer redonne le même avis ; une autre utilisatrice → 404 partout ; l'empreinte de `/api/me/changes` change après un avis d'amie et après un changement de réglage.
- [x] **Step 2:** Lancer → échec. **Step 3:** Implémenter. **Step 4:** `pnpm --filter @closyria/api test` → PASS.
- [x] **Step 5: Commit** `feat(api): avis reçus, réglages de partage, vus`.

### Task 6: Feuille réutilisable (factorisation de l'aperçu)

**Files:**
- Create: `apps/web/src/components/sheet.tsx`
- Modify: `apps/web/src/components/item-preview.tsx` (utilise `Sheet`)

**Interfaces:**
- Produces: `Sheet({ open: boolean, onClose: () => void, labelledBy: string, closeLabel: string, hint: string, wide?: boolean, children, footer })` — `<dialog>` natif, feuille du bas sur téléphone, panneau à droite (`wide`) ou centré sur ordinateur, fermeture « Fermer » / Échap / clic à côté / glisser 80 px (`PREVIEW_DRAG_CLOSE_PX` déplacé ici sous le nom `SHEET_DRAG_CLOSE_PX`), `data-testid="preview-handle"` et `"preview-body"` conservés.

- [x] **Step 1:** Lancer `cd e2e && npx playwright test order-draft` (après `pnpm build`) → vert avant de toucher (référence).
- [x] **Step 2:** Extraire `Sheet` ; `ItemPreview` ne garde que son contenu.
- [x] **Step 3:** `pnpm lint && pnpm typecheck && pnpm build`, puis `npx playwright test order-draft` → toujours vert (même comportement).
- [x] **Step 4: Commit** `refactor(web): feuille réutilisable pour l'aperçu et les avis`.

### Task 7: Page publique : voir et donner un avis

**Files:**
- Create: `apps/web/src/lib/friend-device.ts`, `apps/web/src/lib/friend-device.test.ts`
- Create: `apps/web/src/app/l/[token]/opinions.tsx` (client), `apps/web/src/app/l/[token]/opinion-sheet.tsx`
- Modify: `apps/web/src/app/l/[token]/page.tsx`, `apps/web/src/lib/shared-list.ts` (client des routes publiques)
- Modify: `packages/i18n/messages/fr.json` (`SharedList.opinions.*`)
- Create: `e2e/tests/opinions.spec.ts`

**Interfaces:**
- Consumes: Task 4 (routes publiques), Task 6 (`Sheet`).
- Produces: `friendDevice(storage: Storage | null): { key: string; name: string | null; setName(name: string): void }` — clé `closyria-friend` dans le stockage local (`{ key, name }`), clé générée par `crypto.getRandomValues` (16 octets base64url) ; si le stockage lève une erreur, clé gardée en mémoire pour la visite.

- [x] **Step 1: Tests unitaires** `friend-device.test.ts` : première visite → clé de 22 caractères et `name` null ; `setName("Léa")` puis nouvel appel → même clé, `name` « Léa » ; stockage qui lève → une clé quand même, pas d'exception (Review Focus 2).
- [x] **Step 2: Test navigateur** `opinions.spec.ts` « une amie donne son avis » : la fondatrice crée une liste avec « Robe Alma », met 🔥 et « Pour le mariage », partage ; dans un **nouveau contexte** (sans session) : la page montre « La liste de {prénom} », son avis en rose léger ; « Donner mon avis » → prénom « Léa », 🔥, « elle t'irait trop bien » → « Avis envoyé · Annuler », l'avis apparaît ; recharger → « Modifier mon avis », prénom retenu ; un **autre contexte** avec « léa » → « Une Léa a déjà donné son avis sur cette liste. C'est toi ? » → « Non » propose « Léa M. » ; note « www.zara.com » → « Les liens ne sont pas acceptés dans les avis. » ; « Effacer mon avis » puis « Annuler » le remet ; `axe` sans violation ; clair et sombre (attribut `data-theme`).
- [x] **Step 3:** Lancer → échec. **Step 4:** Implémenter (toasts locaux à la page publique avec `role="status"` ; textes exacts de la spec § 3 ; compteur du petit mot affiché à partir de 150 caractères ; « Ce n'est pas moi » sous le prénom ; sur ordinateur la fenêtre est centrée, `Sheet` sans `wide`). **Step 5:** `pnpm build` puis `npx playwright test opinions` → PASS.
- [x] **Step 6: Commit** `feat(web): les amies donnent leur avis sur le lien de partage`.

### Task 8: La fondatrice : partage, réglages, avis reçus

**Files:**
- Modify: `apps/web/src/components/share-panel.tsx`, `apps/web/src/components/wishlist-detail.tsx`, `apps/web/src/components/wishlists-view.tsx`
- Create: `apps/web/src/components/friend-opinions.tsx` (liste d'avis, partagée avec la Task 9)
- Modify: `packages/i18n/messages/fr.json` (`Wishlists.share.*`, `Wishlists.opinions.*`)
- Modify: `e2e/tests/lists.spec.ts`, `e2e/tests/opinions.spec.ts`

**Interfaces:**
- Consumes: Task 5 (client web).
- Produces: `FriendOpinions({ opinions: OpinionView[], levels: LoveLevelView[], onDelete?: (o: OpinionView) => void })` — initiale, prénom, émoji + nom du niveau, petit mot (texte brut), date relative (`Intl.RelativeTimeFormat`, puis date), pastille « nouveau » si `isNew`.

- [x] **Step 1: Tests navigateur** :
  - partage : le lien s'affiche, « Copier le lien » → « Lien copié » ; « Changer le lien » demande « L'ancien lien ne marchera plus. » puis l'ancien lien donne la page « introuvable » ; « Envoyer… » visible seulement si `navigator.share` existe ;
  - réglages : couper « Montrer mes avis » → le lien n'affiche plus son avis ; activer « Montrer le budget » → « Budget de la liste : 150 € » ; couper « Autoriser les avis » → « Les avis sont fermés sur cette liste. » ; couper « Montrer mon prénom » → pas de « La liste de » ;
  - avis reçus : après l'avis de Léa, « Listes » montre « 1 nouvel avis » ; la liste montre l'avis avec « nouveau » ; revenir sur « Listes » → plus de pastille ; « Effacer » → « Avis de Léa effacé · Annuler » → « Annuler » le remet ;
  - liste partagée avant la version (empreinte seule, préparée par l'API de test ou en effaçant le chiffré) → « Ce lien ne peut pas être réaffiché. » et « Créer un lien à garder ».
- [x] **Step 2:** Lancer → échec. **Step 3:** Implémenter (interrupteurs en `role="switch"`, enregistrés aussitôt avec annulation en cas d'échec ; pastille avec les tokens `danger-soft/edge`). **Step 4:** `pnpm build`, tests → PASS.
- [x] **Step 5: Commit** `feat(web): lien visible, réglages de partage et avis reçus`.

### Task 9: Avis des amies sur la fiche et dans l'aperçu de commande

**Files:**
- Modify: `apps/web/src/app/(app)/produits/[id]/item-panel.tsx` (ou le composant qui affiche l'article gardé), `apps/web/src/components/item-preview.tsx`
- Modify: `packages/i18n/messages/fr.json`
- Modify: `e2e/tests/opinions.spec.ts`

**Interfaces:**
- Consumes: `fetchItemOpinions` (Task 5), `FriendOpinions` (Task 8).

- [x] **Step 1: Test navigateur** : après l'avis de Léa, l'aperçu de « Préparer une commande » et la fiche de « Robe Alma » montrent « Avis des amies » avec Léa 🔥 ; le nom de la liste apparaît seulement si l'article est dans plusieurs listes partagées ; sans avis, la section n'apparaît pas.
- [x] **Step 2:** Lancer → échec. **Step 3:** Implémenter. **Step 4:** `pnpm build`, tests → PASS.
- [x] **Step 5: Commit** `feat(web): avis des amies sur la fiche et dans l'aperçu`.

### Task 10: Vérification complète et documentation

**Files:**
- Modify: `docs/specs/2026-11-07-avis-des-amies.md` (statut, écarts éventuels), `docs/plans/2026-11-08-avis-des-amies.md` (cases cochées)

- [x] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, puis `cd e2e && npx playwright test` → tout vert (un échec instable connu — visionneuse photo, mise en page 1440 px — se relance seul et se signale).
- [x] **Step 2:** Relecture design de la page publique et du bloc Partage avec `interface-design:design-review` et `web-design-guidelines` ; rapporter, ne corriger que sur accord.
- [x] **Step 3:** Mettre à jour le statut de la spec (« livrée en dev, à tester ») et cocher le plan.
- [x] **Step 4: Commit** `docs: avis des amies livrés en dev`.
- [ ] **Step 5 (sur accord de la fondatrice uniquement) :** elle ajoute `SHARE_LINK_KEY` dans `/etc/closyria/dev.env` depuis son terminal ; puis `git push origin dev`, `deploy/build.sh origin/dev`, `sudo -n /usr/local/bin/closyria-deploy dev <id>`.
