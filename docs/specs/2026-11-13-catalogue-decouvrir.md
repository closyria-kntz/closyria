# Catalogue « Découvrir » — cahier des charges

Suite de la refonte Boudoir (`docs/specs/2026-11-11-refonte-boudoir.md`, R4) et de la première version de Découvrir
(boutiques connues + boutique de la semaine, Task 6). Rejoint le chantier 5 « Annuaire » de la V1
(`docs/specs/2026-11-01-v1-conception.md`).

## 1. Pourquoi

Faire découvrir les vêtements de petites boutiques qu'on ne connaît pas : un catalogue de fiches qu'on parcourt, filtre
et garde d'un geste dans ses envies. Réussi quand une utilisatrice trouve, en filtrant par sa taille et ses goûts, des
articles de boutiques qu'elle ne connaissait pas, et les ajoute à ses envies sans quitter Closyria.

## 2. Décisions validées (2026-11-13)

| # | Sujet | Décision |
|---|---|---|
| D1 | Contenu | Articles collés par les utilisatrices (jamais qui) + catalogues complets des boutiques choisies en admin. |
| D2 | Import complet | Boutiques **Shopify** d'abord (lecture du catalogue public, chaque nuit) ; les autres boutiques n'entrent que par les liens collés, l'import complet viendra dans une étape suivante. |
| D3 | Fiche | « Je le veux » (cœur → envies), « Voir chez {boutique} », tailles en stock (la sienne mise en avant), prix et baisse, « Aimé par N personnes » (compteur anonyme), « Ajouter à une liste », « Partager » (fenêtre Partager), « Tu as déjà quelque chose de proche », « De la même boutique », « Dans le même style », « Signaler ». |
| D4 | Filtres | Catégorie, couleur, prix ; « Ma taille en stock » ; boutique et valeurs (made in France, seconde main, éco-responsable, retours gratuits) ; en baisse, nouveautés ; tri nouveautés / prix / popularité. |
| D5 | Classement | Catégorie et couleur déduites des informations de la boutique (type de produit, étiquettes, option « Couleur ») et de règles sur le nom (mots-clés des listes de référence) ; non reconnus → « Autres » ; corrections en admin ; IA plus tard. |
| D6 | Tailles | « Mes tailles » par profil (hauts, bas, chaussures), dans Compte ; base de « Ma taille en stock ». |
| D7 | Modération | Un article entre dans le catalogue seulement si sa boutique est **validée** (publiée) en admin ; nouvelle boutique → « À valider » ; « Signaler » → liste de modération en admin (masquer / garder). |

## 3. Ce que voit l'utilisatrice

### 3.1 Découvrir
- Recherche (nom d'article, boutique, mots comme « robe rouge »).
- Filtres D4 dans un panneau « Filtres et tri » (même modèle que Mes articles) ; pastilles des filtres actifs.
- « Une » : la boutique de la semaine (existant) ou, à défaut, « Nouveautés de la semaine ».
- Grille d'articles : photo 3:4, boutique, nom, étiquette de prix (prix, ancien prix, baisse), « Ta taille en stock »
  si vrai, cœur « Je le veux » (plein si déjà dans ses envies).
- Plus bas : la rangée des boutiques (existant).
- Écran vide (filtres trop stricts) : « Aucun article avec ces filtres. » + « Effacer les filtres ».
- Défilement par pages (chargement progressif), retour en arrière qui garde la position et les filtres.

### 3.2 Fiche d'un article du catalogue
- Photos, nom, boutique (lien vers ses autres articles), prix et baisse, tailles en stock (la sienne mise en avant ;
  épuisées barrées), « Aimé par N personnes » (affiché à partir de 3 ; jamais de prénom).
- Actions écrites : « Je le veux » (principal) · « Voir chez {boutique} » · « Ajouter à une liste » · « Partager ».
  Si l'article est déjà dans ses articles : « Dans tes envies » / son étape, et le lien vers sa fiche à elle.
- « Tu as déjà quelque chose de proche » : jusqu'à 3 pièces de son dressing (Reçu / Dans mon dressing) de même
  catégorie et couleur ; rien si aucune.
- « De la même boutique » (jusqu'à 8) et « Dans le même style » (même catégorie, couleur ou prix proche, jusqu'à 8).
- « Signaler » discret → motif (« Pas de la mode », « Contenu choquant », « Autre ») → « Merci, on regarde. »

### 3.3 Mes tailles (Compte)
- Par profil : hauts (XS…XXL et 32…48), bas (32…48 et 24…34), chaussures (35…42) ; chaque type facultatif.
- « Ma taille en stock » compare, sans tenir compte de la casse ni des espaces, la taille du profil à la liste des
  tailles disponibles de l'article selon sa catégorie (haut / bas / chaussures) ; une catégorie sans type (accessoires)
  ne filtre pas.

## 4. Admin

- **Boutiques** : statut « À valider » pour toute nouvelle boutique venue d'un lien (comme aujourd'hui « pending »),
  « Valider » (publiée) / « Refuser » ; valeurs à cocher (made in France, seconde main, éco-responsable, retours
  gratuits) ; pour Shopify, interrupteur « Importer tout le catalogue » et la date du dernier import, le nombre
  d'articles, la dernière erreur.
