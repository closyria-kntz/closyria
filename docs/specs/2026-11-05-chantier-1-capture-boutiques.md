# Chantier 1 — Capture et boutiques : conception

> Validée section par section le 2026-11-05. Complète la conception V1
> (`docs/specs/2026-11-01-v1-conception.md`, §7.1, §8, §9, §10) et s'appuie sur la mesure
> `docs/specs/2026-11-05-mesure-blocages-boutiques.md`.

## 1. Objectif et périmètre

À la fin du chantier 1, on colle le lien d'un article (ou on le partage depuis une autre
app sur Android) et on obtient une **fiche produit partagée** : nom, marque, prix, photos,
tailles et disponibilité. Quand la lecture automatique est impossible, une saisie manuelle
courte prend le relais. La fondatrice gère les boutiques et suit la santé des captures
dans l'admin.

**Dans le périmètre**
- `packages/extract` : extraction pure (Shopify, JSON-LD, Open Graph).
- Lecture sûre des pages et des photos dans le worker, copie des photos sur OVH.
- Tables du catalogue : boutiques, domaines, produits, photos, tailles, historique, captures.
- Parcours utilisatrice : coller ou partager un lien, page de la fiche, saisie manuelle.
- Admin : boutiques, test de lien, santé, fusion, captures en échec, tableau de bord.
- Surveillance quotidienne réelle des boutiques publiées.
- Les 18 boutiques de départ.

**Hors périmètre (et où ça va)**
- Favoris, wishlists, dressing, photo personnelle de l'article : chantier 2.
- Revisites planifiées et alertes de prix ou de stock : chantier des alertes.
- Expéditeurs d'e-mails et règles de lecture apprises : chantier 3.
- Affiliation et sponsorisé (colonnes comprises) : chantier 5.
- Alerte e-mail quand une boutique tombe en panne : plus tard, si le besoin se confirme.
- Extension navigateur : après la V1.

## 2. Décisions

| # | Sujet | Décision |
|---|---|---|
| C1 | Boutiques de départ | La liste par défaut de la conception V1 : 6 boutiques Shopify + Zara, Mango, H&M, Sézane, Kiabi, Promod, Etam, Vinted, Zalando, Shein, La Redoute, Vestiaire Collective. |
| C2 | Enseignes bloquées | Ni navigateur automatisé ni identité de navigateur : ce serait contourner leurs protections. Elles passent en **capture manuelle** (option A). L'extension navigateur sera la vraie réponse après la V1. |
| C3 | Seconde main | Vinted et Vestiaire Collective : nom, prix et photos, sans tailles ni alertes de stock. |
| C4 | Réseau | Seul le worker sort sur Internet. L'API et le site web n'appellent jamais une boutique. |
| C5 | Suivi de la capture | La page interroge l'API toutes les 500 ms, 15 s au plus. Pas de flux en continu. |
| C6 | Rythme par boutique | Une requête toutes les 2 s au plus par domaine, en mémoire du worker (un seul worker). |
| C7 | Saisie manuelle | Elle remplit seulement les champs vides de la fiche partagée. Une capture automatique réussie l'écrase. L'admin peut corriger. Pas de photo. |
| C8 | `robots.txt` | Respecté, mis en cache 24 h par domaine. |
| C9 | Partage Android | La PWA se déclare cible de partage (`share_target`). |
| C10 | Réutilisation | Une fiche capturée il y a moins de 24 h est servie sans nouvelle visite. |

**Critère de réussite (remplace celui de la conception V1 pour ce chantier)** :
- 100 % des boutiques publiées en capture automatique donnent une fiche correcte
  (nom, prix, photos, tailles hors seconde main) en moins de 5 s ;
- partout ailleurs, la saisie manuelle prend moins de 30 s.

## 3. Architecture

| Unité | Rôle | Dépend de |
|---|---|---|
| `packages/extract` (nouveau) | Code pur : `(url, contenu reçu) → fiche validée`. Aucun réseau, aucune base. | `shared` |
| `packages/shared` | Schémas Zod : fiche extraite, boutique, statut de capture, codes d'erreur. | — |
| `packages/db` | Tables de la section 4 et leurs migrations. | — |
| `apps/worker/src/capture/` | `safeFetch`, tâche de capture, copie des photos, surveillance quotidienne, script des boutiques de départ. | `extract`, `db`, `storage` |
| `apps/api` | Routes de capture, de fiche et d'admin. | `db`, `shared` |
| `apps/web` | Champ « Coller un lien », cible de partage, page de la fiche, écrans d'admin. | `shared` |

