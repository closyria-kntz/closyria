# Envies chaleureuses (partie 1) — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remplacer « Favori » par 4 niveaux d'amour personnalisables, ajouter « Prioritaire », l'avis, le menu « … », le
mode « Sélectionner », « Préparer une commande » avec budgets (profil et liste, par période) et la palette C.

**Architecture:** une migration ajoute les colonnes des articles, `item_events.spent_cents`, les tables `love_levels`
et `budgets`, et reprend les favoris. Les nouveaux champs passent par `PATCH` et l'opération de lot `setFields`
existantes (annulation comprise). Le budget se calcule à la lecture depuis les événements d'étape. Le web remplace le
♡ et les cases par une pastille de niveau, un menu et un mode de sélection.

**Tech Stack:** Drizzle + PostgreSQL 18, Hono + `@hono/zod-openapi`, Zod (`packages/shared`), Next 16, next-intl
(`packages/i18n/messages/fr.json`), Tailwind 4 et `packages/design-tokens`, Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-07-envies-chaleureuses.md` (maquette : https://claude.ai/artifact/Q6tEj3ZNKbrXbunv6B1LTQ,
rangée « Palette C »).

## Global Constraints

- Code en anglais, interface et documents en français ; Biome (`pnpm format`) ; Zod à chaque frontière ; schémas
  partagés dans `packages/shared` uniquement.
- Pas de valeur arbitraire Tailwind (`scripts/check-design-tokens.ts`) : tout nouveau jeton passe par
  `packages/design-tokens`, puis `pnpm --filter @closyria/design-tokens build:css`.
- Niveaux : 1 Bof 😕, 2 J'aime 🤍, 3 Mims 🥰, 4 En feu 🔥 ; exactement 4 ; nom ≤ 20 caractères ; émoji = un seul
  graphème (`Intl.Segmenter`), ≤ 16 octets.
- Avis (`why`) ≤ 200 caractères. Les anciens favoris deviennent J'aime (2).
- Changer de niveau ne supprime jamais un article.
- Budgets : un par profil et un par liste au plus ; périodes `week` (lundi→dimanche), `month`, `custom`
  (`startsOn`…`endsOn` inclus), `none` (depuis `resetAt`) ; calcul en heure `Europe/Paris`.
- « Déjà commandé » = somme des `spent_cents` des événements `ordered` de la période, moins ceux des événements
  `returned` de la période ; `spent_cents` = montant saisi, sinon prix courant du produit, sinon 0.
- Toute action garde son message « … · Annuler » (8 s).
- Commits : `git -c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com commit`,
  message terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : rebuild web (`pnpm turbo run build --filter=@closyria/web --filter=@closyria/api`) avant `pnpm e2e`.
  `photos.spec.ts` « 3 / 3 » est instable (connu) : relancer avant de conclure.

## Review Focus

1. Changement de semaine ou de mois autour de minuit à Paris (dimanche 23:30 vs lundi 00:30, heure d'été/hiver) :
   l'achat compte dans la bonne période. → test dans Task 4.
2. « Annuler » après « J'ai commandé » : les articles reviennent en Envies **et** cochés, et « Déjà commandé » revient
   à l'ancien montant. → test dans Task 5.
3. Un article de la sélection qui quitte les Envies (autre étape, corbeille, autre profil) sort de la sélection et du
   total. → test dans Task 5.
4. Fusion anonyme → compte avec le même produit des deux côtés (niveaux, prioritaire, avis, sélection différents).
   → test dans Task 1.
5. Niveaux personnalisés avec un émoji composé (👩🏽‍🦱, drapeaux) ou deux émojis : un graphème accepté, deux refusés.
   → test dans Task 3.

---

### Task 1: Données et API des articles (niveau, prioritaire, avis, sélection)

**Files:**
- Modify: `packages/db/src/schema/wardrobe.ts` (items, item_events), new tables in the same file
- Create: `packages/db/migrations/0014_*.sql` via `pnpm --filter @closyria/db generate`, then edit the SQL for the
  backfill
- Modify: `packages/shared/src/wardrobe.ts`, `packages/shared/src/wardrobe.test.ts`
- Modify: `apps/api/src/wardrobe/{items,item-view,bulk,undo,merge-items}.ts`, `apps/api/src/routes/me/items.ts`
- Test: `apps/api/src/routes/me/items.integration.test.ts`, `bulk.integration.test.ts`,
  `apps/api/src/wardrobe/merge.integration.test.ts`, `packages/db` migration test if present

**Interfaces:**
- Produces (shared): `loveLevelSchema = z.number().int().min(1).max(4)`, `type LoveLevel`;
  `MAX_WHY = 200`; `itemViewSchema` gains `loveLevel: loveLevelSchema.nullable()`, `priority: z.boolean()`,
  `why: z.string().nullable()`, `inOrderDraft: z.boolean()` and loses `favorite`;
  `itemPatchSchema` gains `loveLevel` (nullable optional), `priority`, `why` (nullable, ≤ 200), `inOrderDraft`, loses
  `favorite` (so `itemFieldsSchema`/`setFields` carry them);
  `itemCreateSchema.action`: `"wish" | "list" | "ordered"` plus optional `loveLevel`, `priority`, `why`;
  `itemListQuerySchema`: `loveLevel: z.string()` → comma list of 1–4 (parsed to `LoveLevel[]`), `priority: z.stringbool()`,
  `orderDraft: z.stringbool()`, no `favorite`; `itemSortSchema` gains `"love"`; bulk op `setFavorite` removed.
- Produces (db): `items.loveLevel` smallint null check 1–4, `items.priority` bool default false, `items.why` text ≤ 200,
  `items.inOrderDraft` bool default false, index `items_order_draft_idx (user_id, profile_id) where in_order_draft`;
  `itemEvents.spentCents` integer null ≥ 0; tables `loveLevels` and `budgets` (columns in Tasks 3 and 4, created here
  so there is one migration).
- `budgets`: `id uuid`, `user_id`, `profile_id` null fk cascade, `wishlist_id` null fk cascade, check exactly one,
  `amount_cents int > 0`, `period text` in (`week`,`month`,`custom`,`none`), `starts_on date`, `ends_on date`
  (both required iff `custom`, `starts_on <= ends_on`), `reset_at timestamptz`, `created_at`, `updated_at`; unique
  partial indexes on `profile_id` and on `wishlist_id`.
- `love_levels`: `user_id` fk cascade, `level smallint` 1–4, `emoji text`, `label text` ≤ 20, pk (`user_id`, `level`).

- [ ] **Step 1: Write the failing tests**
  - `items.integration.test.ts`: « keeps a wish with its level, priority and opinion »: `POST /api/me/items`
    `{productId, action:"wish", loveLevel:3, priority:true, why:"Trop mims"}` → 201, item `stage:"spotted"`,
    `loveLevel:3`, `priority:true`, `why:"Trop mims"`, `inOrderDraft:false`; without `loveLevel` → `loveLevel:2`.
  - « refuses a level outside 1–4 and an opinion over 200 characters » → 400 for `loveLevel:5`, `loveLevel:0`,
    `why: "x".repeat(201)`.
  - « clearing the level never deletes the item »: PATCH `{loveLevel:null}` → 200, item still active.
  - « filters by levels and priority, sorts by love »: items at levels 4, 2, null, 4+priority → `?loveLevel=4` gives
    the two level-4, `?priority=true` one, `?sort=love` order `[4+priority, 4, 2, null]` and paginates with a cursor
    (page size forced small through the existing test helper, or 50 items).
  - `bulk.integration.test.ts`: « setFields sets level and priority on many and undo restores them ».
  - migration: a seeded item with `favorite=true` reads back `loveLevel:2`, a non-favorite `null`.
  - `merge.integration.test.ts`: « merging keeps the highest level, priority if either, the target's opinion
    else the source's, draft if either » (Review Focus 4).
- [ ] **Step 2: Run them** — `pnpm --filter @closyria/api test -- items bulk merge` → FAIL (unknown action `wish`,
  missing fields).
- [ ] **Step 3: Schema, migration, shared schemas.** Generate the migration, then add before the column drop:
  `update items set love_level = 2 where favorite;` and drop `favorite`.
- [ ] **Step 4: API.** `createItem` writes level (default 2 for `wish`), priority, why; `toItemView` maps the fields;
  `listItems` adds the filters and the `love` keyset `[coalesce(love_level,0), priority::int, created_at, id]`
  descending; delete the `setFavorite` op and its undo; `mergeItems` per the test.
- [ ] **Step 5: Run** — `pnpm --filter @closyria/api test` and `pnpm --filter @closyria/shared test` → PASS;
  `pnpm typecheck` shows only web errors (fixed in Tasks 7–9; leave the web compiling by replacing `favorite` reads
  with `loveLevel !== null` where the build breaks, nothing more).
- [ ] **Step 6: Commit** — `feat: niveaux d'amour, prioritaire, avis et sélection sur les articles (données et API)`

