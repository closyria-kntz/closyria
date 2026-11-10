# Acheter ensemble (partie 2c) — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur le lien d'une liste partagée, une commande groupée chez une boutique : les amies ajoutent leurs articles (de la liste ou par lien de la même boutique), tout le monde voit l'avancée vers la livraison offerte, la fondatrice clôture, commande, et coche « Payé ».

**Architecture:** Trois tables (`group_orders`, `group_order_lines`, `group_order_payments`) et une table admin `shop_shipping_options`. Le calcul (total, port, parts) est une fonction pure de `packages/shared`, utilisée par l'API et l'affichage. Les amies passent par `/api/shared/{token}/group-order/*` avec la même identité qu'en 2a/2b (`ensureFriendDevice`, `lockFriendName`) ; la fondatrice par `/api/me/wishlists/{id}/group-order*` ; l'admin par `/api/admin/shops/{id}/shipping-options`.

**Tech Stack:** Hono + `@hono/zod-openapi`, Drizzle/PostgreSQL (migration `0018`), Zod partagé, Next 16, next-intl (`packages/i18n/messages/fr.json`), Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-10-acheter-ensemble.md`

## Global Constraints

- Code en anglais, interface et documentation en français ; textes exacts de la spec § 3 et § 4 : « Commande groupée chez {boutique} avec {prénom}, jusqu'au {date} », « Total {total} · Plus que {reste} pour la livraison offerte », « Total {total} · Livraison offerte ✓ », « Total {total} · Port {port}, partagé entre celles qui commandent », « Je le prends aussi », « Tu le prends aussi ({taille} × {quantité}) », « Ajouter un autre article », « Ce lien n'est pas chez {boutique}. », « Lecture de l'article… », « Ta part : {montant} (articles {sous-total} + port {part}) », « provisoire », « Commande close, {prénom} va commander. », « Commandé le {date}. », « Tu dois {montant} à {prénom} », « Payé ✓ », « Commande annulée. », « Retiré par {prénom} », « Ouvrir une commande groupée », « Clôturer », « Rouvrir », « J'ai commandé », « Annuler la commande groupée », « Je le prends dans cette commande », « Prix inconnu », « Commandes groupées passées », « Livraison » (admin).
- Identité d'amie : prénom `friendNameSchema`, clé `deviceKeySchema`, `opinionNameKey`, `lockFriendName` + `ensureFriendDevice` (`apps/api/src/wardrobe/friend-device.ts`), `409 name_taken` et `claim` comme en 2b.
- Montants en centimes entiers ; quantité 1 à 5 ; taille ≤ 40 caractères ; nom saisi 1 à 120 caractères ; 20 lignes actives max par amie et par commande ; date limite `YYYY-MM-DD`, fin de journée Europe/Paris.
- Limites : 30 actions / heure / appareil / commande, 120 / heure / adresse réseau / commande (limiteur `apps/api/src/rate-limit.ts`), `429` avec le message existant des cadeaux.
- Aucune fuite : `mine` (montant dû, lignes retirées) seulement pour l'appareil rattaché au prénom ; le rendu serveur du lien sans `x-device-key` n'a jamais de `mine`.
- Les lignes des amies ne créent jamais d'article (`items`) chez la fondatrice.
- Jetons de design uniquement, composants existants, clair et sombre, zones tactiles ≥ 44 px (`hit-area`).
- Jamais les ports 3000/3001/3100/3101, jamais `pkill -f`/`killall`, jamais `git stash` nu ; aucun secret dans le dépôt.
- Commits : `git -c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com commit`, message terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; `pnpm format` avant.

## Décisions du plan (non fixées par la spec)

- La fondatrice n'a aucune ligne : le reste des centimes du port va à la première personne affichée (première amie arrivée).
- Monnaie de la commande : celle du premier article de la boutique dans la liste qui en a une, sinon `EUR` ; une ligne d'une autre monnaie → `409 currency_mismatch`.
- Les paiements (`group_order_payments`) sont créés à « J'ai commandé », une ligne par amie ayant au moins une ligne active, montant figé.
- Lien d'amie : la boutique est retrouvée par domaine **sans jamais créer de boutique** (`findShopByHost`) ; une capture est demandée comme `POST /captures` avec `requested_by` nul.

## Review Focus

1. Deux amies ajoutent leur premier article en même temps alors qu'il reste 10 € avant la livraison offerte : les parts de port affichées chez chacune après relecture sont cohérentes avec le total (une seule source : la fonction partagée) — test en Task 1.
2. La fondatrice change l'option de livraison d'une boutique en admin pendant qu'une commande est ouverte : la commande garde l'ancienne valeur — test en Task 2.
3. Date limite aujourd'hui, ajout à 23 h 30 heure de Paris : accepté ; le lendemain à 0 h 05 : refusé (`403 group_order_locked`) — test en Task 4.
4. Une amie colle un lien d'une boutique inconnue de Closyria : refus clair, aucune boutique créée en base — test en Task 4.
5. « J'ai commandé » avec un article de la fondatrice réservé en cadeau : l'avertissement 🎁 s'affiche, « Attendre » n'envoie rien et la commande reste close — test en Task 6.

---

### Task 1: Données, schémas partagés et calcul

**Files:**
- Create: `packages/db/migrations/0018_acheter_ensemble.sql` (générée, renommée), `packages/shared/src/group-orders.ts`, `packages/shared/src/group-orders.test.ts`, `packages/testing/src/migration-0018.integration.test.ts`
- Modify: `packages/db/src/schema/catalog.ts` (`shopShippingOptions`), `packages/db/src/schema/wardrobe.ts` (trois tables), `packages/shared/src/index.ts`, `packages/shared/src/wardrobe.ts`

**Interfaces:**
- Produces (DB) :
  - `shopShippingOptions` (`shop_shipping_options`) : `id`, `shopId` (cascade), `label` (1–40), `shippingCents` (≥ 0), `freeFromCents` (nullable, > 0), `position`, timestamps.
  - `groupOrders` (`group_orders`) : `id`, `wishlistId` (cascade), `shopId` (→ shops), `status` (`open|closed|ordered|cancelled`, check), `deadline` (`date`, nullable), `shippingLabel`, `shippingCents`, `freeFromCents` (nullable), `currency` (3 lettres), `orderedAt`, `cancelledAt` (nullable), timestamps ; index unique partiel (`wishlist_id`) `WHERE status IN ('open','closed')`.
  - `groupOrderLines` (`group_order_lines`) : `id`, `groupOrderId` (cascade), `buyerName` (nullable : nul = la fondatrice), `buyerNameKey` (nullable), `itemId` (→ items, set null, nullable), `productId` (→ products, nullable), `url` (nullable), `manualName` (nullable, 1–120), `manualPriceCents` (nullable), `sizeLabel` (nullable, ≤ 40), `quantity` (1–5, check), `finalPriceCents` (nullable), `removedAt` (nullable), timestamps ; check : `item_id` ou `product_id` ou `manual_name` non nul.
  - `groupOrderPayments` (`group_order_payments`) : `groupOrderId` (cascade), `buyerNameKey`, `buyerName`, `amountCents`, `paidAt` (nullable) ; clé primaire (`group_order_id`, `buyer_name_key`).
- Produces (shared, `group-orders.ts`) :
  - `groupOrderStatusSchema = z.enum(["open","closed","ordered","cancelled"])`, `GROUP_ORDER_MAX_LINES = 20`, `GROUP_ORDER_MAX_QUANTITY = 5`.
  - `shippingOptionInputSchema = z.object({ label, shippingCents: z.int().min(0), freeFromCents: z.int().positive().nullable() })`.
  - `groupOrderCreateSchema = z.object({ shopId: z.uuid(), shippingOptionId: z.uuid().optional(), shipping: z.object({ label, shippingCents, freeFromCents }).optional(), deadline: z.iso.date().nullable() })` (exactement un de `shippingOptionId` / `shipping`).
  - `groupOrderPatchSchema` (deadline, shipping), `groupOrderActionSchema = z.object({ action: z.enum(["close","reopen","cancel"]) })`, `groupOrderOrderSchema = z.object({ shippingCents: z.int().min(0), lines: z.array(z.object({ id: z.uuid(), priceCents: z.int().min(0) })) })`.
  - `friendLineInputSchema = z.discriminatedUnion("source", [{ source: "item", itemId, sizeLabel, quantity, name, deviceKey, claim? }, { source: "url", url, sizeLabel, quantity, name, deviceKey, claim? }, { source: "manual", manualName, manualPriceCents, url?, sizeLabel, quantity, name, deviceKey, claim? }])`, `friendLinePatchSchema` (sizeLabel, quantity, manualName?, manualPriceCents?, name, deviceKey), `friendLineDeleteSchema` (name, deviceKey).
  - `computeGroupOrderTotals(input: { people: { key: string; isOwner: boolean; linesCents: number[] }[]; shippingCents: number; freeFromCents: number | null }): { totalCents: number; remainingForFreeCents: number | null; shippingTotalCents: number; perPerson: Record<string, { itemsCents: number; shippingCents: number; totalCents: number }> }` — personnes dans l'ordre d'affichage ; seules celles avec ≥ 1 ligne participent au port.
  - `sharedGroupOrderSchema` (vue des amies) et `ownerGroupOrderSchema` (vue de la fondatrice), voir Tasks 3 et 4 pour les champs ; `sharedWishlistViewSchema` + `groupOrder: sharedGroupOrderSchema.nullable()` ; `wishlistViewSchema` + `groupOrder: z.object({ id, status, shopName }).nullable()`.

- [ ] **Step 1: tests du calcul** (`group-orders.test.ts`) :
  - port 690, sans seuil, 3 personnes (fondatrice + 2) → 230 chacune ;
  - port 700, 3 personnes → fondatrice 234, amies 233 (reste à la fondatrice) ;
  - port 700, fondatrice sans ligne, 3 amies → première amie 234 ;
  - seuil 8000, total 5700 → `remainingForFreeCents: 2300`, port partagé ; total 8000 → `remainingForFreeCents: 0`, port 0 pour toutes ;
  - personne sans ligne → pas de part de port, absente de `perPerson` ;
  - aucune ligne → total 0, port 0.
- [ ] **Step 2: tests de schéma** : `friendLineInputSchema` refuse `quantity: 6`, une taille de 41 caractères, `source: "manual"` sans prix ; `groupOrderCreateSchema` refuse à la fois `shippingOptionId` et `shipping`.
- [ ] **Step 3: test de migration** (`migration-0018`) : deux commandes `open` sur la même liste → erreur d'unicité ; une `ordered` + une `open` → OK ; `quantity = 0` → erreur ; ligne sans item, produit ni nom → erreur ; supprimer la boutique d'une option → l'option disparaît.
- [ ] **Step 4: lancer** `pnpm --filter @closyria/shared test` et `pnpm --filter @closyria/testing test -- migration-0018` → échecs attendus.
- [ ] **Step 5: implémenter** schémas Drizzle, migration (`pnpm --filter @closyria/db generate`, renommer en `0018_acheter_ensemble.sql`), schémas et calcul partagés ; vues existantes remplies par défaut (`groupOrder: null`).
- [ ] **Step 6: relancer** → PASS ; `pnpm typecheck` → PASS.
- [ ] **Step 7: commit** « feat(acheter-ensemble): données, schémas et calcul ».

### Task 2: Admin — livraison des boutiques

**Files:**
- Create: `apps/api/src/routes/admin/shipping-options.ts`, `apps/api/src/routes/admin/shipping-options.integration.test.ts`, `apps/web/src/app/admin/(shell)/boutiques/[id]/shipping-options.tsx`
- Modify: `apps/api/src/app.ts` (montage), `apps/web/src/app/admin/(shell)/boutiques/[id]/page.tsx`, `packages/i18n/messages/fr.json` (`Admin.shipping.*`)

**Interfaces:**
- Produces : `GET /api/admin/shops/{id}/shipping-options` → `{ options: ShippingOption[] }` (triées par `position`), `POST` (création, 201), `PATCH /api/admin/shops/{id}/shipping-options/{optionId}`, `DELETE …/{optionId}` (204) ; accès `admin` (même `defineAccess` que `routes/admin/shops.ts`), chaque écriture notée par `noteAudit`.
- Produces : `listShippingOptions(db, shopId): Promise<ShippingOption[]>` (dans `apps/api/src/catalog/shipping-options.ts`), utilisé par Task 3.

- [ ] **Step 1: tests d'intégration** : créer deux options puis lire → ordre conservé ; `label` vide → 400 ; `freeFromCents: 0` → 400 ; un compte non admin → 403 ; chaque écriture ajoute une entrée d'audit ; supprimer → 204 puis absente.
- [ ] **Step 2: lancer** → échecs ; **Step 3: implémenter** routes et section « Livraison » (liste, ajouter, modifier, supprimer avec confirmation ; montants saisis en euros, envoyés en centimes) ; **Step 4: relancer** → PASS.
- [ ] **Step 5: test de la copie** (dans le test de Task 3, rappelé ici) : modifier l'option après ouverture d'une commande ne change pas `group_orders.shipping_cents`.
- [ ] **Step 6: commit** « feat(acheter-ensemble): options de livraison en admin ».

### Task 3: API de la fondatrice

**Files:**
- Create: `apps/api/src/wardrobe/group-orders.ts`, `apps/api/src/routes/me/group-orders.ts`, `apps/api/src/routes/me/group-orders.integration.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/wardrobe/wishlists.ts` (`listWishlistViews` : `groupOrder`)

**Interfaces:**
- Consumes : `computeGroupOrderTotals`, `listShippingOptions`, `runBulk(db, userId, { op: "stage", ids, to: "ordered" }, now)` (`apps/api/src/wardrobe/bulk.ts`).
- Produces (routes, accès « session » comme `/me/wishlists`) :
  - `POST /api/me/wishlists/{id}/group-order` (`groupOrderCreateSchema`) → 201 `ownerGroupOrderSchema` ; liste non partagée → `409 not_shared` ; boutique absente des articles de la liste → `400 shop_not_in_list` ; déjà une en cours → `409 already_open`.
  - `GET /api/me/wishlists/{id}/group-order` → la commande en cours ou la dernière commandée/annulée de moins de 30 jours, sinon 404 ; `GET /api/me/wishlists/{id}/group-orders` → `{ past: { id, shopName, status, orderedAt, cancelledAt, totalCents, unpaidCount }[] }`.
  - `PATCH /api/me/group-orders/{id}` (`groupOrderPatchSchema`, refusé si `ordered|cancelled` → `409 group_order_locked`) ; `POST /api/me/group-orders/{id}/action` (`close` : open→closed ; `reopen` : closed→open ; `cancel` : open|closed→cancelled ; transition invalide → `409 invalid_transition`).
  - `PUT /api/me/group-orders/{id}/own-lines` `{ lines: { itemId, sizeLabel, quantity }[] }` : remplace les lignes de la fondatrice (articles de la liste et de la boutique seulement, sinon 400).
  - `DELETE /api/me/group-orders/{id}/lines/{lineId}` (pose `removedAt`) et `POST …/lines/{lineId}/restore`.
  - `POST /api/me/group-orders/{id}/order` (`groupOrderOrderSchema`, depuis `open|closed`) : fige `finalPriceCents` et le port, passe à `ordered`, crée les paiements, déplace ses articles vers « Commandé » par `runBulk` ; une ligne sans prix ni prix final → `400 missing_price`. Réponse : `ownerGroupOrderSchema` + `undo` de `runBulk` non exposé (pas d'annulation de « J'ai commandé »).
  - `PUT /api/me/group-orders/{id}/payments/{nameKey}` `{ paid: boolean }`.
- Produces : `ownerGroupOrderSchema = { id, wishlistId, shop: { id, name }, status, deadline, shipping: { label, shippingCents, freeFromCents }, currency, totals (sortie de computeGroupOrderTotals), people: { key, name, isOwner, lines: { id, name, imageUrl, url, sizeLabel, quantity, unitPriceCents: number | null, finalPriceCents, status: "reading"|"ready"|"manual", removedAt }[], payment: { amountCents, paidAt } | null }[], ownItems: { itemId, name, imageUrl, sizes: string[] }[], orderedAt, cancelledAt }`.

- [ ] **Step 1: tests d'intégration** : ouverture avec option (copie des valeurs) et avec saisie libre ; deuxième ouverture → 409 ; boutique hors liste → 400 ; liste non partagée → 409 ; close → reopen → close → order ; order depuis cancelled → 409 ; order avec prix modifié → montants figés, paiements créés pour chaque amie avec `amountCents` = part calculée ; ses articles passent à `ordered` ; ligne sans prix → 400 ; retrait puis restauration d'une ligne d'amie ; « Payé » puis annulation ; option admin modifiée après ouverture → commande inchangée ; aucune route `/api/me/*` d'une autre utilisatrice ne lit la commande (404).
- [ ] **Step 2: lancer** → échecs ; **Step 3: implémenter** ; **Step 4: relancer** → PASS.
- [ ] **Step 5: commit** « feat(acheter-ensemble): API de la fondatrice ».

### Task 4: API des amies (lien partagé)

**Files:**
- Create: `apps/api/src/routes/shared-group-order.integration.test.ts`, `apps/api/src/catalog/product-capture.ts`
- Modify: `apps/api/src/wardrobe/group-orders.ts`, `apps/api/src/routes/shared.ts`, `apps/api/src/wardrobe/wishlists.ts` (`loadSharedView`), `apps/api/src/catalog/shops.ts` (exporter `findShopByHost`), `apps/api/src/routes/captures.ts` (utiliser `requestProductCapture`)

**Interfaces:**
- Produces : `findShopByHost(db, host): Promise<Shop | null>` (l'actuelle `findShop`) ; `requestProductCapture(db, queue, { url, shop, requestedBy: string | null, now }): Promise<{ productId: string; status: CaptureStatus }>` extrait de `routes/captures.ts` sans changer son comportement.
- Produces (routes) :
  - `GET /api/shared/{token}` + `groupOrder` (`sharedGroupOrderSchema` : `{ id, shopName, ownerName, status, deadline, locked: boolean, shipping, currency, totals: { totalCents, remainingForFreeCents, shippingTotalCents }, people: { name, isOwner, lines: { id, name, imageUrl, sizeLabel, quantity, unitPriceCents, status }[] }[], eligibleItemIds: string[], mine: { name, lineIds, itemsCents, shippingCents, totalCents, provisional, paidAt, removedLines: { id, name }[] } | null, orderedAt }`) ; commande annulée depuis plus de 30 jours ou liste non partagée → `null`.
  - `POST /api/shared/{token}/group-order/lines` (`friendLineInputSchema`) → 201 `{ lineId }` ; `PATCH …/lines/{lineId}` ; `DELETE …/lines/{lineId}` (204).
  - Erreurs : `403 group_order_locked` (close, commandée, annulée ou date passée), `409 name_taken`, `409 too_many_lines` (> 20), `400 not_in_shop` `{ shopName }` (lien d'une autre boutique ou d'une boutique inconnue), `400 not_eligible` (article hors liste ou hors boutique), `409 currency_mismatch`, `403 forbidden` (appareil non rattaché au prénom de la ligne), `429`.

- [ ] **Step 1: tests d'intégration** : ligne depuis un article de la liste ; lien même boutique → produit créé, capture demandée (`requested_by` nul), statut `reading` ; lien d'une autre boutique connue → 400 `not_in_shop` ; lien d'un domaine inconnu → 400 et **aucune** ligne ajoutée dans `shops` ; saisie manuelle ; 21ᵉ ligne → 409 ; close → 403 ; date limite = aujourd'hui à 23 h 30 Paris → OK, lendemain 0 h 05 → 403 (horloge injectée) ; même prénom autre appareil → 409 `name_taken`, avec `claim` → OK ; modifier/retirer la ligne d'une autre → 403 ; `mine` présent seulement avec la bonne `x-device-key`, absent sans en-tête ; `mine.removedLines` contient la ligne retirée par la fondatrice ; 31ᵉ action en une heure → 429.
- [ ] **Step 2: lancer** → échecs ; **Step 3: implémenter** (verrou `lockFriendName` + `ensureFriendDevice` dans la même transaction que l'écriture de la ligne ; date limite comparée au jour Europe/Paris comme `giftReminderDue`) ; **Step 4: relancer** → PASS, et `apps/api/src/routes/captures.integration.test.ts` inchangé → PASS.
- [ ] **Step 5: commit** « feat(acheter-ensemble): API des amies ».

### Task 5: Le lien des amies (écrans)

**Files:**
- Create: `apps/web/src/app/l/[token]/group-order.tsx` (bandeau, récapitulatif, « Ajouter un autre article »), `apps/web/src/app/l/[token]/group-line-sheet.tsx` (fenêtre taille / quantité / prénom), `e2e/tests/group-order.spec.ts`
- Modify: `apps/web/src/app/l/[token]/opinions.tsx` (bloc et bouton « Je le prends aussi » par article éligible), `apps/web/src/lib/shared-list.ts` (`addGroupLine`, `patchGroupLine`, `deleteGroupLine`), `packages/i18n/messages/fr.json` (`SharedList.groupOrder.*`)

**Interfaces:**
- Consumes : routes de Task 4, `FriendNameStep`, `FriendDevice`, `formatAmount`.
- Produces : `addGroupLine(token, input): Promise<{ ok: true; lineId } | { ok: false; error: GroupLineError; shopName?: string }>` avec `GroupLineError = "locked" | "name_taken" | "too_many" | "not_in_shop" | "not_eligible" | "currency" | "forbidden" | "rate_limited" | "failed"` ; idem `patchGroupLine`, `deleteGroupLine`.

- [ ] **Step 1: e2e** (3 projets, axe en clair et sombre) : la fondatrice ouvre une commande par l'API (seuil 8000, port 690) ; Léa « Je le prends aussi » T38 × 1 → « Tu le prends aussi (T38 × 1) », bandeau « Plus que … pour la livraison offerte » ; Inès colle un lien d'une autre boutique → « Ce lien n'est pas chez {boutique}. », puis un lien de la même boutique → « Lecture de l'article… » puis le nom ; « Ta part : … » visible chez Léa seulement ; seuil atteint → « Livraison offerte ✓ » ; clôture par l'API → « Commande close, Camille va commander. » et plus de bouton ; commandée → « Tu dois … à Camille », puis « Payé ✓ » ; ligne retirée par la fondatrice → barrée « Retiré par Camille » chez Léa seulement.
- [ ] **Step 2: lancer** `pnpm e2e -- tests/group-order.spec.ts` → échecs ; **Step 3: implémenter** (relecture de la vue après chaque action et toutes les 10 s pendant la lecture d'un lien ; focus sur le bloc de l'article après ajout, comme 2b) ; **Step 4: relancer** → PASS, ainsi que `tests/gifts.spec.ts` et `tests/opinions.spec.ts`.
- [ ] **Step 5: commit** « feat(acheter-ensemble): le lien des amies ».

### Task 6: L'app de la fondatrice (écrans)

**Files:**
- Create: `apps/web/src/app/(app)/listes/[id]/commande-groupee/page.tsx`, `apps/web/src/components/group-order-view.tsx`, `apps/web/src/components/group-order-open-dialog.tsx`, `apps/web/src/components/group-order-ordered-dialog.tsx`, `apps/web/src/components/group-order-banner.tsx`, `e2e/tests/group-order-owner.spec.ts`
- Modify: `apps/web/src/components/share-panel.tsx` (« Ouvrir une commande groupée » / lien vers la commande en cours), `apps/web/src/components/wishlist-detail.tsx` (« Commandes groupées passées »), `apps/web/src/components/wardrobe-view.tsx` (bandeau dans « Mes envies »), `apps/web/src/lib/wardrobe-client.ts` (appels de Task 3), `fr.json` (`GroupOrder.*`)

**Interfaces:**
- Consumes : routes de Tasks 2 et 3, `confirmUnlessReserved(ids, "order")` (`apps/web/src/lib/gift-check.ts`), `pushUndo`, `Dialog`, `formatAmount`.

- [ ] **Step 1: e2e** : ouvrir depuis « Partage » en choisissant une option de livraison notée en admin (créée par l'API) ; bandeau dans « Mes envies » mène à la page ; cocher deux de ses articles avec taille ; une amie ajoute (API) → visible après relecture ; « Retirer » sur la ligne de l'amie puis « Annuler » ; « Clôturer », « Rouvrir », « Clôturer » ; « J'ai commandé » : corriger un prix et le port, valider → « Commandé le … », ses articles en « Commandé » ; avec un de ses articles réservé en cadeau, « Attends un peu 🎁 » → « Attendre » laisse la commande close ; « Payé » puis annulation ; « Annuler la commande groupée » (confirmation) sur une autre liste ; « Commandes groupées passées » liste la commande ; axe clair et sombre.
- [ ] **Step 2: lancer** → échecs ; **Step 3: implémenter** (relecture toutes les 10 s quand la page est visible ; montants via `computeGroupOrderTotals` côté serveur seulement — l'écran affiche `totals`) ; **Step 4: relancer** → PASS, puis la suite e2e complète.
- [ ] **Step 5: docs** : cocher ce plan, noter les décisions prises dans la spec (§ 9 « Décisions de la revue finale »).
- [ ] **Step 6: commit** « feat(acheter-ensemble): l'app de la fondatrice ».
