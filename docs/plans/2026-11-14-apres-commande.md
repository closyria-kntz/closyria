# Après la commande — plan de travail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une commande transférée par e-mail (ou un numéro de suivi collé) fait passer ses articles en « Commandé », suit le colis jusqu'à « Reçu » et rappelle la date limite de retour.

**Architecture:** Un webhook de réception d'e-mails (sous-domaine `commandes.closyria.com`) dépose l'e-mail dans la base ; le worker le lit (formats connus, puis IA en secours) et prépare une commande « à valider ». Une fois validée, ses colis sont suivis (La Poste en direct, agrégateur pour les autres) ; la livraison fait passer les articles en « Reçu » avec la date limite de retour. Les notifications réutilisent l'envoi du chantier 4.

**Tech Stack:** Hono + zod-openapi, Drizzle (migrations après 0035), pg-boss, `packages/extract`, nouveau `packages/ai` (API Claude, modèle `claude-haiku-5-5`), Next 16, Vitest, Playwright + axe.

**Spec:** `docs/specs/2026-11-14-apres-commande.md`

## Global Constraints

- Textes : « Mes commandes par e-mail », « Copier », « Changer d'adresse », « Crée ton compte pour suivre tes commandes », « Commande reçue de {boutique} », « C'est bon », « Corriger », « Ce n'est pas une commande », « On n'a pas su lire cet e-mail », « Ajouter un numéro de suivi », « En route », « Suivre chez le transporteur », « Ton colis {boutique} est en cours de livraison », « Ton colis {boutique} est arrivé », « Ton colis {boutique} est disponible en point relais », « Retour possible jusqu'au {date} », « Plus que 3 jours pour retourner {article} », « Tu as reçu ta commande {boutique} ? », « Oui », « Pas encore ».
- Adresse de commande : `{prénom-normalisé ou "commande"}-{4 caractères aléatoires}@commandes.closyria.com`, une active par compte, rotation possible ; comptes seulement (pas d'invitée).
- E-mail accepté seulement si l'expéditeur effectif est son adresse vérifiée ET les résultats d'authentification (SPF ou DKIM aligné) passent ; sinon ignoré sans réponse. Taille max 2 Mo ; pièces jointes ignorées ; liens jamais suivis.
- E-mail brut purgé après 30 jours ; avant l'IA, retirer adresses postales, téléphones, numéros de carte/IBAN, e-mails.
- IA seulement si les formats connus échouent ; plafond mensuel (admin, défaut 10 €) ; sortie validée par Zod ; jamais d'invention : champs inconnus = null.
- Suivi : La Poste (Colissimo, La Poste, Chronopost) en direct ; agrégateur pour les autres ; rythme 2 h (en cours de livraison / point relais), 6 h sinon ; arrêt à la livraison ou après 30 jours.
- Délai de retour : `shops.return_days` (défaut 14) à partir de la livraison ; rappel J-3 à 9 h Paris (calme de nuit du chantier 4 respecté).
- « Tu l'as reçu ? » 10 jours après l'expédition sans nouvelle (ou numéro non suivable).
- Clés facultatives (`INBOUND_EMAIL_SECRET`, `ANTHROPIC_API_KEY`, `LAPOSTE_OKAPI_KEY`, `TRACKING_AGGREGATOR_KEY`) : sans clé, la fonction correspondante est coupée proprement ; jamais dans le dépôt.
- Mêmes règles que les chantiers précédents (jetons Boudoir, clair/sombre, axe, 44 px, code anglais / interface française, Zod aux frontières, commits `closyria-kntz` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, ports interdits, pas de `pkill -f`/`git stash` nu, jamais deux suites e2e en même temps — vérifier `pgrep -f "[p]laywright test"`).

## Review Focus

1. E-mail transféré par quelqu'un d'autre que la titulaire (ou usurpant son adresse sans signature valide) : ignoré, rien créé — test Task 2.
2. Même e-mail transféré deux fois (ou confirmation puis expédition de la même commande) : une seule commande, le second complète le premier (numéro de suivi) — test Task 3.
3. Commande contenant un article déjà en « Envie » : relié, pas de doublon ; taille de la commande reportée — test Task 4.
4. Transporteur qui ne répond plus / numéro inconnu : pas d'erreur visible, « Suivre chez le transporteur » et question J+10 — test Task 5.
5. Suppression du compte : adresses, e-mails, commandes, colis supprimés — test Task 1 (registre des tables possédées).

---

### Task 1: Données et règles

**Files:** migration suivante, `packages/db/src/schema/orders.ts`, `packages/shared/src/orders.ts` (+ test).

**Produces:** tables `order_inboxes` (user_id, local_part unique, active, created_at), `inbound_emails` (id, user_id null, inbox_id, received_at, from_address, auth_ok bool, status ('ignored'|'queued'|'parsed'|'failed'), raw_object_key null, purge_after), `orders` (id, user_id, profile_id, shop_id null, external_ref null, ordered_at null, status ('draft'|'confirmed'|'dismissed'), source ('email'|'manual'|'tracking'), parse_method ('known'|'ai'|'manual'), inbound_email_id null), `order_lines` (order_id, item_id null, product_id null, name, size_label, color, quantity, price_cents, currency), `parcels` (id, order_id, carrier, tracking_number, status ('pending'|'in_transit'|'out_for_delivery'|'pickup_ready'|'delivered'|'exception'|'unknown'), last_event_at, estimated_at, delivered_at, next_check_at, check_until), `parcel_events` (parcel_id, at, status, label); `shops.return_days int default 14`, `shops.returns_url text null`; `items.return_deadline date null`. Toutes possédées (registre `registerOwnedTable`). Shared : `detectCarrier(trackingNumber): Carrier | null` (formats Colissimo, Lettre suivie, Chronopost, Mondial Relay, GLS, DPD, Colis Privé, UPS, DHL), `returnDeadline(deliveredAt, returnDays): string` (date Paris), `nextParcelCheck(status, now): Date`, schémas Zod des vues et entrées.

- [ ] Tests d'abord (formats de numéros réels anonymisés, date limite à cheval sur l'heure d'été, rythme), migration + test de migration, suppression de compte qui efface tout.
- [ ] Commit « feat(commandes): données et règles ».

### Task 2: Réception des e-mails

**Files:** `apps/api/src/routes/inbound-email.ts`, `apps/api/src/routes/me/order-inbox.ts` (+ tests), adaptateur fournisseur dans `apps/api/src/inbound/`.

**Produces:** `POST /api/inbound-email` (webhook du fournisseur de réception, signature HMAC `INBOUND_EMAIL_SECRET` vérifiée en temps constant, sinon 401 ; sans secret configuré : 404) → retrouve l'adresse destinataire, l'expéditeur effectif (en-têtes du transfert inclus), applique la règle des Global Constraints, stocke le brut (stockage privé existant) et met en file `order-email-parse`. `GET/POST /api/me/order-inbox` (voir / créer / changer d'adresse ; invitée → 403 `account_required`).

- [ ] Tests d'abord : signature, expéditeur autorisé / non autorisé / signature invalide (RF 1), taille, invitée, rotation (l'ancienne adresse ignorée), purge planifiée à 30 jours.
- [ ] Choisir le fournisseur de réception (réception entrante de Brevo, déjà utilisé, si elle fournit le message brut et les résultats d'authentification ; sinon documenter l'alternative) et le documenter dans `deploy/README.md` avec la commande DNS (un seul message).
- [ ] Commit « feat(commandes): réception des e-mails ».

### Task 3: Lecture des e-mails

**Files:** `packages/extract/src/order-email/*` (+ tests avec e-mails réels anonymisés en fixtures), `packages/ai/` (nouveau : client, rédaction des données personnelles, plafond), `apps/worker/src/orders/parse.ts`.

**Produces:** `parseOrderEmail(raw): ParsedOrder | null` (formats connus : confirmations et expéditions Shopify FR/EN, données structurées schema.org Order / ParcelDelivery), `aiParseOrderEmail(redactedText)` (sortie Zod, null si plafond atteint) ; le worker crée ou complète une commande `draft` (même boutique + même référence de commande → complète, RF 2) et notifie « Commande reçue de {boutique} ».

- [ ] Tests d'abord : chaque fixture, rédaction (aucune adresse/téléphone/carte dans le texte envoyé), plafond, doublon confirmation + expédition.
- [ ] Commit « feat(commandes): lecture des e-mails ».

### Task 4: Valider une commande et relier les articles

**Files:** `apps/api/src/routes/me/orders.ts` (+ tests).

**Produces:** `GET /api/me/orders` (brouillons et commandes), `PATCH /api/me/orders/{id}` (corriger), `POST /api/me/orders/{id}/confirm` → articles : reliés à l'envie du même produit (URL canonique / produit capturé ; sinon même boutique + nom proche) et passés « Commandé » avec la taille de la commande (RF 3), sinon créés « Commandé » ; `POST /api/me/orders/{id}/dismiss` ; `POST /api/me/orders` (saisie manuelle) ; `POST /api/me/items/{id}/tracking` (numéro collé → commande `tracking` + colis).

- [ ] Tests d'abord, commit « feat(commandes): valider et relier ».

### Task 5: Suivi des colis

**Files:** `apps/worker/src/orders/tracking/{laposte,aggregator,index}.ts` (+ tests avec réponses enregistrées), file `parcel-check`.

**Produces:** planificateur (toutes les 15 min, colis dont `next_check_at` est passé), connecteurs (La Poste pour ses transporteurs, agrégateur pour les autres, `unknown` sinon), événements, statuts ; livraison → articles « Reçu » (étape existante) + `return_deadline` + notification « Ton colis {boutique} est arrivé » ; point relais → notification ; « en cours de livraison » seulement si le réglage est activé (coupé d'office) ; échec répété → `unknown` sans erreur visible (RF 4). Notifications via l'envoi du chantier 4 (nouveaux types d'alerte, mêmes règles de calme et de plafond).

- [ ] Tests d'abord, commit « feat(commandes): suivi des colis ».

### Task 6: Retours, question J+10, liens Instagram

**Produces:** tâche quotidienne 9 h Paris : rappel « Plus que 3 jours pour retourner {article} » (une fois par article) ; « Tu as reçu ta commande {boutique} ? » à J+10 sans nouvelle (une fois), réponses « Oui » (→ « Reçu » + date limite) / « Pas encore » (redemande à J+20) ; capture d'un lien `instagram.com` : aucun appel réseau, article créé avec ce lien comme source et formulaire court.

- [ ] Tests d'abord, commit « feat(commandes): retours et Instagram ».

### Task 7: Écrans

**Files:** `reglages/commandes` (adresse + aide Gmail/Outlook/iCloud), page « Mes commandes », carte à valider sur l'Accueil, bloc « Commande / colis » sur la fiche d'un article, « Ajouter un numéro de suivi », formulaire Instagram, `fr.json`, e2e `e2e/tests/commandes.spec.ts`.

- [ ] e2e d'abord (3 appareils, axe clair/sombre) : adresse et copie, carte à valider (corriger, valider, ignorer), numéro collé, en route puis reçu avec date limite, rappel J-3 en « une », lien Instagram ; captures iPhone + ordinateur clair/sombre.
- [ ] Commit « feat(commandes): écrans ».

### Task 8: Admin et mise en service

**Produces:** boutique : délai de retour et lien de la page retours ; page « E-mails de commande » (reçus, non lus, mal lus, sans contenu personnel affiché par défaut, taux de lecture par boutique, coût IA du mois et plafond) ; tableau de bord (colis suivis, livrés, en échec) ; `deploy/README.md` : DNS du sous-domaine, clés La Poste / agrégateur / IA / secret de réception (une commande par environnement, un seul message) ; spec § « Décisions de construction », plan coché.

- [ ] Tests d'abord, suite e2e complète seule, commit « feat(commandes): admin et mise en service ».