### Task 2: Montant compté au passage à « Commandé » et « Renvoyé »

**Files:**
- Create: `apps/api/src/wardrobe/spent.ts`
- Modify: `apps/api/src/wardrobe/{events,items,bulk}.ts`
- Test: `apps/api/src/wardrobe/spent.integration.test.ts`

**Interfaces:**
- Consumes: `itemEvents.spentCents` (Task 1).
- Produces: `spentCentsFor(tx: Tx, itemIds: string[], stage: ItemStage, amountCents: number | null | undefined): Promise<Map<string, number | null>>`
  — `ordered`: `amountCents ?? product.priceCents ?? null`; `returned`: the `spent_cents` of the item's latest
  `ordered` event; other stages: `null`. `recordEvent` and the bulk `stage` insert write it.

- [ ] **Step 1: Tests** — « an order records the amount typed, else the shop price, else nothing »; « a return records
  what its order counted »; « a keep with action ordered records the shop price »; « undo of the stage change
  removes the event (nothing counted) ».
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (`pnpm --filter @closyria/api test -- spent items bulk`).
- [ ] **Step 5: Commit** — `feat(api): montant compté au passage à Commandé et Renvoyé`

### Task 3: Mes niveaux (API)

**Files:**
- Create: `apps/api/src/routes/me/love-levels.ts`, `apps/api/src/routes/me/love-levels.integration.test.ts`
- Modify: `apps/api/src/app.ts` (mount), `packages/shared/src/wardrobe.ts`