**Files pg-boss**
- `capture-user` : captures des utilisatrices, prioritaires.
- `capture-admin` : tests de lien et ajouts de boutique.
- `capture-monitor` : surveillance quotidienne, planifiée chaque jour à 04:00 UTC.

La file `heartbeat` reste en place.

**Déroulement**
1. `POST /api/captures { url }`.
2. L'API nettoie l'adresse : hôte en minuscules, fragment `#…` retiré, paramètres
   de suivi retirés (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `_ga`, `ref`), les
   autres paramètres conservés (dont `variant`).
3. L'API trouve la boutique par le domaine (avec ou sans `www.`), sinon la crée en `pending`.
4. Elle trouve ou crée la fiche par adresse nettoyée.
5. Selon la boutique et la fiche :
   - boutique en `manual` : capture `skipped_manual`, pas de tâche ;
   - fiche capturée avec succès il y a moins de 24 h : pas de nouvelle tâche ;
   - sinon : capture `queued` et tâche dans `capture-user`.
6. L'API répond `{ productId, captureId, status }` (code 202).
7. Le worker :
   - lit la page (Shopify : `<adresse>.js` d'abord, puis la page HTML) ;
   - extrait la fiche ;
   - enregistre le nom, les prix et les tailles et passe la capture en `running` avec données prêtes ;
   - copie les photos ;
   - termine la capture en `succeeded` ou `failed`.
8. La page interroge `GET /api/captures/:id`, qui renvoie l'état et la fiche partielle ou complète.

## 4. Tables

Identifiants `uuid`, dates `timestamptz`, prix en centimes (`integer`) avec devise
ISO 4217 sur 3 lettres.

**`shops`**
- `id`, `name`, `slug` (unique).
- `status` : `pending` | `draft` | `published`.
- `platform` : `shopify` | `other` | `unknown` (défaut `unknown`, détecté à la capture).
- `capture_mode` : `auto` | `manual`.
- `listing_kind` : `catalog` | `secondhand`.
- `test_url` (nullable) : page de référence de la surveillance.
- `merged_into_id` (nullable, vers `shops`).
- `created_at`, `updated_at`.

**`shop_domains`**
- `domain` (unique, sans `www.`, en minuscules), `shop_id`.

**`products`**
- `id`, `shop_id`, `canonical_url` (unique), `external_id` (nullable).
- `name`, `brand`, `description` (texte brut, 5 000 caractères au plus).
- `currency`, `price_cents`, `compare_at_cents` (nullable).
- `source` : `captured` | `manual`.
- `capture_status` : `pending` | `ok` | `failed` | `manual`.
- `last_captured_at` (nullable), `created_at`, `updated_at`.

**`product_images`**
- `id`, `product_id`, `position`, `key` (`products/<productId>/<empreinte>.webp`),
  `width`, `height`, `source_hash` (empreinte de l'adresse d'origine).
- Unique sur (`product_id`, `source_hash`). 8 photos au plus par fiche.

**`product_sizes`**
- `product_id`, `label`, `position`, `available`, `price_cents` (nullable, si différent du prix de la fiche).
- Unique sur (`product_id`, `label`).

**`product_history`**
- `id`, `product_id`, `seen_at`, `price_cents`, `sizes` (`jsonb`, par exemple `{"M": true, "L": false}`).
- Une ligne à chaque capture réussie.

**`captures`**
- `id`, `product_id` (nullable pour un test admin sans fiche), `shop_id`.
- `trigger` : `user` | `admin_test` | `monitor`.
- `requested_by` (nullable, vers `user`).
- `status` : `queued` | `running` | `succeeded` | `failed` | `skipped_manual`.
- `data_ready` (booléen : nom, prix et tailles enregistrés).
- `method` (nullable) : `shopify` | `jsonld` | `opengraph`.
- `error_code` (nullable) : `blocked` | `timeout` | `too_large` | `forbidden_address` |
  `robots_disallowed` | `not_a_product` | `http_error` | `invalid_data`.
- `http_status`, `duration_ms` (nullables).
- `result` (`jsonb`, nullable) : la fiche extraite, uniquement pour `admin_test`.
- `created_at`, `finished_at`.
- Index sur (`shop_id`, `created_at`) et sur (`status`, `created_at`).

La santé des boutiques et le tableau de bord se calculent à partir de `captures`.

## 5. `packages/extract`

- Entrée : `{ url, contentType, body }`, plus `shopifyJson` facultatif.
- Sortie : `{ ok: true, method, product }` ou `{ ok: false, error: "not_a_product" | "invalid_data" }`.
- `product` : `name`, `brand?`, `description?`, `currency`, `priceCents`, `compareAtCents?`,
  `images` (adresses absolues, 8 au plus, sans doublon), `sizes` (`label`, `available`,
  `priceCents?`), `externalId?`, `siteName?`, `platform` (`shopify` | `other`).
- Ordre :
  1. Shopify `.js` si fourni ;
  2. JSON-LD `Product` ou `ProductGroup` (offres, variantes, `hasVariant`) ;
  3. Open Graph (`og:title`, `og:image`, `product:price:amount` / `og:price:amount`).
- La première méthode qui donne un nom et un prix valides gagne.
- Une page Shopify est reconnue à ses marqueurs dans le HTML : le worker tente alors
  `<adresse>.js` et refait l'extraction.
- Nettoyage :
  - HTML retiré des textes ;
  - espaces normalisés ;
  - longueurs plafonnées (nom 300, marque 120, libellé de taille 40) ;
  - prix texte (« 29,99 € ») convertis en centimes ;
  - adresses d'images rendues absolues, http(s) seulement.
- Tailles : pour Shopify, l'option dont le nom ressemble à « Taille », « Size » ou « Pointure »,
  sinon la première option. Aucune taille pour la seconde main.

## 6. Parcours utilisatrice

- **Entrées** : champ « Coller un lien » sur l'accueil (avec ou sans compte) ; partage
  Android vers la PWA installée, qui ouvre le même parcours.
- **Page `/produits/<id>`** :
  - un squelette animé apparaît en moins de 0,5 s, avec le nom de la boutique ;
  - le texte arrive dès `data_ready`, les photos ensuite.
- **Boutique en capture manuelle** : formulaire direct, avec le message
  « <Boutique> ne permet pas la lecture automatique. Complète la fiche en quelques secondes. »
- **Échec** : la fiche reste créée, un message selon la cause et le formulaire en dessous.
  - `not_a_product` : « Cette page ne ressemble pas à un article. »
  - `timeout` : « La boutique n'a pas répondu à temps. »
  - `blocked`, `robots_disallowed` : « La boutique refuse la lecture automatique. »
  - autres : « La lecture automatique n'a pas marché. »
- **Au-delà de 15 s** : le formulaire est proposé, la capture continue, et la fiche se
  remplit si elle réussit.
- **Formulaire manuel** :
  - nom, pré-rempli depuis l'adresse (dernier segment, tirets en espaces, majuscule initiale) ;
  - prix ;
  - tailles (texte libre séparé par des virgules) ;
  - pas de photo.
- **Contenu de la fiche** : photos, nom, marque, prix et prix barré, tailles et
  disponibilité, bouton « Voir chez <boutique> », date de mise à jour.
- **Limites** : 30 captures par heure pour une utilisatrice anonyme, 100 avec un compte
  (limiteur existant de l'API).

## 7. Admin

Toutes les actions sont réservées aux admins et inscrites au journal admin.

- **`/admin/boutiques`** :
  - filtres par statut, mode de capture et santé ;
  - les « à valider » en tête, triées par nombre de fiches créées sur 30 jours.
- **Fiche boutique** :
  - réglages (nom, slug, statut, mode, type, page de test, domaines) ;
  - santé : taux de réussite sur 7 jours, dernière surveillance, 10 dernières erreurs ;
  - « Tester un lien » : capture `admin_test` affichant la méthode, la durée et les données
    extraites, sans créer de fiche ;
  - « Fusionner dans… » : domaines et fiches rattachés à la boutique gardée, doublon
    masqué par `merged_into_id`, confirmation demandée.
- **Santé** d'une boutique publiée en mode automatique :
  - *en panne* si les 2 dernières surveillances ont échoué ;
  - sinon *dégradée* si le taux de réussite sur 7 jours est sous 80 % ;
  - sinon *OK*.
- **Ajouter une boutique** depuis une adresse : boutique créée en `draft` ; une capture de
  test pré-remplit le nom (`og:site_name`), la plateforme et la page de test.
- **`/admin/captures`** : les 100 derniers échecs, filtres par boutique et par cause, lien
  vers la fiche, bouton « Relancer ».
- **Tableau de bord** :
  - captures sur 24 h et 7 jours ;
  - taux de réussite et détail par méthode ;
  - durée médiane ;
  - boutiques à valider ;
  - boutiques en panne.
- **Boutiques de départ** : un script idempotent crée les 18 boutiques en `published`.
  - Les 8 accessibles sont en `auto` avec une page de test.
  - Les 10 bloquées sont en `manual`.
  - Vinted et Vestiaire Collective sont en `secondhand`.

## 8. Sécurité

**`safeFetch`**
- **Adresses** :
  - `http` ou `https`, ports 80 ou 443 ;
  - aucun identifiant dans l'adresse ;
  - 2 048 caractères au plus.
- **Résolution DNS** : toutes les adresses renvoyées sont vérifiées.
  - Refusées en IPv4 : `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`,
    `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`.
  - Refusées en IPv6 : `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `::ffff:0:0/96`
    (vérifiée comme IPv4), `64:ff9b::/96`.
- **Connexion** : elle se fait sur l'adresse vérifiée, sans nouvelle résolution.
- **Redirections** : traitées à la main, 5 au plus, chacune revérifiée.
- **Limites** : 5 Mo lus au plus (lecture interrompue au-delà), 15 s au total.
- **Contenu** : HTML ou JSON pour une page, `image/*` pour une photo.
- **Identité** : sans cookies, avec l'identifiant
  `Mozilla/5.0 (compatible; ClosyriaBot/1.0; +https://closyria.com)`.
- **`robots.txt`** respecté, avec un cache de 24 h.
- **Règle d'adresses** : c'est un paramètre de `safeFetch`, la règle stricte par défaut.
  - Seuls les tests passent une règle qui autorise `127.0.0.1`.
  - Aucune variable d'environnement ne la modifie.
  - Un test vérifie que le worker utilise la règle stricte.

**Photos**
- Décodées par sharp avec une limite en pixels, réencodées en WebP, sans métadonnées.

**Données extraites**
- Validées par Zod.
- Jamais affichées sans échappement.

**systemd (deuxième barrière)**
- Le service worker (dev puis prod) reçoit le bloc suivant :
  ```ini
  IPAddressDeny=0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 ::1/128 fc00::/7 fe80::/10
  IPAddressAllow=127.0.0.53/32
  ```
  (`127.0.0.53` : résolveur DNS du serveur ; PostgreSQL passe par une socket Unix.)
- C'est l'utilisatrice qui l'applique avec sudo.
- Un contrôle après déploiement vérifie qu'un appel du worker vers une adresse privée est refusé.

**API**
- Adresses validées par Zod.
- Limites de captures (section 6).
- Routes d'admin protégées par le rôle admin.

## 9. Tests

Aucun test n'accède à Internet.

| Niveau | Contenu |
|---|---|
| Unitaires `extract` (≥ 90 % de couverture) | Pages des 8 boutiques accessibles, enregistrées puis réduites à l'en-tête et aux données structurées. Cas limites : JSON-LD cassé, plusieurs produits, prix texte, devises, `ProductGroup`, page qui n'est pas un article, seconde main. |
| Unitaires `safeFetch` et nettoyage d'adresse | Tableau d'adresses IP acceptées et refusées, adresses mal formées, ports, paramètres de suivi. |
| Intégration worker | Fausse boutique locale sur port aléatoire (jamais 3000, 3001, 3100 ou 3101) : pages enregistrées, redirections, réponse lente, réponse trop grosse, redirection vers une adresse privée, `robots.txt`. Base de test et stockage en mémoire. |
| Intégration API | Création de capture, boutique inconnue, réutilisation sous 24 h, capture manuelle, limites, fusion, droits admin. |
| Bout en bout (Playwright, téléphone et ordinateur) | Lien vers fiche remplie ; boutique manuelle vers formulaire ; admin : ajout de boutique puis test de lien. |
| Surveillance réelle | Tâche quotidienne sur le serveur, hors CI. |

## 10. Ce que l'utilisatrice fait à la main

- Appliquer le bloc systemd du worker en dev puis en prod, puis recharger systemd.
- Lancer les déploiements prod (mot de passe sudo).
