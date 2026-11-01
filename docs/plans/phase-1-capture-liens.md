# Phase 1 — Capture de liens

> Statut : **remplacé** par la conception V1 (`docs/specs/2026-11-01-v1-conception.md`). Conservé pour l'historique.

## But

Coller le lien d'un article (boutique Shopify, Zara, Sézane…) et obtenir en quelques secondes une fiche avec
nom, marque, prix, photos et tailles disponibles, puis l'enregistrer.

## Étapes

Chaque étape est déployée sur la dev pour être testée. La prod suit en fin de phase.

### 1.1 — Socle

- [ ] Sessions anonymes (Better Auth, plugin anonyme) : on utilise Closyria sans compte.
- [ ] Premières tables : `products` (fiche par URL canonique), `product_snapshots` (prix et stock à chaque capture),
      `captures` (demandes et leur état), `saved_items` (article enregistré par un utilisateur).
- [ ] Composants d'interface (shadcn/ui) et mise en page de base.
- [ ] Admin : ajouter `BETTER_AUTH_SECRET` dans `/etc/closyria/dev.env` puis `prod.env`.

### 1.2 — Moteur d'extraction (`packages/extract`)

Fonctions pures `(url, html) → fiche validée par Zod`, essayées de la plus fiable à la moins fiable :

1. **Shopify** : `/products/<handle>.js` donne tailles, stock et prix exacts.
2. **Données structurées** schema.org (`Product`, `ProductGroup`) en JSON-LD.
3. **Balises de partage** Open Graph : au minimum titre, photo, souvent prix.

- [ ] Jeu de pages réelles enregistrées (fixtures) et tests Vitest, avec taux de réussite chiffré.
- [ ] Commande `pnpm extract <url>` pour tester un lien à la main.

### 1.3 — Récupération par le worker

- [ ] Tâche pg-boss `capture-url`, une par lien.
- [ ] Protections : http(s) seulement, aucune adresse interne ou privée (vérifiée après résolution DNS et à chaque
      redirection), 5 redirections max, 5 Mo max, 15 s max, rythme limité par boutique.
- [ ] API : `POST /api/captures` (lance, renvoie 202 + id) et `GET /api/captures/:id` (état et résultat).

### 1.4 — Interface

- [ ] Champ « Coller un lien », progression de la capture.
- [ ] Aperçu de la fiche, corrigeable avant d'enregistrer.
- [ ] Liste « Mes articles ».

### 1.5 — Bilan

- [ ] Taux de réussite mesuré sur ~50 liens réels.
- [ ] Décision : repli par IA (Claude via Bedrock) et/ou navigateur automatisé pour les sites difficiles.
- [ ] Mise en prod.

## Décisions

| # | Sujet | Recommandation | Statut |
|---|---|---|---|
| 1 | Comptes | Anonyme seulement en phase 1 ; compte (lien e-mail via Brevo) en phase 2 | à valider |
| 2 | Photos | Adresses seulement en phase 1 ; copie sur OVH S3 en phase 2 | à valider |
| 3 | Historique des prix | Enregistré dès la phase 1 (`product_snapshots`) | à valider |
| 4 | IA / navigateur automatisé | Rien avant les chiffres de l'étape 1.5 | à valider |
| 5 | Sites cibles | Liste de 15 à 20 boutiques fournie par l'utilisateur ; à défaut, les 6 boutiques Shopify du test de septembre + Zara, Mango, H&M, Sézane, Vinted | à fournir |

## Méthode

- Conception : skill `superpowers:brainstorming`, puis plan détaillé par étape avec `superpowers:writing-plans`.
- Code : `superpowers:test-driven-development` ; interface avec `frontend-design` et `design:ux-copy`.
- Avant chaque mise en prod : `code-review` et `engineering:deploy-checklist`.
