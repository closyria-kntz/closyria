# Catalogue conforme au droit — cahier des charges

Suite du catalogue « Découvrir » (`docs/specs/2026-11-13-catalogue-decouvrir.md`). Décisions de la fondatrice du
2026-11-14, **à faire valider par un avocat**.

## 1. Pourquoi (raisonnement juridique résumé)

- **Photos des boutiques** : une photo de produit est en principe une œuvre protégée par le droit d'auteur (le
  photographe, ou la boutique qui détient les droits). La reproduire publiquement sans autorisation est une
  contrefaçon possible, même avec un lien vers la boutique.
- **Catalogue complet** : l'ensemble des fiches d'une boutique est une base de données ; si la boutique a investi
  substantiellement pour la constituer, elle bénéficie du droit *sui generis* du producteur de base de données
  (art. L.341-1 et s. du Code de la propriété intellectuelle). En extraire et réutiliser publiquement tout ou une
  partie substantielle (ce que fait un import complet affiché à tous) est interdit sans accord.
- **Textes de description** : un texte original peut être protégé par le droit d'auteur ; le paraphraser reste une
  reprise. Les faits (catégorie, couleur, matière, tailles, prix, nom de l'article) ne sont pas protégés.
- **Usage privé** : une utilisatrice qui garde dans son dressing l'article qu'elle a elle-même collé, avec sa photo,
  pour elle et pour ses amies à qui elle partage sa liste, reste dans un usage privé.

**À faire valider par un avocat** : la qualification des catalogues en bases protégées, l'exception d'usage privé
pour les liens partagés aux amies, la phrase factuelle comme reprise de simples faits, et la forme de l'« accord de
référencement » (écrit, durée, retrait).

## 2. Décisions (2026-11-14)

| # | Sujet | Décision |
|---|---|---|
| C1 | Imports complets | Un article venu **seulement** d'un import complet (Shopify, WooCommerce), jamais collé par une utilisatrice, n'est visible dans Découvrir que des **admins** et des comptes **« Testeuse »**. Les imports continuent comme aujourd'hui. |
| C2 | Découvrir public | Pour toutes les autres : seulement les articles **collés** par au moins une utilisatrice, avec les règles de visibilité existantes par-dessus (boutique publiée, article ni masqué ni retiré, pas une grande enseigne, complet avec une photo). |
| C3 | Pas de photo de boutique en public | Cartes, fiche, « De la même boutique », « Dans le même style », une « Nouveautés de la semaine », vignettes des boutiques : une **illustration Closyria** (silhouette par type d'article, remplie de la couleur de l'article) au lieu de la photo, et un bouton clair « Voir les photos chez {boutique} ». |
| C4 | Pas de texte de boutique en public | La fiche affiche une **phrase factuelle** générée à partir des seuls faits (catégorie, couleur, matière, tailles en stock), par ex. « Robe longue rouge en lin, du 36 au 42. » ; jamais une paraphrase du texte de la boutique ; aucun fait connu → aucune phrase. Noms et prix restent (ce sont des faits). |
| C5 | Ses propres articles | Dressing, envies, listes, fiche de son article, liens partagés aux amies, alertes : **inchangés** (photos de la boutique gardées, photos envoyées par l'utilisatrice inchangées). |
| C6 | Boutiques partenaires | Case « Accord de référencement » et sa date dans la fiche admin de la boutique (journalisée) : tout le catalogue de la boutique (imports compris) est public dans Découvrir, **avec** ses photos et ses textes. |
| C7 | « Testeuse » | Case « Testeuse » dans la fiche admin d'une personne (`/admin/utilisatrices/{id}`), journalisée. |

## 3. Règles précises (construction)

### 3.1 « Collé par une utilisatrice » (`products.pasted_at`)

Seule une personne **ni admin ni testeuse** publie un produit. `products.pasted_at` (migration 0035) note la première
fois que :
- sa capture d'un lien réussit (`captures.trigger = 'user'`, statut « réussie », ou « saisie à la main » pour une
  boutique capturée à la main) ; une capture sans demandeuse (une amie sur un lien partagé, ou un compte supprimé
  depuis) compte aussi ; **ou**
- elle garde un article (`items`) qui pointe vers ce produit.

La date n'est jamais effacée. Elle est posée par deux déclencheurs en base (`products_mark_pasted_capture`,
`products_mark_pasted_item`), quel que soit le chemin (lien collé, « Je le veux », lien d'une amie, fusion d'une
invitée) ; la migration la remplit pour l'existant avec la même règle. Le statut admin ou testeuse est lu au moment
du geste : une testeuse qui cesse de l'être ne publie pas après coup ce qu'elle avait gardé.