- **À classer** : liste des articles du catalogue classés « Autres » ou sans couleur ; choix de la catégorie et de la
  couleur en deux clics ; option « Appliquer aux articles du même type de cette boutique ».
- **Signalements** : liste (article, motif, nombre de signalements, date) ; « Masquer du catalogue » / « Garder » ;
  journal d'audit.

## 5. Règles

- **Confidentialité** : le catalogue ne révèle jamais qui a collé ou aime un article ; « Aimé par N » ne s'affiche
  qu'à partir de 3 ; rien des envies d'une autre personne n'est exposé.
- **Visibilité** d'un article : boutique publiée, article non masqué, encore en vente (retiré par la boutique →
  disparaît du catalogue), au moins une photo et un prix.
- **Envies existantes** : masquer ou retirer un article du catalogue ne touche jamais les envies de quiconque.
- **Politesse envers les boutiques** : import une fois par nuit par boutique, une requête à la fois par boutique avec
  une pause, respect de robots.txt, arrêt et erreur visible en admin si la boutique bloque (pas de contournement).
- **Prix et stock** : ceux du dernier import ou de la dernière capture ; date visible en admin.

## 6. Technique (pour l'équipe)

- Shopify : lecture paginée du catalogue public (`/products.json?limit=250&page=n`) par le worker (file pg-boss
  dédiée, une boutique à la fois), via les garde-fous existants (`safe-fetch`, `robots`, `address-policy`) ; mise à
  jour des `products` / `product_sizes` / `product_images` existants (même modèle que la capture d'un lien) ; articles
  disparus marqués « retirés ».
- Classement : fonction pure `classify({ productType, tags, options, name })` → `{ categoryId | null, colorId | null }`
  à partir des mots-clés de `categories` / `colors` ; correction admin enregistrée et prioritaire.
- Nouveaux champs : `shops.values` (liste), `shops.import_enabled`, `shops.last_import_at`, `shops.last_import_error` ;
  `products.hidden_at`, `products.removed_at` ; table `product_reports` ; « Mes tailles » sur `profiles`.
- API : `GET /api/catalog` (filtres, tri, curseur), `GET /api/catalog/{productId}` (fiche + similaires + proche),
  `POST /api/catalog/{productId}/report` ; admin : validation boutique, valeurs, import, À classer, signalements.
- « Je le veux » réutilise la création d'article existante (envie) ; « Aimé par N » = nombre d'articles « Envie » ou
  plus sur ce produit, toutes utilisatrices confondues (agrégat).
- Recherche : texte sur nom, boutique, catégorie, couleur (index adapté en base).

## 7. Tests attendus

- Unitaires : classement (types, étiquettes, noms français), correspondance des tailles, filtres.
- Intégration : import Shopify (pages, nouveaux, mis à jour, retirés, boutique qui bloque), visibilité (boutique non
  validée, masqué, retiré), signalement, compteur anonyme (jamais de prénom), « proche » limité à son dressing.
- E2E (3 appareils, axe clair/sombre) : parcourir, filtrer par taille, « Je le veux », fiche avec similaires,
  signaler, admin (valider une boutique, importer, classer, masquer).

## 8. Décisions de construction

Prises pendant le chantier, en plus des décisions validées du §2 :

- **Statut « Refusée »** ajouté aux boutiques : une boutique refusée par l'admin n'est pas publiée et ses articles restent hors du catalogue.
- **« Voir plus d'articles »** au lieu du défilement sans fin (choix de la fondatrice) : pages de 24 ; le retour arrière garde les pages chargées et la position.
- **« Proche » = ses propres pièces** : « Tu as déjà quelque chose de proche » ne regarde que son dressing, jamais celui d'une autre.
- **Titre de Découvrir** : « Les pépites des petites boutiques » (choix de la fondatrice).
- **Recherche plein texte maison**, accents repliés (chercher « ecru » trouve « écru »), sans moteur externe.
- **« Mes tailles »** : listes proposées en choix (hauts XS…XXL puis 32…48 de 2 en 2 ; bas 24…34 puis 36…48 de 2 en 2 ; chaussures 35…42) et « Une autre taille… » en texte libre (10 caractères au plus) ; vider un champ envoie `null`.
- Un article dont la page a disparu chez la boutique (erreur 404/410 à la capture) sort du catalogue ; il revient si la page répond de nouveau.

## 9. Hors de ce chantier

- Import complet des boutiques non Shopify.
- Classement par IA.
- Affiliation et mise en avant sponsorisée (chantier 5 suite).
- Alertes de prix et de taille (chantier 4).
