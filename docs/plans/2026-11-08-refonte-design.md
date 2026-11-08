# Refonte « Cocon lumineux » — Lot 1 (fondations, Mes envies, fiche) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habiller tout le site avec la refonte (couleurs, polices, verre, aurore, barre du haut), puis refaire « Mes envies » et la fiche article selon la maquette, livrés en dev en trois paliers.

**Architecture:** Les valeurs visuelles passent par `packages/design-tokens` (rôles existants, nouvelles valeurs, quelques nouveaux rôles) ; les nouveaux comportements sont de petits composants client dans `apps/web/src/components` (choix du niveau, onglets de listes, carte de budget, bandeau « Ma commande », pile de messages) branchés sur les API existantes ; une seule nouvelle route d'API (historique de prix) pour la courbe de la fiche.

**Tech Stack:** Next 16 App Router, Tailwind 4 (`@theme static` généré), next-intl (`packages/i18n/messages/fr.json`), Hono + zod-openapi, Drizzle, Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-08-refonte-design.md` (maquette : `docs/maquettes/refonte-a2.html`). Étapes 4 (téléphone) et 5 (reste du site) : plan suivant.

## Global Constraints

- Interface et docs en français ; code en anglais. Mots de l'app (D11) : « Je le prends », « Ma commande », « J'ai commandé », « Il te resterait {montant} », « {montant} au-dessus ».
- Toute couleur, taille, durée passe par un token (`check-design-tokens` : pas d'hex, pas d'arbitraire Tailwind sauf `var(--x)`, pas de style en ligne sauf `var(--x)`).
- Palette « le mélange des trois » (spec § 4), clair / sombre : surface `#FBF5F9`/`#1A1218` ; surface-raised `#FFFFFF`/`#261922` ; ink `#2A1A24`/`#F6EBF1` ; ink-muted `#6A5563`/`#CBB5C2` ; accent `#BE185D`/`#F48BBE` ; boutons `#5E1E2E` sur `#FBF5F9` / `#F6EBF1` sur `#1A1218` ; hint et selected-surface `#F6D6E4`/`#47233A` ; sunken `#F3E6EF`/`#33222D` ; strong `#EFE1EB`/`#2D1E28` ; champagne `#D9BC80` (décor seulement).
- Polices : `font-display` Fraunces (inchangée, logo Fraunces 600 droit), `font-body` **Jost** (remplace DM Sans).
- Boutons à plat : aucun `shadow-*` sur un bouton ou une pastille cliquable.
- Un seul effet par moment ; durées par les tokens `motion-duration-*` (déjà à 0 ms en mouvement réduit) ; aucune boucle sur une donnée.
- Émojis d'envie posés seuls (pas de rond opaque) ; double-tap / clic sur l'émoji = choix parmi les 4 niveaux, jamais coup de cœur forcé.
- Zones tactiles ≥ 44 px, contrastes texte ≥ 4,5:1 dans les deux thèmes, axe sans violation.
- Commits : `git -c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com commit`, pied `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais de push ni de déploiement sans accord.

## Review Focus

1. Liste vide ou liste sans budget dans les onglets : la carte de budget dit « Pas de budget pour « {liste} » » et « Ma commande » marche sans budget (pas de « NaN € »).
2. Article sans prix (prix inconnu) dans « Ma commande » : compte 0 et « prix inconnu » reste affiché, comme aujourd'hui.
3. Navigateur sans `backdrop-filter` : les panneaux en verre restent lisibles (fond plein `surface-raised`).
4. Produit d'une boutique non lisible (`captureStatus === "manual"`) : pas de courbe, phrase « notés à la main », tailles « stock non suivi ».
5. Mouvement réduit : la grille, la fiche et le bandeau s'affichent à l'état final, aucun élément laissé à `opacity: 0`.

Chaque ligne est couverte par un test dans la tâche qui possède le code (Tasks 7, 9, 3, 13, 14).

## Rulings pris en écrivant le plan (à confirmer par la fondatrice)

- **Sélection par onglet** : la sélection reste le drapeau existant `inOrderDraft` de chaque article ; un onglet de liste montre la sélection **filtrée** par la liste (comme « Préparer une commande » depuis une liste aujourd'hui). La spec disait « chaque onglet a sa sélection » : c'est le même résultat à l'écran, sans changer la base.
- **« Me prévenir si le prix baisse »** n'existe pas dans l'app : non construit dans ce lot (ce serait une fonction nouvelle, pas de la refonte).
- **« −20 € » sur les cartes** : basé sur le prix barré fourni par la boutique (`compareAtCents`). La courbe de la fiche, elle, lit l'historique réel (Task 12).
- **Bandeau d'annonces (S11)** : reporté à l'étape 5 (accueil), faute de source d'annonces aujourd'hui.

---

## Palier 1 — Fondations (tout le site change de peau)

### Task 1: Palette « le mélange des trois »

**Files:**
- Modify: `packages/design-tokens/src/primitives.ts` (nouvelles couleurs), `src/semantic.ts:13-49`, `src/theme.ts:44-79`
- Test: `packages/design-tokens/src/css.test.ts:100-188`, `e2e/tests/order-draft.spec.ts:65-117` (couleurs calculées)

**Interfaces:**
- Produces: nouveaux rôles `color-detail`, `color-aurora-1`, `color-aurora-2`, `color-aurora-3`, `color-glass`, `color-glass-line` (clair et sombre) ; valeurs nouvelles pour les rôles existants.

- [ ] **Step 1:** Dans `css.test.ts`, remplacer les attentes « exact validated palette » par les valeurs des Global Constraints (light puis dark), ajouter `color-detail` = `#D9BC80` (les deux thèmes), et ajouter à `textPairs` : `["color-button-ink","color-button-bg",4.5]` ; garder toutes les paires existantes.
- [ ] **Step 2:** `pnpm --filter @closyria/design-tokens test` → FAIL sur les valeurs.
- [ ] **Step 3:** Ajouter les primitives (`blushLavender #FBF5F9`, `raspberry #BE185D`, `bordeaux #5E1E2E`, `champagne #D9BC80`, `plum #1A1218`, `plumRaised #261922`, `pinkMist #F6D6E4`, `plumHint #47233A`, `lilacSunken #F3E6EF`, `lilacStrong #EFE1EB`, `plumSunken #33222D`, `plumStrong #2D1E28`, `inkPlum #2A1A24`, `mutedPlum #6A5563`, `inkLight #F6EBF1`, `mutedLight #CBB5C2`, `raspberryLight #F48BBE`) et les brancher dans `semantic.ts` (clair) et `equilibreDark` (sombre). `color-button-bg` devient bordeaux (clair) / `#F6EBF1` (sombre), `color-button-ink` l'inverse. `color-glass` : `color-mix(in srgb, var(--color-surface-raised) 62%, transparent)` ; `color-glass-line` : `color-mix(in srgb, var(--color-surface-raised) 75%, transparent)` ; `color-aurora-1..3` : `color-mix` de framboise / champagne / lavande avec la surface (18 %, 28 %, 30 % en clair ; 18 %, 12 %, 12 % en sombre). Succès / danger / bandeau : inchangés.
- [ ] **Step 4:** Test vert ; `pnpm --filter @closyria/design-tokens build:css`.
- [ ] **Step 5:** Mettre à jour les couleurs calculées attendues dans `e2e/tests/order-draft.spec.ts` (ligne cochée = `selected-surface`/`selected-line` nouvelles valeurs ; pastilles succès/danger inchangées).
- [ ] **Step 6:** Commit `feat(tokens): palette « le mélange des trois »`.