- Le « Recapturer » de l'admin a son propre déclencheur de capture, `admin_recapture` : il écrit le produit comme une
  capture d'utilisatrice (historique, file prioritaire, échec par délai), mais ne le publie jamais.
- Une capture en file ou en échec ne publie rien ; sa réussite publie.
- Un produit d'abord importé puis collé par une utilisatrice devient public dès sa capture réussie.

**Qui est admin** : la même règle que l'espace admin — rôle admin **et** session ouverte avec une clé d'accès ; sinon
le compte voit Découvrir comme le public (sauf s'il est testeuse). Pour publier, le rôle seul compte (un admin ne
publie jamais, quelle que soit sa session).

### 3.2 Matrice de visibilité (sur les règles existantes de Découvrir)

| Article | Public | Testeuse | Admin |
|---|---|---|---|
| Importé seulement, boutique sans accord | invisible (grille, fiche 404, signalement 404, compteurs) | visible, photos et texte de la boutique | idem testeuse |
| Collé, boutique sans accord | visible, **illustration** + phrase factuelle | visible, photos et texte | idem testeuse |
| Boutique avec accord (importé ou collé) | visible, photos et texte | visible, photos et texte | idem |

- Les admins et testeuses voient tout comme aujourd'hui (photos et textes) : c'est un usage interne.
- Fiche : sans photos, la fiche montre l'illustration, la mention « Illustration Closyria : les photos de l'article
  sont chez {boutique}. » et le bouton « Voir les photos chez {boutique} » (l'ancien « Voir chez »).
- Description de la fiche : partenaire (ou admin / testeuse) → le texte de la boutique s'il existe, sinon la phrase
  factuelle ; sinon la phrase factuelle.

### 3.3 Surfaces publiques vérifiées

| Surface | API | Règle |
|---|---|---|
| Grille de Découvrir | `GET /api/catalog` | articles visibles (3.2) ; `imageUrl` nul hors partenaire, `illustration` toujours |
| Fiche | `GET /api/catalog/{id}` | 404 si invisible ; `images` vide et `description` factuelle hors partenaire |
| « De la même boutique », « Dans le même style » | dans la fiche | mêmes règles que la grille |
| Une « Nouveautés de la semaine » | `GET /api/catalog?isNew=true` | idem grille (illustration dans l'une) |
| Une « Boutique de la semaine », liste des boutiques (Découvrir et Accueil) | `GET /api/shops` | photo seulement pour une boutique partenaire, sinon l'initiale ; le nombre d'articles ne compte que ce qu'elle peut voir |
| Fiche produit hors de son dressing | `GET /api/products/{id}` | photos, texte et tableau des caractéristiques seulement pour son article (un article à elle ou un lien qu'elle a collé), une boutique partenaire, ou une admin / testeuse ; sinon `images` et `details` vides, `description` nulle |
| Signaler | `POST /api/catalog/{id}/report` | 404 si invisible pour elle |
| Accueil (baisses de prix, tailles revenues, alertes) | `GET /api/me/home`, alertes | ses propres articles : inchangé |
| Proche (« Tu as déjà quelque chose de proche ») | dans la fiche | ses propres pièces : inchangé |
| Listes, commandes groupées, liens aux amies | `/api/shared/…` | ses articles partagés : inchangé (C5) |
| Photos | `GET /api/catalog-images/{id}` | inchangé (adresse non devinable ; plus jamais donnée en public hors partenaire) |

### 3.4 Illustration

- Neuf silhouettes : haut, robe, bas / pantalon, jupe, manteau / veste, chaussures (basket vue de profil), sac,
  accessoire (chapeau à large bord, vu de face : écharpes, chapeaux, bijoux, ceintures), autre (classement par la catégorie, une
  sous-catégorie prend celle de son parent ; non classé → « autre »).
- Remplie de la couleur classée de l'article (`colors.hex`) ; sans couleur, une teinte neutre à elle (jeton
  `figure-neutral`, distincte du fond, en clair et en sombre) ; contour encre (lisible même pour un article blanc) sur
  le fond rose poudré des photos ; traits de détail clairs sur un fond foncé et foncés sur un fond clair.
- Dessins ajustés au-dessus du bas de la photo (y ≤ 116/160) : « Je le veux » ne les couvre jamais.
- Décorative (`aria-hidden`) : le nom de l'article est le libellé.

### 3.5 Phrase factuelle

Fonction pure `factualDescription` (`packages/shared`) : nom de catégorie au singulier (« Robe longue », « Chemise ou
blouse », « Sandales »…, sinon celui de sa catégorie parente, sinon « Article »), couleur accordée (« noire »,
« blanches », « marron » invariable), « en {matière} », puis les tailles en stock : « taille 38 », « taille unique » ;
une fourchette (« du S au L », « du 36 au 42 ») seulement quand elles se suivent (lettres une à une, nombres à 2 au
plus d'écart, aucune taille épuisée entre les deux) ; sinon elles-mêmes jusqu'à 4 (« tailles 36, 40 et 42 »,
« tailles S et 38 ») ; au-delà, leur nombre (« 5 tailles »).

### 3.6 Admin

- **Testeuse** : `user.is_tester` (migration 0035), case sur `/admin/utilisatrices/{id}`, `PATCH
  /api/admin/users/{id}` journalisé (`user.tester`, avec la valeur).
- **Accord de référencement** : `shops.listing_agreement_at` (migration 0035), case et date (du 1er janvier 2000 à
  demain, 00:00 UTC) dans les réglages de la boutique, journalisée comme les autres réglages (`shop.update`, avec
  la date donnée ou nulle quand elle est retirée).
- « Articles dans Découvrir » de la fiche boutique admin compte toujours tout ce que voit l'admin.

## 4. Tests

- Unitaires : phrase factuelle (accords, tailles, faits vides), silhouettes par catégorie.
- Intégration (`apps/api/src/routes/catalogue-legal.integration.test.ts`) : matrice public / testeuse / admin ×
  importé seulement / collé / partenaire ; importé puis collé → public ; aucune adresse de photo ni texte de boutique
  non partenaire dans une réponse publique (grille, fiche, boutiques) ; fiche produit ; bascules admin journalisées.
- E2E (3 appareils, axe clair et sombre) : carte publique illustrée avec « Voir les photos chez … », la testeuse voit
  les articles importés, l'admin coche « Testeuse » et « Accord » ; captures des cartes illustrées (toutes les
  catégories), iPhone et ordinateur, clair et sombre.

## 5. Points ouverts

- Validation par un avocat (§1).
- Un article gardé depuis le lien d'une amie (« Je le prends aussi ») compte comme collé.
- Retour arrière de la migration 0035 : supprimer les déclencheurs `products_mark_pasted_capture` /
  `products_mark_pasted_item`, les fonctions `products_mark_pasted_by_capture`, `products_mark_pasted_by_item`,
  `catalog_publisher`, l'index `products_pasted_idx`, les colonnes `products.pasted_at`,
  `shops.listing_agreement_at`, `user.is_tester` ; ramener `UPDATE captures SET trigger = 'user' WHERE trigger =
  'admin_recapture'` avant de remettre l'ancienne contrainte `captures_trigger_check`.
