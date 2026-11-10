# Acheter ensemble — retours de la fondatrice (2026-11-11) — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Les retours de la fondatrice après son essai sur dev : son propre lien dans la commande, les options de livraison en modifiant, la commande en haut du lien avec « Haut de page », et quatre améliorations (filtre par boutique, message à copier, prix payé et budget, rappels de paiement) avec les corrections de fond en attente.

**Spec:** `docs/specs/2026-11-10-acheter-ensemble.md` (§ 11 ajouté par ce chantier).

## Global Constraints

- Mêmes règles que `docs/plans/2026-11-10-acheter-ensemble.md` (Global Constraints) : code anglais, interface française, montants en centimes, jetons de design, clair et sombre, zones tactiles ≥ 44 px, aucune fuite de `mine`, ports interdits 3000/3001/3100/3101, jamais `pkill -f`/`killall`/`git stash` nu, commits `closyria-kntz` avec `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `pnpm format` avant.
- Textes validés : « Ajouter un autre article » (fondatrice), « Voir le détail ({n} articles) », « Haut de page », « Tous les articles », « Seulement {boutique} », « Copier le message », « Commande groupée chez {boutique} jusqu'au {date} : ajoute tes articles ici 👉 {lien} » (sans date : sans « jusqu'au {date} »), « Copier un rappel », « Coucou {prénom}, tu me dois {montant} pour la commande {boutique} 🙂 », « Copié ✓ ».

## Décisions validées (2026-11-11)

- R1 Lien de la fondatrice : l'article va dans ses envies **et** la liste, puis est coché dans la commande. Lien d'une autre boutique refusé (« Ce lien n'est pas chez {boutique}. »).
- R2 « Modifier la date et la livraison » : options de la boutique + « Autre », comme à l'ouverture.
- R3 Lien des amies : bloc commande juste sous le titre (bandeau, total, avancée, « Ta part ») ; détail par personne replié (« Voir le détail ({n} articles) ») ; bouton flottant « Haut de page » dès qu'on a descendu d'un écran, sur le lien des amies, la page d'une liste et la page « Commande groupée ».
- A1 Filtre sur le lien pendant une commande ouverte : « Tous les articles » (par défaut) / « Seulement {boutique} ».
- A2 « Copier le message » sur la page « Commande groupée » (ouverte).
- A3 « J'ai commandé » enregistre le prix final de chacun de ses articles comme prix payé (`items.price_paid_cents`) et le compte dans « Déjà commandé » du budget, par le chemin existant des événements « Commandé ».
- A4 « Copier un rappel » pour chaque amie qui n'a pas payé (commande passée).
- Corrections de fond : nom figé à « J'ai commandé » (écrire `manual_name` = nom affiché au moment de commander) ; relectures du lien des amies dans l'ordre (numéro de séquence) et relecture au retour sur l'onglet ; test e2e « focus après Retirer » et test admin « Tester un lien » rendus stables.

---

### Task 1: API — lien de la fondatrice, prix payé, nom figé

**Files:** `apps/api/src/wardrobe/group-orders.ts`, `apps/api/src/routes/me/group-orders.ts`, `packages/shared/src/group-orders.ts`, `apps/api/src/routes/me/group-orders.integration.test.ts` (+ budgets test si besoin)

**Interfaces:**
- Produces : `POST /api/me/group-orders/{id}/own-link` body `{ url, sizeLabel, quantity }` → 201 `ownerGroupOrderSchema`. Crée ou retrouve l'article de la fondatrice pour ce produit par le chemin existant (capture + `createItem` en « Repéré »), l'ajoute à la liste de la commande, puis ajoute sa ligne (avec `product_id` et `manual_name`). Erreurs : `400 not_in_shop {shopName}` (racine de boutique différente ou inconnue, jamais de boutique créée), `409 group_order_locked`, `409 too_many_lines`.
- « J'ai commandé » : chaque article de la fondatrice reçoit `price_paid_cents` = prix final **unitaire** (le prix payé d'un article est unitaire ; la quantité ne change pas l'article), et « Déjà commandé » du budget le compte par le chemin existant (lire `apps/api/src/wardrobe/spent.ts` et `events.ts`) ; `manual_name` de chaque ligne = nom affiché au moment de commander.

- [ ] Tests d'intégration d'abord : lien même boutique → article dans ses envies et dans la liste, ligne cochée ; lien autre boutique → 400 sans boutique créée ; même produit déjà dans ses envies → pas de doublon d'article ; après « J'ai commandé » avec prix corrigé 4200 → `price_paid_cents` 4200 et budget « Déjà commandé » augmenté de 4200 × quantité selon la règle existante ; article renommé juste avant de commander → nom figé = nouveau nom.
- [ ] Implémenter, relancer, `pnpm lint`, `pnpm typecheck`, commit « feat(acheter-ensemble): lien de la fondatrice, prix payé, nom figé ».

### Task 2: Écrans de la fondatrice

**Files:** `apps/web/src/components/group-order-view.tsx`, `group-order-open-dialog.tsx` (réutiliser le choix de livraison), `apps/web/src/components/wishlist-detail.tsx`, nouveau `apps/web/src/components/back-to-top.tsx`, `apps/web/src/lib/wardrobe-client.ts`, `fr.json`, `e2e/tests/group-order-owner.spec.ts`

- [ ] e2e d'abord : coller un lien de la même boutique → l'article apparaît coché dans « Toi » et dans la liste ; autre boutique → message ; « Modifier » propose les options de la boutique et « Autre » ; « Copier le message » → presse-papiers contient le texte validé avec le lien de partage ; après commande, « Copier un rappel » pour l'amie non payée → texte validé ; « Haut de page » visible après défilement, ramène en haut (page liste et page commande).
- [ ] Implémenter (copie via `navigator.clipboard.writeText` dans le clic, retour « Copié ✓ », repli : texte sélectionnable si refus) ; relancer ; commit « feat(acheter-ensemble): lien, livraison, messages à copier côté fondatrice ».

### Task 3: Lien des amies

**Files:** `apps/web/src/app/l/[token]/opinions.tsx`, `group-order.tsx`, `back-to-top.tsx` (Task 2), `fr.json`, `e2e/tests/group-order.spec.ts`

- [ ] e2e d'abord : bloc commande au-dessus de la liste des articles ; détail replié puis ouvert par « Voir le détail ({n} articles) » ; filtre « Seulement {boutique} » masque les articles d'autres boutiques, « Tous les articles » les remet ; « Haut de page » ; le test « focus après Retirer » passe 10 fois de suite sur les 3 appareils (`--repeat-each=10`).
- [ ] Implémenter ; relectures dans l'ordre (numéro de séquence, réponse plus ancienne ignorée) et relecture au retour sur l'onglet ; commit « feat(acheter-ensemble): commande en haut du lien, filtre, haut de page ».

### Task 4: Test admin instable et documentation

**Files:** `e2e/tests/admin-shops.spec.ts` (ou le fichier du test « Tester un lien »), `docs/specs/2026-11-10-acheter-ensemble.md` (§ 11 « Retours du 2026-11-11 »), ce plan (cases cochées)

- [ ] Trouver la cause de l'instabilité sous charge du test « Tester un lien » (attente d'un état réel plutôt qu'un délai) ; le faire passer 10 fois de suite sur les 3 appareils ; suite e2e complète une fois ; spec § 11 ; commit « test: stabilise « Tester un lien » ; docs ».
