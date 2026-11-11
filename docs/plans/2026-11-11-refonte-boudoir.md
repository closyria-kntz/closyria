# Refonte « Boudoir » — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refaire toute l'app web de Closyria dans l'identité Boudoir et la nouvelle structure (Accueil · Découvrir · + · Mes articles · Moi), avec des actions écrites et un guidage, sans perdre aucune fonction existante.

**Architecture:** Les jetons de `packages/design-tokens` changent (Boudoir clair et sombre) et toute l'interface les suit. La coque (`app-shell`, `app-nav`) porte le nouveau menu et le bouton + ; « Mes articles » réutilise `WardrobeView` avec une vue « Tout » ; l'Accueil agrège des données qui existent déjà ; Découvrir montre les boutiques connues avec une « boutique de la semaine ».

**Tech Stack:** Next 16 (App Router), Tailwind 4, next-intl, Hono + zod-openapi, Drizzle (une migration pour la boutique de la semaine), Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-11-refonte-boudoir.md` — maquette de référence https://claude.ai/artifact/WgzJUyaHkMMqSp5G8Gb7xY (valeurs à reprendre telles quelles).

## Global Constraints

- Couleurs (clair) : fond `#FBF7F4`, encre `#2B1418`, secondaire `#755A5F` (au lieu de `#86686D`, pour le contraste AA), filets `#ECDCD9`, cartes `#FFFFFF`, doux `#F6E6E3`, rose poudré `#F3D6DA`, bordeaux `#5B1A2A`, bordeaux accent `#8C2A3C`, ocre `#D9A441`, astuce `#FFF1D6` / `#5A3D00`. Sombre (validé le 2026-11-11) : fond `#1C0F12`, encre `#F6E9EA`, secondaire `#C2A6AB`, filets `#43282E`, cartes `#2A171B`, doux `#351D22`, rose foncé `#4A2730` (« unes »), bandeau `#3A1119`, bouton principal `#F3D6DA` avec texte `#2B1418`, accent de texte `#F0A9B6`, ocre `#D9A441`, astuce `#3A2E12` / `#F5DFA8` ; contrastes AA.
- Polices : Gloock (titres, noms d'articles), Figtree (texte), auto-hébergées. Cartes 20 px, pilules, photos 3:4. Étiquette de prix en forme d'étiquette de vêtement (petit trou).
- Menu : Accueil · Découvrir · + · Mes articles · Moi ; un seul menu (bas sur téléphone, haut sur ordinateur).
- Étapes affichées : « Envie · Commandé · Reçu · Dans mon dressing · À vendre » (« Repéré » n'apparaît plus ; identifiants du code inchangés).
- Actions principales en boutons écrits, jamais seulement dans « … ».
- Aucune fonction existante ne disparaît ; anciennes adresses redirigées (`/envies` → `/articles?etape=envie`, `/dressing` → `/articles?etape=dressing`, `/a-vendre` → `/articles?etape=a-vendre`, `/commande` → `/articles?etape=commande` (la vue « Commandé », corrigé le 2026-11-11) ; « Préparer une commande » `/envies/commande` garde son adresse).
- Jetons uniquement (`scripts/check-design-tokens.ts`), clair et sombre, axe AA, zones tactiles ≥ 44 px, réduction des animations respectée.
- Mesurer chaque écran contre la maquette (captures) avant de le montrer.
- Ports interdits 3000/3001/3100/3101, jamais `pkill -f`/`killall`/`git stash` nu, aucun secret ; commits `closyria-kntz` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; `pnpm format` avant.
- Livraison par étapes : à la fin de chaque étape, rien n'est mis en dev sans l'accord de la fondatrice.

## Review Focus

1. Lien ancien (`/envies?liste=<id>`, `/dressing?...` avec filtres) ouvert depuis un favori : arrive au bon endroit de « Mes articles » avec ses filtres — test en Task 2.
2. « Tout » avec des centaines d'articles : la page reste fluide (pagination existante gardée) et les pastilles affichent les bons nombres — test en Task 3.
3. Utilisatrice sans aucun article : Accueil, Mes articles et Moi montrent un écran vide qui explique quoi faire — test en Task 5 et Task 3.
4. Mode sombre choisi dans les réglages : chaque écran refait reste lisible (axe en sombre) — test dans chaque e2e.
5. La découverte de première ouverture ne revient pas après avoir été passée, y compris sur un autre appareil du même compte — test en Task 7.

---

## Étape 0 (contrôleur, avant Task 1)

- [x] Ajouter le mode sombre et l'écran « Mes articles » (Tout, pastilles d'étape, « Par étape » sur ordinateur) à la maquette de référence ; les faire valider par la fondatrice ; reporter les valeurs sombres dans ce plan (Global Constraints).

## Étape 1 — Fondations (montrée puis mise en dev)

### Task 1: Jetons et polices Boudoir

**Files:** `packages/design-tokens/src/{primitives,semantic,theme}.ts` et `css.test.ts`, `apps/web/src/app/layout.tsx` (polices), `apps/web/src/app/globals.css`, `apps/web/package.json` (paquets de polices).

**Interfaces:** Produces : thèmes `boudoirLight` et `boudoirDark` (remplacent `equilibre-*` comme thèmes par défaut ; les identifiants de préférence d'apparence existants restent acceptés et pointent vers Boudoir) ; jetons sémantiques nouveaux : `color-label` (ocre), `color-une` (rose poudré), `color-tip`, `color-tip-ink` ; `--font-title` Gloock, `--font-body` Figtree ; rayons `radius-card` 20 px, `radius-pill` 999 px.

- [x] Test (`css.test.ts`) : le CSS généré contient `--color-surface: #FBF7F4` et `--color-accent: #5B1A2A` en clair et les valeurs sombres validées ; contraste encre/fond ≥ 4,5 dans les deux thèmes (fonction de contraste existante si présente, sinon ajoutée au test).
- [x] Échec attendu, puis implémentation, puis `pnpm --filter @closyria/design-tokens test`, `pnpm lint` (jetons), `pnpm typecheck`.
- [x] e2e : adapter les attentes de couleurs/polices des tests existants qui en vérifient (s'il y en a) ; suite complète.
- [x] Commit « feat(refonte): jetons et polices Boudoir ».

### Task 2: Coque, menu, bouton + et redirections

**Files:** `apps/web/src/components/app-nav.ts` (+ test), `app-shell.tsx`, nouveau `apps/web/src/components/add-sheet.tsx`, nouvelles pages `apps/web/src/app/(app)/articles/page.tsx`, `moi/page.tsx`, `decouvrir/page.tsx` (squelettes), redirections dans `envies/`, `dressing/`, `a-vendre/`, `commande/` pages, `fr.json` (`Nav.*`, `Add.*`), e2e `e2e/tests/navigation.spec.ts`.

**Interfaces:** Produces : `appNav: readonly { key: "accueil"|"decouvrir"|"articles"|"moi"; href: string }[]` + action `add` ; `AddSheet` (ouvre : « Coller un lien » → champ de capture existant, « Prendre une photo » → `add-photo-dialog`, « Partager depuis une boutique » → aide de partage, « Transférer un e-mail de commande » → désactivé « Bientôt ») ; pages `/articles`, `/moi`, `/decouvrir` (contenu en Tasks 3, 6, 7).

- [x] e2e d'abord (3 appareils) : menu téléphone à 5 places dans l'ordre exact, bouton + au centre ouvre la feuille avec les 4 options ; ordinateur : menu en haut seulement (pas de menu bas) ; chaque ancienne adresse (avec `?liste=<id>` et un filtre) redirige vers `/articles` avec l'étape et les filtres gardés ; axe clair et sombre.
- [x] Implémenter, relancer, suite e2e complète (adapter les tests qui naviguaient par l'ancien menu), commit « feat(refonte): coque, menu et bouton Ajouter ».

**Fin d'étape 1 :** captures téléphone/ordinateur comparées à la maquette ; montrer à la fondatrice ; mise en dev avec son accord.

## Étape 2 — Mes articles et fiche

### Task 3: « Mes articles »

**Files:** `apps/web/src/components/wardrobe-view.tsx` (vue `articles`), `item-card.tsx`, `item-grid.tsx`, `filters-bar.tsx`, `list-tabs.tsx`, nouveau `stage-board.tsx` (« Par étape »), `apps/web/src/app/(app)/articles/page.tsx`, `apps/api` si un compte par étape manque (`GET /api/me/items/counts` → `{ envie, commande, recu, dressing, a_vendre }`), `fr.json`, e2e `e2e/tests/articles.spec.ts`.

**Interfaces:** Consumes `itemListQuerySchema` (`stage` facultatif = tout). Produces : paramètre d'adresse `etape` (`envie|commande|recu|dressing|a-vendre`, absent = Tout) ; onglets « Articles · Listes · Commandes groupées » ; pastilles avec nombres ; étiquette d'étape sur chaque carte ; étiquette de prix ; bouton « Par étape » (ordinateur ≥ 1024 px) affichant 4 colonnes Envies · Commandés · Reçus · Dans mon dressing ; « Préparer une commande » dans le filtre Envies.

- [ ] Tests d'abord : unitaire du passage étape ↔ paramètre ; e2e : « Tout » montre des articles de plusieurs étapes avec leur étiquette ; pastilles et nombres corrects ; filtre Envies garde sélection, budget et « Préparer une commande » ; Listes et Commandes groupées accessibles depuis les onglets ; « Par étape » sur ordinateur ; écran vide expliquant quoi faire ; 200 articles : défilement et chargement par pages ; axe clair/sombre.
- [ ] Implémenter, relancer, adapter les e2e qui visaient `/envies`, `/dressing`, `/a-vendre`, `/commande` ; commit « feat(refonte): Mes articles ».

### Task 4: Fiche d'un article

**Files:** `apps/web/src/app/(app)/produits/[id]/*` (`item-panel.tsx`, `product-actions.tsx`, `keep-actions.tsx`, `stage-dialog.tsx`), `item-opinions-section.tsx`, `fr.json`, e2e existants de la fiche.

**Interfaces:** Produces : bandeau d'avancée « Envie → Commandé → Reçu → Dans mon dressing » (étape courante marquée, `aria-current="step"`) ; bloc « Que veux-tu faire ? » avec boutons écrits selon l'étape (Envie : « Je l'ai commandé », « Voir chez {boutique} », « Demander un avis », « Ajouter à une liste », « M'alerter si le prix baisse », « Partager » ; autres étapes : les actions existantes équivalentes) ; « … » ne garde que les actions rares (supprimer, déplacer de profil).

- [ ] e2e d'abord : pour un article de chaque étape, l'avancée marque la bonne étape et chaque action principale est un bouton visible qui fonctionne (aucune n'exige « … ») ; avertissement 🎁 toujours présent sur « Je l'ai commandé » ; axe clair/sombre.
- [ ] Implémenter, relancer, commit « feat(refonte): fiche article ».

**Fin d'étape 2 :** comparaison maquette, présentation, mise en dev avec accord.

## Étape 3 — Accueil et Découvrir

### Task 5: Accueil

**Files:** nouvelle route API `apps/api/src/routes/me/home.ts` (+ test d'intégration), schéma `homeViewSchema` dans `packages/shared/src/home.ts`, `apps/web/src/app/(app)/page.tsx`, nouveaux composants `home-une.tsx`, `home-news.tsx`, `fr.json`, e2e `e2e/tests/home.spec.ts`.

**Interfaces:** Produces `GET /api/me/home` → `{ greetingName: string|null, une: NewsItem|null, news: NewsItem[] (≤ 5), wishes: ItemView[] (≤ 4) }` avec `NewsItem = { kind: "price_drop"|"size_back"|"opinion"|"group_order"|"gift_reminder", itemId?, title, detail, href, at }`, construit uniquement à partir de données existantes (baisses de prix et tailles revenues depuis 7 jours, avis nouveaux non vus, commandes groupées ouvertes/closes, rappel cadeau dû) ; la « une » est la nouvelle la plus récente avec photo.

- [ ] Tests d'abord : intégration (chaque type de nouvelle apparaît avec son lien ; aucune nouvelle d'une autre utilisatrice ; vide → `une: null, news: []`) ; e2e (une, nouvelles, zone « Colle son lien ici » qui capture comme aujourd'hui, astuce fermable, boutiques à découvrir, envies du moment ; écran vide d'une nouvelle utilisatrice qui explique quoi faire ; axe).
- [ ] Implémenter, relancer, commit « feat(refonte): accueil ».

### Task 6: Découvrir — boutiques

**Files:** migration `0019_boutique_de_la_semaine.sql` (`shops.featured_at timestamptz null`), route publique `GET /api/shops` (boutiques `active`, nom, domaine, nombre d'articles, une photo) et route admin `POST /api/admin/shops/{id}/feature`, `apps/web/src/app/(app)/decouvrir/page.tsx`, bouton admin « Boutique de la semaine » sur la page d'une boutique, tests d'intégration et e2e `e2e/tests/decouvrir.spec.ts`.

**Interfaces:** Produces `shopDirectorySchema = { featured: ShopCard|null, shops: ShopCard[] }`, `ShopCard = { id, name, domain, itemCount, imageUrl|null }` ; une seule boutique mise en avant (la plus récente `featured_at`) ; noms d'utilisatrices jamais exposés.

- [ ] Tests d'abord : intégration (seules les boutiques actives ; mise en avant unique ; audit admin) ; e2e (une « boutique de la semaine », grille des boutiques avec lien vers le site, recherche par nom, écran vide si aucune boutique) ; axe.
- [ ] Implémenter, relancer, commit « feat(refonte): Découvrir, boutiques ».

**Fin d'étape 3 :** comparaison maquette, présentation, mise en dev avec accord.

## Étape 4 — Moi, guidage, amies, finitions

### Task 7: Moi, découverte et astuces

**Files:** `apps/web/src/app/(app)/moi/page.tsx` et sous-pages (réglages existants rattachés), nouveaux `onboarding.tsx`, `tip.tsx`, préférences de compte (`seenTips: string[]`, `onboardedAt`) côté API (`PATCH /api/me/preferences` existant étendu, schéma partagé), `fr.json`, e2e `e2e/tests/moi.spec.ts`, `e2e/tests/onboarding.spec.ts`.

**Interfaces:** Produces `Tip({ id, title, children })` qui ne s'affiche plus une fois fermé (préférence de compte) ; `Onboarding` 3 écrans (« Garde tes envies, on veille pour toi », « Demande l'avis de tes amies », « Range ton dressing ») avec « Continuer » et « Passer ».

- [ ] Tests d'abord : Moi montre dressing, à vendre, budget, réglages et « Commandes — bientôt » ; découverte affichée à la première connexion, plus jamais après « Passer » ou la fin, même sur un autre navigateur du même compte ; astuce fermée ne revient pas ; axe.
- [ ] Implémenter, relancer, commit « feat(refonte): Moi, découverte et astuces ».

### Task 8: Lien des amies, commande groupée, finitions

**Files:** `apps/web/src/app/l/[token]/*`, `group-order-view.tsx` et dialogues, `share-panel.tsx`, anciens jetons retirés de `packages/design-tokens`, utilitaires CSS « Cocon » supprimés de `globals.css`, tous les e2e, docs (spec § « Décisions de construction », plan coché).

- [ ] Restyler le lien des amies (actions écrites : « Je lui offre », « Je participe », « Je le prends aussi », « Donner mon avis ») et la commande groupée selon la maquette ; retirer les jetons et classes de l'ancienne direction (le contrôle des jetons ne doit plus en trouver) ; suite e2e complète sur les 3 appareils en clair et sombre ; captures comparées à la maquette pour chaque écran.
- [ ] Commit « feat(refonte): lien des amies, commande groupée, finitions ».

**Fin d'étape 4 :** revue d'ensemble de la branche, présentation, mise en dev avec accord.