**Interfaces:**
- Produces: `DEFAULT_LOVE_LEVELS: readonly LoveLevelView[]` =
  `[{level:1,emoji:"😕",label:"Bof"},{level:2,emoji:"🤍",label:"J’aime"},{level:3,emoji:"🥰",label:"Mims"},{level:4,emoji:"🔥",label:"En feu"}]`;
  `loveLevelViewSchema {level, emoji, label}`; `loveLevelsSchema = z.object({ levels: z.array(loveLevelViewSchema).length(4) })`
  with refine levels exactly 1,2,3,4 once; `isSingleEmoji(value: string): boolean` (one grapheme via
  `Intl.Segmenter`, ≤ 16 bytes, `\p{Extended_Pictographic}` or a flag/keycap sequence).
  Routes: `GET /me/love-levels` → `{levels}` (defaults when none stored); `PUT /me/love-levels` → replaces all four,
  returns `{levels}`; `DELETE /me/love-levels` → back to defaults, 204.

- [ ] **Step 1: Tests** — defaults for a new account; PUT then GET returns the new ones; 400 for 3 levels, a
  duplicated level, a 21-character label, `"😀😀"`; 200 for `"👩🏽‍🦱"` and `"🇫🇷"` (Review Focus 5); DELETE restores
  defaults; another account never sees them. Unit test of `isSingleEmoji` in `packages/shared/src/wardrobe.test.ts`.
- [ ] **Step 2–4:** run (FAIL), implement, run `pnpm --filter @closyria/api test -- love-levels` and
  `pnpm --filter @closyria/shared test` (PASS).
