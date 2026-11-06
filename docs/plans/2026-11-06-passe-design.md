# Passe design — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadre fixe (seul le contenu défile), menu avec compteurs et Aide, fiche article « D » (boutique au centre,
« Mon article » en panneau à droite sur grand écran), accueil « Quel article as-tu repéré ? » avec le résumé du
dressing.

**Architecture:** Le résumé `/api/me/summary` gagne des compteurs par étape et par profil ; le cadre `AppShell`
devient une grille de la hauteur de la fenêtre dont seul `<main id="app-content">` défile ; la fiche est recomposée
dans `product-view.tsx` à partir de morceaux d'`ItemPanel` ; l'accueil lit les compteurs du cadre.

**Tech Stack:** Next 16 (App Router), Tailwind 4 avec les tokens du projet (pas de valeurs arbitraires, vérifié par
`scripts/check-design-tokens.ts`), next-intl (`packages/i18n/messages/fr.json`), Hono + Zod, Vitest, Playwright.

**Spec:** `docs/specs/2026-11-06-passe-design.md` (maquettes : `docs/design/2026-11-06-passe-design-maquettes.html`, proposition D).

## Global Constraints

- Couleurs, polices, rayons : tokens existants uniquement (`apps/web/src/styles/tokens.css`). Espacements : échelle
  `space-*` (`top-space-0`, pas `top-0`). Un token manquant (largeur 300 px du panneau, 560 px du champ) s'ajoute
  dans `tokens.css`, jamais en valeur arbitraire.
