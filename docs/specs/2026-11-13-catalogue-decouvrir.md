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
- Par profil, **plusieurs tailles par type** (8 au plus, 10 caractères chacune), cochées en pastilles : hauts (XS…XXL
  et 32…48), bas (XS…XXL, 24…34, 36…48 et W24…W34), chaussures (35…42 avec les demi-pointures 35,5…41,5) ; « Une autre
  taille… » ajoute la sienne ; chaque type facultatif (tout décocher le vide).
- « Ma taille en stock » est **strict** : seulement les articles d'un type à tailles (haut / bas / chaussures) dont
  l'une de ses tailles de ce type est disponible, ou dont la seule taille disponible est « taille unique » (TU,
  T.U., Taille unique, One size, OS, Unique, U). Sacs, accessoires et articles non classés disparaissent, même en
  « taille unique » ; de même les articles sans tailles ou d'un type pour lequel elle n'a rien donné (sauf en
  « taille unique »). Sans aucune taille, le filtre reste grisé.
- Les étiquettes des boutiques sont lues intelligemment (casse et espaces ignorés) : « 38 FR », « EU 38 », « T38 »,
  « Taille 38 », « EU38 », « T.38 » = 38 ; « S/M » = S et M ; « M (38) » = M et 38 ; « 36-38 » = 36 et 38 ; 2XL = XXL ;
  1XL = XL ; 38,5 = 38.5 = 38 1/2 ; « W28 L32 », « W28L32 », « W 28 L 32 » = W28 (jamais 32 ni L). « Ta taille en stock » et la fiche (toutes ses tailles mises en avant) suivent la même
  règle.

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
- **« Mes tailles »** : plusieurs tailles par type en pastilles (voir §3.3) ; vider un type envoie une liste vide. Les tailles déjà enregistrées (une par type) sont devenues des listes d'une taille (migration 0025).
- **Avancement de l'import** (retours n°1) : la fiche boutique affiche « En attente », puis « Import en cours : page n, x articles lus » (relu toutes les 3 s), puis « Terminé à HH h MM : n articles (x nouveaux, y retirés) » (heure de Paris, chiffres du dernier import terminé) ou l'erreur ; la liste des boutiques marque « Import en cours ». Un import resté « en cours » plus de 6 h (durée de vie du travail) est considéré comme mort.
- **« Ma taille en stock » strict** (retours n°1) : tailles de son type, ou « taille unique » d'un haut, d'un bas ou de chaussures seulement — sacs, accessoires et non classés disparaissent (§3.3) ; lecture des étiquettes partagée entre l'API (SQL `catalog_size_tokens`) et l'interface.
- **Nouveautés** (retours n°1) : date de mise en ligne chez la boutique (Shopify `published_at`, sinon sa date de création chez Shopify), à défaut le jour où Closyria a vu l'article ; vaut pour le filtre, le tri et « Nouveautés de la semaine ».
- Un article dont la page a disparu chez la boutique (erreur 404/410 à la capture) sort du catalogue ; il revient si la page répond de nouveau.
- **Réimport plus rapide** (retours n°2) : au réimport, un article déjà connu, non retiré, au contenu inchangé (prix, stock par taille, photos…) et vérifié il y a moins de 7 jours n'est pas réécrit : seule sa date de vérification avance (« Mis à jour le »). Il compte quand même comme lu et présent (retraits, garde « plus de la moitié » et « Terminé » inchangés). Chaque article est donc réécrit au moins une fois par semaine (nouvelles règles de classement) ; un changement de type de boutique (seconde main) réécrit tout. L'empreinte du contenu est gardée par article (migration 0026) ; un article dont une photo n'a pas pu être copiée est réécrit au prochain import pour la retenter ; les corrections de l'admin restent intactes.
- **Barre d'avancement** (retours n°2) : pendant un import, une barre sous la ligne d'état. S'il existe un import précédent, elle se mesure à son total : « Import en cours : x / environ n articles », jamais pleine avant la fin ; sinon (premier import, « En attente ») elle est indéterminée et la ligne reste « page n, x articles lus ». Plus de barre une fois terminé ; les lecteurs d'écran n'annoncent toujours que le début et la fin.
- **Import coupé par un redémarrage** (correctif) : l'import en cours écrit un signe de vie (au départ, après chaque page et toutes les 30 s) ; sans signe de vie depuis 10 min, il n'est plus « en cours » (fiche, liste, plan de la nuit, « Importer maintenant »), au lieu de 6 h. À l'arrêt du worker (déploiement), l'import s'arrête proprement avant sa requête ou son article suivant, efface son « en cours » et note « interrompu » ; au démarrage suivant, le worker fait échouer dans pg-boss les travaux laissés actifs par le processus précédent et remet en file ces boutiques si leur import de nuit est activé ou si l'admin avait lancé cet import (« Importer maintenant ») ; elles reprennent seules (migration 0027).
- **Total dès le premier import** (retours n°3) : tant qu'une boutique n'a aucun import terminé, l'import lit d'abord son plan du site public (`sitemap.xml` puis chaque `sitemap_products_n.xml`, mêmes garde-fous, 8 Mo au plus par fichier, 1 s entre deux requêtes) et compte ses articles (chacun une fois, quelle que soit la langue) ; la barre se mesure au total du dernier import terminé, sinon à cette estimation (« x / environ n articles »). Après le premier import terminé, le plan du site n'est plus lu. Plan du site absent, interdit, trop gros ou illisible : pas d'estimation, l'import continue comme avant, sans erreur.
- **Stocks frais — relecture toutes les heures** (décision n°10) : chaque boutique Shopify publiée, import activé (jamais refusée ni fusionnée), est relue toutes les heures ; toutes les 3 h si son dernier import terminé comptait plus de 5 000 articles. Le planificateur passe toutes les 15 min (au lieu de la nuit à 03:00) et met une boutique en file quand son dernier import a démarré il y a plus que son intervalle (à 5 min près, le temps qu'il passe d'une file à l'autre) et qu'aucun import n'est en cours ; toujours une boutique à la fois. Le saut des articles inchangés et la réécriture complète au moins une fois par semaine restent.
- **Stocks frais — vérification à l'ouverture d'une fiche** (décision n°10) : quand une fiche de Découvrir s'ouvre et que l'article a été lu chez la boutique il y a plus de 15 min (ou jamais), l'API demande au worker de le relire par le chemin d'une capture (`refresh`, sans auteur, sans compter dans ses limites), sans faire attendre la fiche ; une seule à la fois par article, une au plus toutes les 15 min (y compris après un échec), jamais pour un article masqué, retiré, d'une boutique non publiée, fusionnée ou capturée à la main. La fiche se relit 3 s puis 8 s après son ouverture et met tailles et prix à jour sur place, sans attente visible ; une ligne discrète sous le prix dit « Vérification du stock… », puis « Vérifié à l'instant » ou « Stock vérifié il y a N min » (N h, ou le jour). Le prix n'entre dans l'historique que s'il change (migration 0028).
- **Stocks frais — garde-fous Shopify** (décision n°10, jamais de contournement) : une requête toutes les 2 s au plus vers l'ensemble des boutiques Shopify (pages du catalogue, plans du site, relectures de fiches, captures et surveillances), dans le worker, les fiches ouvertes passant avant les pages du catalogue ; s'y ajoutent les 2 s par boutique, robots.txt et l'identité honnête habituels (les photos, servies par le CDN de Shopify, et robots.txt n'y passent pas). Une réponse 429 ou 430 d'une boutique Shopify arrête son import (« bloqué », sans nouvel essai ni repli sur la page) et ralentit tous les imports Shopify : intervalles doublés pendant 6 h ; un deuxième 429/430 dans ces 6 h les ramène à une fois par nuit (03:00, heure de Paris) pendant 24 h. Le tableau de bord de l'admin et les fiches des boutiques Shopify affichent alors « Shopify nous demande de ralentir : imports espacés jusqu'au {date} ».

## 9. Hors de ce chantier

- Import complet des boutiques non Shopify.
- Classement par IA.
- Affiliation et mise en avant sponsorisée (chantier 5 suite).
- Alertes de prix et de taille (chantier 4).