### Task 2: Jost pour le texte

**Files:** Modify `apps/web/package.json` (dépendance `@fontsource-variable/jost`, retirer `@fontsource-variable/dm-sans`), `apps/web/src/app/layout.tsx:1-2`, `packages/design-tokens/src/primitives.ts:65-68`; Test `css.test.ts:143-153`.

- [ ] **Step 1:** Test : `font-body` contient `"Jost Variable"`, `font-display` contient toujours `"Fraunces Variable"`.
- [ ] **Step 2:** FAIL. **Step 3:** `pnpm --filter @closyria/web add @fontsource-variable/jost` (seule dépendance ajoutée par ce plan), import `@fontsource-variable/jost/wght.css`, `font.body = '"Jost Variable", ui-sans-serif, system-ui, sans-serif'`.
- [ ] **Step 4:** Test vert, `pnpm --filter @closyria/web build` OK. **Step 5:** Commit.

### Task 3: Verre dépoli, aurore, boutons à plat

**Files:** Modify `apps/web/src/app/globals.css`, `components/ui.ts:5-15`, `components/item-card.tsx:81,88`, `components/love-level-pill.tsx:14`, `components/item-menu.tsx:149`; Test: `e2e/tests/look.spec.ts` (nouveau).

**Interfaces:**
- Produces: utilitaires `glass` (fond `color-glass`, bord `color-glass-line`, `backdrop-filter: blur(...) saturate(...)` via tokens, repli `@supports not (backdrop-filter: blur(1px))` → `background: var(--color-surface-raised)`) et `aurora` (pseudo-élément fixe derrière `body`, trois dégradés `color-aurora-*`, animation lente `aurora-drift` qui s'arrête en mouvement réduit). Les durées/flous deviennent des tokens (`motion-duration-aurora`, `blur-glass`) pour passer `check-design-tokens`.

- [ ] **Step 1:** `look.spec.ts` : (a) aucun `button` visible de `/envies` n'a de `box-shadow` ≠ `none` ; (b) avec `reducedMotion: "reduce"`, `getComputedStyle(document.body, "::before").animationName` est `none` ; (c) repli du verre : le repli est écrit deux fois, sous `@supports not (backdrop-filter: blur(1px))` et sous `html.no-backdrop .glass` ; le test pose la classe `no-backdrop` sur `<html>` et vérifie que le fond calculé de la barre du haut est opaque (alpha 1) (Review Focus 3).
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter ; retirer `shadow-soft` des boutons/pastilles cliquables listés ; boutons clairs : `ring-1 ring-line` au lieu d'ombre.
- [ ] **Step 4:** `pnpm lint` (inclut `check-design-tokens`), `look.spec.ts` vert. **Step 5:** Commit.

### Task 4: Barre du haut en pilule de verre, trait qui suit, bouton thème

**Files:** Modify `components/app-shell.tsx:171-300`, `components/app-nav.ts`; Create `components/nav-underline.tsx`, `components/theme-button.tsx`; Test `components/app-nav.test.ts`, `e2e/tests/views.spec.ts`, `e2e/tests/appearance.spec.ts`.

**Interfaces:**
- Consumes: `lib/theme-mode.ts` (`readAppThemeMode`, `applyThemeMode`, `saveAppThemeMode`).
- Produces: `NavUnderline({ containerRef, activeSelector })` (trait framboise positionné sous l'élément actif, transition `motion-duration-base`) ; `ThemeButton()` (bascule clair ↔ sombre explicites, libellé « Passer en mode sombre » / « Passer en mode clair », sans animation de transition).

- [ ] **Step 1:** Tests : `views.spec.ts` — à partir de `lg`, le menu est une barre en haut (`data-testid="app-nav-top"` visible, plus d'`aside`), le lien courant a `aria-current="page"` et le trait est sous lui ; `appearance.spec.ts` — « Passer en mode sombre » pose `data-theme="equilibre-dark"` et le réglage survit au rechargement.
- [ ] **Step 2:** FAIL. **Step 3:** Remplacer l'`aside` desktop par une pilule `glass` sticky en haut (logo Fraunces 600, `desktopNav`, `ProfileSwitcher`, `AddLink`, `ThemeButton`) ; tablette garde ses onglets avec `NavUnderline` ; téléphone inchangé (étape 4).
- [ ] **Step 4:** Tests verts, axe sans violation. **Step 5:** Commit.

**Palier 1 terminé :** suite complète (`pnpm lint && pnpm typecheck && pnpm test && pnpm build && cd e2e && npx playwright test`), puis **demander l'accord** pour fusionner dans dev, pousser et déployer en dev ; la fondatrice teste.

---

## Palier 2 — Mes envies

### Task 5: Pile de messages (jusqu'à 3)

**Files:** Modify `lib/undo.ts`, `components/undo-toast.tsx`; Test `lib/undo.test.ts`.

**Interfaces:** Produces `getUndoStack(): UndoEntry[]` (plus récent en dernier, au plus 3) ; `pushUndo` empile au lieu de remplacer ; `runUndo(id?: string)` ; chaque entrée expire après `UNDO_DELAY_MS`.

- [ ] Test : trois `pushUndo` → pile de 3 ; un quatrième retire le plus ancien ; `runUndo(id)` exécute la bonne entrée ; expiration individuelle. FAIL → implémenter (affichage décalé de 12 px et réduit de 5 % par rang, via tokens) → vert → commit.

### Task 6: Choix du niveau (bulle des 4 émojis)

**Files:** Create `components/level-picker.tsx`; Modify `components/love-level-pill.tsx` (devient l'émoji posé : bouton sans fond, ombre portée sur l'émoji seulement); Test `components/level-picker.test.tsx`, `e2e/tests/views.spec.ts`.

**Interfaces:**
- Produces: `LevelPicker({ levels: readonly LoveLevelView[], value: LoveLevel | null, onPick: (level: LoveLevel) => void, onClose: () => void, anchor: HTMLElement })` — `role="radiogroup"`, focus sur le niveau actuel, Échap / clic dehors ferment sans rien changer. `useLevelPick(item, reload)` : ouvre le picker, `patchItem(id, { loveLevel })`, `pushUndo`.

- [ ] Tests : double-clic sur la photo d'une carte → bulle avec 4 radios, rien ne change tant qu'on n'a pas choisi ; choisir « Peut-être » → l'émoji de la carte change et le niveau est enregistré ; Échap ferme sans changement ; pas de navigation vers la fiche sur double-clic (le clic simple attend 300 ms). Étincelles seulement pour le niveau le plus haut, rien en mouvement réduit.

### Task 7: Onglets de listes et carte de budget

**Files:** Create `components/list-tabs.tsx`, `components/budget-card.tsx`; Modify `components/wardrobe-view.tsx:220-300`, `lib/budget.ts`; Test `lib/budget.test.ts`, `e2e/tests/order-draft.spec.ts` (nouveau test « Mes envies »).

**Interfaces:**
- Consumes: `fetchWishlists`, `fetchBudget(scope)`, `BudgetDialog`, `fetchItemsPage({ wishlist })`.
- Produces: `ListTabs({ lists: WishlistView[], current: string | null, onChange(id: string | null) })` (URL `?liste=<id>`, « Toutes mes envies » = `null`) ; `BudgetCard({ scope: BudgetScope, draftCents: number, listName?: string })` ; `budgetCardState(budget: BudgetView | null, draftCents: number): { kind: "none" } | { kind: "ok"; amount; spent; rest } | { kind: "over"; amount; spent; over }` dans `lib/budget.ts`.

- [ ] Tests unitaires `budgetCardState` : sans budget → `none` ; 500/215/120 → reste 285 et barre 43 % + 24 % ; 500/580 → `over` 80. E2E : onglet d'une liste filtre la grille et affiche le budget de la liste ; liste sans budget → « Pas de budget pour « Été » » et « Ces articles comptent quand même dans ton budget du mois. » (Review Focus 1) ; montants en `tabular-nums`.

### Task 8: Filtres qui se cochent et « Effacer »

**Files:** Modify `components/filters-bar.tsx:22-…`; Test `e2e/tests/views.spec.ts`.

**Interfaces:** `FiltersBar` gagne `onClearAll(): void` ; bouton « Effacer le filtre » / « Effacer les {n} filtres » visible dès `activeCount ≥ 1`, efface aussi la recherche.

- [ ] Test : cocher 2 filtres → bouton « Effacer les 2 filtres » → un clic → 0 filtre, grille complète ; coche dessinée (trait SVG) dans la pastille active.

### Task 9: Carte d'article en arche, « Aperçu », « Je le prends »

**Files:** Modify `components/item-card.tsx`, `components/item-grid.tsx:11`, `app/globals.css` (forme `arch`), `components/item-preview.tsx`; Test `e2e/tests/views.spec.ts`, `e2e/tests/order-draft.spec.ts`.

**Interfaces:**
- Consumes: `LevelPicker`/`useLevelPick` (Task 6), `patchItem(id, { inOrderDraft })`, `ItemPreview`.
- Produces: `CardActions` gagne `onTake(item: ItemView): void` et `onPreview(item: ItemView): void` ; `data-testid="card-take"` et `"card-preview"`.

- [ ] Tests : photo en arche (rayon haut = `radius-full`) ; « −20 € » quand `compareAtCents > priceCents` ; « Aperçu » ouvre `ItemPreview` (photos, prix, envie, taille, pourquoi, avis, « Je le prends », « Voir la fiche complète ») sans quitter la page (`?apercu=`) ; « Je le prends » passe `inOrderDraft` à vrai et la carte affiche la coche ; prix inconnu → « prix inconnu » (Review Focus 2) ; boutons toujours visibles sur écran tactile.

### Task 10: Bandeau « Ma commande » sur Mes envies

**Files:** Create `components/order-band.tsx` (extrait de `order-draft.tsx:380-412`); Modify `components/order-draft.tsx`, `components/wardrobe-view.tsx`; Test `lib/budget.test.ts`, `e2e/tests/order-draft.spec.ts`.

**Interfaces:**
- Consumes: `draftTotals`, `budgetCardState`, `orderDraftOrdered(scope)`, `SquareCheck`.
- Produces: `OrderBand({ scope: BudgetScope, items: ItemView[], budget: BudgetView | null, onOrdered(): void, onToggle(item): void })` — titre « Ma commande » ou « Ma commande, liste « {nom} » » ; nombre qui roule, total, « Il te resterait » / « au-dessus » ; barre deux couleurs ; « Voir » déplie la liste cochée (décocher = `inOrderDraft` faux, la ligne reste visible jusqu'à la fermeture pour pouvoir la recocher) ; « J'ai commandé ({n}) » ; aucune case cochée → le bouton tremble et « Coche au moins une envie ». « Préparer une commande » (page existante) réutilise ce composant.

- [ ] Tests : prendre 3 articles, en décocher 1 → « J'ai commandé (2) » ; après commande, seuls les 2 passent en Commandé, « Déjà commandé » augmente de leur prix dans le budget du mois et dans la liste qui les contient, la sélection est vide ; l'article décoché reste dans Mes envies ; textes existants de `order-draft.spec.ts` toujours verts.

### Task 11: L'article vole vers « Ma commande » et la grille arrive en cascade

**Files:** Create `lib/fly-to.ts`; Modify `components/item-card.tsx`, `components/item-grid.tsx`, `app/globals.css`; Test `lib/fly-to.test.ts`, `e2e/tests/look.spec.ts`.

**Interfaces:** `flyTo(from: Element, to: Element, color: string): Promise<void>` (Web Animations, résout immédiatement en mouvement réduit).

- [ ] Tests : `flyTo` résout sans animer quand `matchMedia("(prefers-reduced-motion: reduce)")` est vrai ; e2e en mouvement réduit : toutes les cartes de `/envies` ont `opacity` 1 dès l'affichage (Review Focus 5).

**Palier 2 terminé :** suite complète, puis accord → dev.

---

## Palier 3 — Fiche article

### Task 12: Historique de prix (API)

**Files:** Create `apps/api/src/routes/products-history.ts` (ou route dans le fichier produit existant), schéma `priceHistorySchema` dans `packages/shared/src/catalog.ts`; Modify `apps/web/src/lib/wardrobe-client.ts`; Test `apps/api/src/routes/products-history.integration.test.ts`.

**Interfaces:**
- Produces: `GET /api/products/{id}/price-history?days=90` → `{ points: { at: string; priceCents: number }[]; lowestSinceDays: number | null; dropCents: number | null; dropSince: string | null }` (points de `productHistory` du produit, un par jour au plus, dans l'ordre ; `dropCents` = dernier prix − prix précédent différent quand négatif) ; client `fetchPriceHistory(productId)`.

- [ ] Tests d'intégration : produit sans historique → `points: []`, tout à `null` ; 140 → 140 → 120 → `dropCents: -2000`, `lowestSinceDays` ≥ 1 ; produit inconnu → 404 ; produit d'une boutique manuelle → `points: []`.

### Task 13: Fiche en arches et en blocs

**Files:** Modify `app/(app)/produits/[id]/product-view.tsx`, `item-panel.tsx`, `photo-manager.tsx`, `components/love-level-picker.tsx`, `components/ui.ts:15`; Create `components/price-curve.tsx`; Test `e2e/tests/product.spec.ts` (existant ou nouveau).

**Interfaces:**
- Consumes: `fetchPriceHistory` (Task 12), `LevelPicker` (Task 6), `OrderBand` (Task 10, pour « Je le prends »).
- Produces: `PriceCurve({ points, height })` (SVG, trait `color-detail`, point final `color-success`, se dessine une fois, immobile en mouvement réduit, `role="img"` avec libellé « Prix sur 3 mois : de {a} à {b} »).

- [ ] Tests : galerie = grande arche + vignettes en arches dessous + points ; une seule mention de baisse « −{x} € depuis {jour}, le plus bas depuis {n} mois » ; niveaux au style `levelButtonClass` (choisi : bord `accent`, fond `hint`) ; double-tap sur la photo ouvre `LevelPicker` ; boutons « Voir chez {boutique} », « Je le prends », « Partager ».

### Task 14: Boutique non lisible

**Files:** Modify `product-view.tsx:173`, `item-panel.tsx`; Test `e2e/tests/product.spec.ts`.

- [ ] Test (Review Focus 4) : produit `captureStatus === "manual"` → phrase « {Boutique} ne permet pas la lecture automatique : le prix et les tailles ont été notés à la main le {date}. Closyria ne peut donc pas suivre le stock ni les baisses de prix de cette boutique. », tailles « notées à la main, stock non suivi », aucune `PriceCurve` ; carte de la grille : « Prix noté à la main ».

### Task 15: Avis des amies en bulles

**Files:** Modify `components/item-opinions-section.tsx`, `components/friend-opinions.tsx`; Test `e2e/tests/opinions.spec.ts`.

- [ ] Test : un nouvel avis apparaît en bulle (classe d'entrée, rien en mouvement réduit) avec pastille « 1 nouveau » **fixe** (aucune animation infinie : `animationIterationCount` ≠ `infinite`).

**Palier 3 terminé :** suite complète, relecture `interface-design:design-review` + `web-design-guidelines` sur Mes envies et la fiche, corrections, puis accord → dev ; la fondatrice teste avec ses vrais articles.