- Textes d'interface en français dans `fr.json`, code en anglais.
- Ordinateur ≥ 1024 px (`lg`), panneau « Mon article » à droite à partir de 1280 px (`xl`).
- Pas de pied de page. Lien « Aide » → `/aide/iphone` (seule page d'aide existante).
- Accessibilité : `pnpm e2e` passe axe sur les pages touchées ; focus visible ; « Aller au contenu » reste le premier
  arrêt clavier.
- Commits : `-c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com`, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- E2E : reconstruire le web (`pnpm turbo run build --filter=@closyria/web`) avant `pnpm e2e`.

## Review Focus

1. Une fiche dont « Mon article » est long (beaucoup de listes, d'étiquettes, une longue note) : le panneau de droite défile seul, son dernier bouton (« Supprimer ») reste atteignable, sans double barre de défilement dans la page.
2. La visionneuse et « Ajouter une photo » s'ouvrent au-dessus du cadre fixe, Échap les ferme, et la zone de contenu ne défile pas derrière.
3. Changer de profil dans l'en-tête met à jour les compteurs du menu et les cases de l'accueil sans recharger la page.
4. Revenir en arrière (bouton Retour du navigateur) après avoir ouvert une fiche depuis une liste ne laisse pas la nouvelle page à mi-hauteur : toute nouvelle page commence en haut.
5. Téléphone 360 px : aucun défilement horizontal, le dernier élément de la page reste visible au-dessus des onglets, « Plus » ouvert ou non.

---

### Task 1: Compteurs par étape dans le résumé

**Files:**
- Modify: `packages/shared/src/wardrobe.ts` (`summaryViewSchema`)
- Modify: `apps/api/src/routes/me/profiles.ts` (route `summaryRoute`)
- Test: `apps/api/src/routes/me/profiles.integration.test.ts` (ou le fichier qui teste déjà `/api/me/summary`)

**Interfaces:**
- Produces: `SummaryView.stageCounts: Record<string /* profileId */, StageCounts>` avec
  `StageCounts = { spotted: number; ordered: number; owned: number; for_sale: number; sold: number; returned: number }`
  (exporté `stageCountsSchema` / `type StageCounts` depuis `@closyria/shared`). Chaque profil de `profiles` a une
  entrée, à zéro partout s'il n'a rien.

- [ ] **Step 1: Write the failing test** « le résumé compte les articles actifs par étape et par profil » : deux
  profils, articles `spotted`×2 et `ordered`×1 dans le premier, `owned`×1 dans le second, un `spotted` à la corbeille
  (`deletedAt`) ; attendu `stageCounts[p1] = { spotted: 2, ordered: 1, owned: 0, for_sale: 0, sold: 0, returned: 0 }`,
  `stageCounts[p2].owned === 1`, et un troisième profil vide présent avec des zéros.
- [ ] **Step 2:** lancer le test → FAIL (`stageCounts` absent).
- [ ] **Step 3:** schéma + une requête `select profile_id, stage, count(*) … where user_id = $1 and deleted_at is null group by 1, 2`, remplie dans un objet à zéros pour chaque profil.
- [ ] **Step 4:** test → PASS ; `pnpm typecheck` (les tests web qui construisent un `SummaryView` reçoivent `stageCounts: {}`).
- [ ] **Step 5: Commit** `feat(api): compteurs par étape et par profil dans le résumé`

### Task 2: Cadre fixe, seul le contenu défile

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/globals.css` (classes `tabbar-safe`, `tabbar-clearance*` devenues inutiles : retirer ; garder la marge de sécurité iPhone sur la barre d'onglets)
- Modify: `apps/web/src/styles/tokens.css` si un token manque
- Test: `e2e/tests/layout.spec.ts`

**Interfaces:**
- Produces: `<main id="app-content">` est le seul conteneur qui défile dans l'appli (`overflow-y-auto`, `min-h-space-0`) ; la fenêtre ne défile plus (`document.scrollingElement.scrollHeight === innerHeight`).

- [ ] **Step 1: Write the failing tests** dans `layout.spec.ts` :
  - « ordinateur : le menu et l'en-tête restent en place quand le contenu défile » (1440×900, page Dressing remplie de 30 articles) : après `#app-content` `scrollTop = 2000`, `window.scrollY === 0`, la boîte de l'`aside` et du `header` n'a pas bougé, `#app-content.scrollTop > 0`.
  - « téléphone : les onglets restent en bas et le contenu défile seul » (390×844) : la barre `app-nav-bottom` a son bas à 844 avant et après défilement du contenu ; `window.scrollY === 0`.
  - « une nouvelle page commence en haut » : faire défiler Dressing, cliquer un article, `#app-content.scrollTop === 0` ; `page.goBack()` puis vérifier `scrollTop === 0`.
  - Adapter « tout en bas de la page, le dernier élément reste visible… » : défiler `#app-content` jusqu'en bas (au lieu de la fenêtre).
- [ ] **Step 2:** `pnpm turbo run build --filter=@closyria/web && pnpm e2e -- layout` → les nouveaux tests échouent.
- [ ] **Step 3:** cadre : conteneur racine `h-dvh overflow-hidden` en grille (lignes : en-tête / contenu / onglets téléphone ; colonnes `lg` : menu / reste) ; `aside` sans `sticky` ; `header` sans `sticky` ; barre d'onglets téléphone dans le flux (plus `fixed`), le panneau « Plus » s'ouvre au-dessus d'elle (position absolue vers le haut) ; `main` `overflow-y-auto`. Remise en haut : `useEffect` sur `usePathname()` qui fait `main.scrollTo({ top: 0 })`. La règle `html:has(dialog:modal){overflow:hidden}` devient `#app-content:has(dialog:modal)` ou s'applique aux deux.
- [ ] **Step 4:** e2e complet `pnpm e2e` → PASS (corriger les tests existants qui faisaient défiler la fenêtre).
- [ ] **Step 5: Commit** `feat(web): cadre fixe, seul le contenu défile`

### Task 3: Menu avec compteurs, Aide en bas, « Coller un lien » dans l'en-tête

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/app-nav.ts` (+ `app-nav.test.ts`)
- Modify: `apps/web/src/lib/profile-context.ts(x)` (exposer les compteurs)
- Modify: `packages/i18n/messages/fr.json` (`Shell.nav.help` = « Aide », `Shell.nav.count` pour le nom accessible)
- Test: `apps/web/src/components/app-nav.test.ts`, `e2e/tests/layout.spec.ts`

**Interfaces:**
- Consumes: `SummaryView.stageCounts` (Task 1).
- Produces: `ProfilesContext` expose `stageCounts: StageCounts | null` du profil courant et `refreshProfiles()` les relit ; `countFor(item: AppNavItem, counts: StageCounts | null): number | null` dans `app-nav.ts` (wishes → `spotted`, ordered → `ordered`, wardrobe → `owned`, forSale → `for_sale`, autres → `null`) ; `helpNav: AppNavItem = { key: "help", href: "/aide/iphone" }` ajouté à `moreNav` (téléphone) et en bas du menu latéral.

- [ ] **Step 1: Write the failing tests** : `countFor` (4 correspondances, `null` pour home/lists/settings et quand `counts` est `null`) ; e2e « le menu latéral montre les compteurs du profil courant et Aide en bas » (1440 : après avoir gardé 1 envie, le lien Envies a le nom accessible « Envies, 1 article » et « Aide » est le dernier lien de l'`aside`) ; e2e « sur ordinateur, l'en-tête a le champ Coller un lien hors de l'accueil » (sur `/dressing` à 1440, champ « Coller un lien » visible dans le `header` ; absent du `header` sur `/`) ; e2e « changer de profil met à jour les compteurs » (Review Focus 3).
- [ ] **Step 2:** lancer → FAIL.
- [ ] **Step 3:** implémenter. Rafraîchir les compteurs après garder / changer d'étape / supprimer / restaurer : appeler `refreshProfiles()` là où ces actions réussissent (`keep-actions.tsx`, `item-panel.tsx`, `undo-toast.tsx`). Le champ d'en-tête réutilise `CaptureForm` en variante compacte (`lg` et plus) ; « + Ajouter » reste en dessous de `lg`.
- [ ] **Step 4:** tests → PASS, `pnpm e2e` complet.
- [ ] **Step 5: Commit** `feat(web): compteurs dans le menu, Aide, Coller un lien dans l'en-tête`

### Task 4: Fiche « D »

**Files:**
- Modify: `apps/web/src/app/(app)/produits/[id]/product-view.tsx`, `item-panel.tsx`, `keep-actions.tsx`
- Create: `apps/web/src/app/(app)/produits/[id]/stage-strip.tsx` (frise des étapes), `item-summary.tsx` (pastilles sous le prix)
- Modify: `packages/i18n/messages/fr.json`
- Test: `e2e/tests/layout.spec.ts` (tests « fiche gardée » / « fiche non gardée » réécrits), `e2e/tests/keep.spec.ts` si des sélecteurs changent

**Interfaces:**
- Produces: `ItemPanel` ne reçoit plus `shop` ; il rend « Mon article » puis « Autres actions ». `ItemSummary({ item }: { item: ItemView })` rend l'étape (pastille accent) et « Ma taille : … » si renseignée. `StageStrip` garde les rôles et noms accessibles actuels des boutons d'étape (« Passer à « Reçu » », « Commandé (étape actuelle) »).

- [ ] **Step 1: Write the failing tests** :
  - « fiche gardée à 1440 : la boutique au centre, Mon article à droite qui défile seul » : la boîte de la section « Mon article » est à droite de celle de « La fiche de la boutique » (x plus grand, se chevauchent en hauteur) ; le panneau a `overflow-y: auto` ; « Autres actions » est dans le panneau ; la pastille « Commandé »/« Repéré » est sous le prix.
  - « fiche gardée à 1100 et à 390 : une colonne, ordre en-tête → photos → boutique → Mon article → Autres actions » (comparer les `y`).
  - « fiche non gardée à 1440 : les boutons Garder sont dans le panneau de droite ».
  - Review Focus 1 : 15 étiquettes et une note de 2 000 caractères sur l'article, à 1440 : « Supprimer » atteint par `scrollIntoViewIfNeeded` dans le panneau, `window.scrollY === 0`.
  - Review Focus 2 : à 1440, ouvrir la visionneuse depuis la mosaïque, Échap la ferme, `#app-content.scrollTop` inchangé.
- [ ] **Step 2:** build + e2e → FAIL.
- [ ] **Step 3:** grille `xl:grid-cols-[minmax(0,1fr)_<token panneau>]` via un token (`--spacing-panel: 18.75rem` ou largeur équivalente dans `tokens.css`) ; colonne centre : en-tête + `ItemSummary`, mosaïque (première photo sur 2×2, les autres en 3:4), boutique ; colonne droite `xl:overflow-y-auto` avec `ItemPanel` ou `KeepActions`. Sous `xl`, ordre en une colonne de la spec. Frise : grille de 4 cases (6 si l'étape actuelle est Vendu/Renvoyé), états `done` (fond `success-surface`), actuelle (`accent`), à venir (`surface-sunken`).
- [ ] **Step 4:** `pnpm e2e` complet → PASS (axe compris).
- [ ] **Step 5: Commit** `feat(web): fiche article, la boutique au centre et Mon article à droite`

### Task 5: Accueil option 3

**Files:**
- Modify: `apps/web/src/app/(app)/page.tsx`
- Create: `apps/web/src/components/home-summary.tsx`
- Modify: `apps/web/src/components/capture-form.tsx` (variante compacte si besoin), `packages/i18n/messages/fr.json` (`Home.title` = « Quel article as-tu repéré ? », supprimer `Home.tagline`, `Home.summary.{ordered,wishes,wardrobe,forSale}` avec pluriels ICU : « {count, plural, one {commandé en route} other {commandés en route}} », « envie(s) », « dans ton dressing », « à vendre »)
- Test: `e2e/tests/layout.spec.ts` (test « la page d'accueil donne un champ confortable… » remplacé), `e2e/tests/capture.spec.ts` si le titre y est vérifié

**Interfaces:**
- Consumes: `stageCounts` du `ProfilesContext` (Task 3).
- Produces: `HomeSummary()` : quatre liens (`/commande`, `/envies`, `/dressing`, `/a-vendre`, avec `profileHref`) montrant le nombre en grand et le libellé ; affichés même à zéro ; rien tant que les compteurs ne sont pas chargés (pas de faux zéro).

- [ ] **Step 1: Write the failing tests** : e2e « l'accueil demande quel article, puis résume le dressing » : `h1` « Quel article as-tu repéré ? », le texte « Closyria » n'apparaît plus dans le contenu de l'accueil, champ « Coller un lien » de largeur ≤ 560 px à 1440, puis après avoir gardé une envie : le lien « 1 envie » mène à `/envies` ; un compte neuf voit « 0 » sur les quatre cases ; contenu aligné à gauche (le `h1` commence au même x que le champ).
- [ ] **Step 2:** build + e2e → FAIL.
- [ ] **Step 3:** implémenter (aligné à gauche, cases en grille 2×2 sur téléphone, 4 de front dès `md`).
- [ ] **Step 4:** `pnpm e2e` complet → PASS.
- [ ] **Step 5: Commit** `feat(web): accueil, quel article as-tu repéré et résumé du dressing`

### Task 6: Documentation et mise en service

**Files:**
- Modify: `docs/specs/2026-11-06-retours-tests-2a.md` (Passe design : livré en dev), ce plan (cases)

- [ ] **Step 1:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test` au vert ; build + `pnpm e2e` au vert.
- [ ] **Step 2: Commit** `docs: passe design livrée en dev` ; fusion dans `dev`, push et déploiement dev **après accord** de la fondatrice, puis ses tests guidés (ordinateur et téléphone).

## Bilan

(à remplir à la fin)