- [ ] **Step 5: Commit** — `feat(api): niveaux personnalisés`

### Task 4: Budgets (API)

**Files:**
- Create: `apps/api/src/wardrobe/budgets.ts`, `apps/api/src/wardrobe/budgets.test.ts` (periods, unit),
  `apps/api/src/routes/me/budgets.ts`, `apps/api/src/routes/me/budgets.integration.test.ts`
- Modify: `apps/api/src/app.ts`, `packages/shared/src/wardrobe.ts`

**Interfaces:**
- Consumes: `budgets` table (Task 1), `spent_cents` (Task 2).
- Produces (shared): `budgetPeriodSchema = z.enum(["week","month","custom","none"])`;
  `budgetInputSchema {amountCents: centsSchema.positive(), period, startsOn?: date, endsOn?: date}` refined: dates
  required and ordered iff `custom`; `budgetViewSchema {amountCents, period, startsOn, endsOn, current: {start, end, spentCents, remainingCents} | null, ended: boolean}`
  (`current` null and `ended` true after a custom budget's last day); `budgetHistorySchema {periods: {start, end, spentCents, amountCents}[]}`.
- Produces (api): `periodAt(budget, now: Date): {start: Date; end: Date} | null` (Europe/Paris; `none` → `[resetAt ?? createdAt, +∞)` with `end` = far future);
  `spentInPeriod(tx, scope: {profileId} | {wishlistId}, start, end): Promise<number>` — events of the scope's active
  items (`items.deleted_at is null` not required: a trashed item that was ordered still counts), profile scope by the
  item's current `profile_id`, list scope through `wishlist_items`.
  Routes for `profiles/{id}` and `wishlists/{id}`: `GET …/budget` (404 when none), `PUT …/budget`, `DELETE …/budget`
  (204), `GET …/budget/history` (week: 8 last, month: 12 last), `POST …/budget/reset` (`none` only, else 409
  `budget_not_resettable`).

- [ ] **Step 1: Tests (unit, `budgets.test.ts`)** — `periodAt` week: Sunday 2026-11-08T22:30Z (23:30 Paris) is in
  the week starting Monday 2026-11-02 00:00 Paris; Monday 2026-11-08T23:30Z (00:30 Paris on the 9th) starts the next
  week; month across the end of daylight time (2026-10-25); custom inclusive of `endsOn` until 23:59:59 Paris; custom
  after `endsOn` → null (Review Focus 1).
- [ ] **Step 2: Tests (integration)** — profile budget 150 € per week: an order of 89 € (typed) this week and one last
  week → `spentCents: 8900`, `remainingCents: 6100`; a return this week of an item ordered last week → credited; list
  budget counts only the list's items; history lists past weeks; reset of a `none` budget; 409 on reset of a week
  budget; another account's profile or list → 404; PUT `custom` without dates → 400.
- [ ] **Step 3–4:** run (FAIL), implement, run `pnpm --filter @closyria/api test -- budgets` (PASS).
- [ ] **Step 5: Commit** — `feat(api): budgets par profil et par liste, par période`

### Task 5: « J'ai commandé » depuis la sélection

**Files:**
- Modify: `apps/api/src/routes/me/items.ts` (or `bulk.ts`), `apps/api/src/wardrobe/bulk.ts`, `packages/shared/src/wardrobe.ts`
- Test: `apps/api/src/routes/me/order-draft.integration.test.ts`

**Interfaces:**
- Produces: `orderDraftInputSchema = z.object({ profileId: z.uuid() }).or(z.object({ wishlistId: z.uuid() }))`;
  `POST /me/order-draft/ordered` → `mutationResultSchema`: in one transaction, the scope's items with
  `in_order_draft` and `stage = 'spotted'` get the bulk `stage` op (`ordered`, `at` now, events with `spent_cents`)
  and `setFields {inOrderDraft:false}`; undo = both inverse ops + the events removed. 409 `order_draft_empty` when
  nothing is selected.
- Every path that takes an item out of « Repéré » or to the trash or to another profile clears `in_order_draft`
  (single and bulk stage, delete, move) and its undo restores it.

- [ ] **Step 1: Tests** — two selected wishes (89 € and 65 €) → both `ordered`, `inOrderDraft:false`, profile budget
  `spentCents: 15400`; undo → both `spotted`, `inOrderDraft:true`, `spentCents: 0` (Review Focus 2); a selected item
  moved to « Dans mon dressing », trashed, or moved to another profile is no longer selected, and its undo selects it
  again (Review Focus 3); list scope only takes the list's selected items; empty → 409.
- [ ] **Step 2–4:** run (FAIL), implement, run `pnpm --filter @closyria/api test` (PASS, whole API suite).
- [ ] **Step 5: Commit** — `feat(api): passer la sélection en Commandé`

### Task 6: Palette C et caractères

**Files:**
- Modify: `packages/design-tokens/src/{primitives,semantic,theme}.ts` and their tests, `apps/web/src/app/layout.tsx`,
  `apps/web/package.json`, `docs/specs/2026-11-01-direction-visuelle.md`

**Interfaces:**
- Light: surface `#F2EDE7`, surface-raised `#FFFFFF`, surface-sunken `#EBE3DB`, surface-strong/line `#E5D7CC`, ink
  `#2B1D17`, ink-muted `#6E5A50`, accent `#5A3A2E`, accent-ink `#FFFFFF`, hint (rose poudré) `#EBC7C3`, premium-surface
  (jaune beurre) `#F3E3A6`, plus primitives camel `#DCC3A6`, sage `#D5DCC8`; dark: surface `#1E1612`, raised
  `#2A201B`, ink `#F2EDE7`, ink-muted `#C9B8AE`, accent `#EBC7C3`, accent-ink `#2B1D17`. Adjust only where a contrast
  test fails, and say so in the commit.
- Radius: `radius-lg` `1.625rem` (cards), buttons stay `full`. Fonts: `@fontsource-variable/fraunces` (display) and
  `@fontsource-variable/dm-sans` (body) replace Cormorant Garamond and Jost.

- [ ] **Step 1:** update the expected values in the design-token tests first; run `pnpm --filter @closyria/design-tokens test` → FAIL.
- [ ] **Step 2:** change the tokens and fonts; run the token tests (PASS, contrasts included), `build:css`, `pnpm lint`.
- [ ] **Step 3:** rebuild web and run `pnpm e2e` (axe contrast across pages) → PASS.
- [ ] **Step 4: Commit** — `feat(design): palette chocolat et rose poudré, Fraunces et DM Sans`

### Task 7: Pastille de niveau et menu « … » sur les vignettes

**Files:**
- Create: `apps/web/src/lib/love-levels.ts` (+ `.test.ts`), `apps/web/src/components/love-level-pill.tsx`,
  `apps/web/src/components/item-menu.tsx`
- Modify: `apps/web/src/components/{item-card,item-grid,wardrobe-view,wishlist-detail,app-shell}.tsx`,
  `apps/web/src/lib/{wardrobe-client,profile-context}.ts`, `packages/i18n/messages/fr.json`
- Delete: `apps/web/src/lib/bare-wish.ts` and its test
- Test: `e2e/tests/love-levels.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3 APIs.
- Produces: `nextLoveLevel(level: LoveLevel | null): LoveLevel` (`null→2`, `1→2→3→4→1`); `useLoveLevels(): readonly LoveLevelView[]`
  (shell context, defaults until read); `fetchLoveLevels()`, `saveLoveLevels()` in `wardrobe-client.ts`;
  `<LoveLevelPill item onChange />` (button, name « Niveau : Mims. Toucher pour changer », shows « + » with name
  « Donner un niveau » when null); `<ItemMenu item onChanged />` (button « Plus d'actions », panel with the 4 levels as
  `aria-pressed` buttons, « Prioritaire »/« Retirer de Prioritaire », « Mon avis », stage actions, « Ajouter à une
  liste », « Déplacer vers un profil », « Étiquettes », « Retirer de mes envies » or « Supprimer »). Every action
  pushes its undo toast (« Niveau : Mims », « Prioritaire », « Retiré de tes envies »…).

- [ ] **Step 1: Tests** — unit `nextLoveLevel`; e2e: tapping the pill of a J'aime wish shows « Mims », the toast and
  « Annuler » restores J'aime; menu → Prioritaire shows the tag on the card; menu → « Retirer de mes envies » puts it
  in the trash; no checkbox on the cards; axe clean (phone, tablet, desktop).
- [ ] **Step 2–4:** run (FAIL), implement, rebuild web, run `pnpm e2e -- tests/love-levels.spec.ts` and unit tests (PASS).
- [ ] **Step 5: Commit** — `feat(web): niveau et menu « … » sur les vignettes`

### Task 8: Mode « Sélectionner », filtres par niveau et tri

**Files:**
- Modify: `apps/web/src/components/{wardrobe-view,selection-bar,filters-bar,item-card}.tsx`,
  `apps/web/src/lib/wardrobe-view.ts` (+ test), `packages/i18n/messages/fr.json`, `e2e/tests/views.spec.ts`

**Interfaces:**
- Produces: URL params `niveau=4,3` and `prioritaire=1`, sort value `love` labelled « Ce que j'aime le plus »;
  « Sélectionner » / « Terminé » toggle; in select mode each card is a toggle button (`aria-pressed`) with a round
  check; the existing selection bar gains « Niveau » and « Prioritaire » (bulk `setFields`).

- [ ] **Step 1: Tests** — unit: params round-trip (`niveau`, `prioritaire`, `love`); e2e (adapt the selection tests
  of `views.spec.ts`): « Sélectionner » then two cards → bar « 2 sélectionnés », set « En feu » for both, undo;
  filter 🔥 shows only level 4; sort « Ce que j'aime le plus ».
- [ ] **Step 2–4:** run (FAIL), implement, rebuild, run `pnpm e2e -- tests/views.spec.ts` (PASS).
- [ ] **Step 5: Commit** — `feat(web): mode Sélectionner, filtres par niveau et tri`

### Task 9: Fiche — « Ajouter à mes envies », niveau, prioritaire, avis

**Files:**
- Create: `apps/web/src/components/love-level-picker.tsx`
- Modify: `apps/web/src/app/(app)/produits/[id]/{keep-actions,item-panel}.tsx`, `apps/web/src/lib/wardrobe-client.ts`,
  `packages/i18n/messages/fr.json`, e2e tests that click « Favori » (`keep.spec.ts`, `account-merge.spec.ts`,
  `layout.spec.ts`, `views.spec.ts`, `lists.spec.ts`, `capture.spec.ts`)

**Interfaces:**
- Produces: `<LoveLevelPicker value onChange />` (fieldset « Tu l'aimes comment ? », 4 `aria-pressed` buttons);
  keep actions: picker (J'aime preselected), « Prioritaire » toggle, « Pourquoi ? (facultatif) » field (200 max),
  primary « Ajouter à mes envies » (`action:"wish"`), « Ajouter à une liste », « Déjà commandé »; toast « Ajouté à tes
  envies »; item panel shows the picker, priority and opinion instead of the ♡.

- [ ] **Step 1: Tests** — e2e: paste a link → choose Mims, Prioritaire, « Trop mims » → « Ajouter à mes envies » →
  Envies shows the card with 🥰, Prioritaire and « Trop mims »; on the kept sheet change to En feu, undo. Replace every
  `getByRole("button", { name: "Favori" })` in the e2e suite with a helper `keepWish(page)` in
  `e2e/fixtures/shops.ts`.
- [ ] **Step 2–4:** run (FAIL), implement, rebuild, run the whole `pnpm e2e` (PASS).
- [ ] **Step 5: Commit** — `feat(web): Ajouter à mes envies avec niveau, prioritaire et avis`

### Task 10: Préparer une commande et budgets (web)

**Files:**
- Create: `apps/web/src/app/(app)/envies/commande/page.tsx`, `apps/web/src/components/order-draft.tsx`,
  `apps/web/src/components/budget-dialog.tsx`, `apps/web/src/lib/budget.ts` (+ test)
- Modify: `apps/web/src/components/{wardrobe-view,wishlist-detail}.tsx`, `apps/web/src/lib/wardrobe-client.ts`,
  `packages/i18n/messages/fr.json`
- Test: `e2e/tests/order-draft.spec.ts`

**Interfaces:**
- Consumes: Tasks 4 and 5 APIs, `inOrderDraft` via PATCH.
- Produces: `draftTotals(items: ItemView[], budget: BudgetView | null): { count: number; totalCents: number; unknownPrices: number; afterCents: number | null }`
  (`afterCents = remainingCents - totalCents`, null without a current budget); route `/envies/commande` (profile
  scope, `?profil=`) and `/envies/commande?liste=<id>` (list scope); button « Préparer une commande » on Envies and in
  a list's header; « Budget » opens `BudgetDialog` (amount, « Par semaine / Par mois / Dates au choix / Sans période »,
  dates, « Supprimer le budget », « Recommencer à zéro » for `none`); bottom band `aria-live="polite"`:
  « 3 articles · 187 € », « Il te resterait 13 € » / « 37 € au-dessus » ; « J'ai commandé » → toast
  « 3 articles passés en Commandé · Annuler ».

- [ ] **Step 1: Tests** — unit `draftTotals` (unknown price counts 0 and is counted in `unknownPrices`, no budget →
  `afterCents: null`, over budget negative); e2e: set a 150 € weekly budget, tick two wishes (89 + 65 €) → « 2 articles
  · 154 € » and « 4 € au-dessus »; reload → still ticked; « J'ai commandé » → Commandé view has them, band shows
  « Déjà commandé : 154 € »; undo; list scope shows only the list's items; axe clean.
- [ ] **Step 2–4:** run (FAIL), implement, rebuild, run `pnpm e2e -- tests/order-draft.spec.ts` (PASS).
- [ ] **Step 5: Commit** — `feat(web): préparer une commande avec budget`

### Task 11: Réglages → Mes niveaux

**Files:**
- Create: `apps/web/src/app/(app)/reglages/niveaux/page.tsx`, `apps/web/src/components/love-levels-settings.tsx`
- Modify: `apps/web/src/components/settings-nav.tsx`, `packages/i18n/messages/fr.json`
- Test: `e2e/tests/love-levels.spec.ts` (add)

**Interfaces:**
- Produces: four rows (emoji button opening a grid of 24 common emojis + a one-emoji text field, label field ≤ 20),
  « Enregistrer », « Revenir aux niveaux de départ »; settings nav entry « Mes niveaux » (`/reglages/niveaux`).

- [ ] **Step 1: Tests** — rename Mims to « Trop beau » with 😍 → the cards show « 😍 Trop beau »; two emojis refused
  with the message « Un seul émoji par niveau »; « Revenir aux niveaux de départ » restores 🥰 Mims; axe clean.
- [ ] **Step 2–4:** run (FAIL), implement, rebuild, run the spec (PASS).
- [ ] **Step 5: Commit** — `feat(web): personnaliser ses niveaux`

### Task 12: Documents et suite complète

**Files:**
- Modify: `docs/specs/2026-11-07-envies-chaleureuses.md` (statut, écarts), `docs/specs/2026-11-01-v1-conception.md`
  (décision « Favori → niveaux »), this plan (cases cochées)

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test` → all green; rebuild; `pnpm e2e` → all green (rerun the
  known flaky viewer test once if it fails).
- [ ] **Step 2: Commit** — `docs: Envies chaleureuses partie 1 livrée en dev`

## Écarts assumés par rapport au cahier des charges

- Pas d'opérations de lot `setLoveLevel` / `setPriority` / `setOrderDraft` : `setFields` les porte déjà, avec
  l'annulation (§ 5.2 du cahier, même effet).
- Une seule sélection par article (`in_order_draft`) : cocher un article depuis une liste le coche aussi dans
  « Préparer une commande » de son profil, et inversement.
- `spent_cents` est une nouvelle colonne des événements plutôt que `amount_cents` (qui garde le montant saisi).
