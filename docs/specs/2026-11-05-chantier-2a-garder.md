# Chantier 2a — Garder : conception

> Validée section par section le 2026-11-05. Découle du découpage du chantier 2 de la conception V1
> (`docs/specs/2026-11-01-v1-conception.md`) en **2a « Garder »** puis **2b « Mon dressing complet »**.
> S'appuie sur le chantier 1 (`docs/specs/2026-11-05-chantier-1-capture-boutiques.md`), en dev.
> Les chantiers 1 et 2a partent en prod ensemble.

## 1. Objectif et périmètre

Une utilisatrice colle ou partage un lien, **garde l'article en un geste**, le retrouve, le fait avancer d'étape en
étape et son historique se construit dès le premier jour. Elle peut tenir plusieurs profils (elle, ses enfants…),
trier avec des étiquettes et partager une liste d'envies.

**Dans le périmètre**
- Articles de l'utilisatrice rattachés aux fiches communes, avec ses propres réglages.
- Étapes à la main, avec dates et montants ; historique des événements.
- Favori, listes d'envies partageables, étiquettes, profils et transferts entre profils.
- Photos privées sur l'article (sans détourage).
- Enrichissement des fiches communes (dates, références, données brutes de la boutique) et rangement dans nos listes
  de référence par des règles.
- Admin : écran « Fiches », correction d'une fiche, listes de référence.
- Proposition de créer un compte au bon moment ; fusion anonyme → compte.
- Raccourci iOS « Envoyer à Closyria ».
- « Annuler » après chaque action, corbeille de 30 jours, événements d'audience.

**Hors périmètre (et où ça va)**
- Détourage, couleur calculée sur la photo, classement par IA, article sans lien (né d'une photo), « déjà quelque
  chose de proche », mes tailles par profil, recherche, consultation sans réseau, séance de tri, correction des
  caractéristiques (type, couleur, matière, motif, saison) par l'utilisatrice pour elle seule : **2b**.
- Lecture des e-mails de commande, budget et vue « historique par année » : **chantier 3**.
- Alertes de prix et de stock : **chantier 4**.
- Limites de la formule gratuite (nombre d'articles, de profils) : **chantier 6**.
- Export des données : **chantier 6**. Lieux de rangement, « Mettre en vente sur Vinted », même article chez une autre
  boutique par code-barres : **après la V1**.

## 2. Décisions

| # | Sujet | Décision |
|---|---|---|
| G1 | Article et fiche | L'article **pointe vers la fiche commune** et ne porte que ce qui est à elle ; ses corrections priment pour elle seule. Prix et stock viennent toujours de la fiche. |
| G2 | Unicité | **Un seul article par utilisatrice et par fiche**, tous profils confondus. Recoller le même lien ouvre son article ; si elle a de nouveau gardé la même fiche entre-temps, restaurer l'ancien depuis la corbeille réunit les deux articles. |
| G3 | Photos | Les photos de la fiche commune viennent de la boutique. Les photos de l'utilisatrice sont **privées**, sur son article, et ne sont **jamais** versées dans la fiche commune. |
| G4 | Liste partagée | Montre nom de la liste, photos de la boutique, nom, prix, lien vers la boutique. Jamais les photos privées, notes, tailles, profils. |
| G5 | Étapes | `spotted` (repéré), `ordered` (commandé), `owned` (dans mon dressing), `for_sale` (à vendre), `sold` (vendu), `returned` (retourné), avancées **à la main**, date modifiable, montant facultatif. |
| G6 | Sans compte | Elle garde ses articles sans compte. Proposition de compte au **3ᵉ article gardé**, au **premier partage** et à la **première photo** : bandeau qui se ferme, jamais bloquant. |
| G7 | Profils | Un compte a un ou plusieurs profils (« Moi » créé d'office). Chaque article appartient à un profil ; transfert possible, tracé dans l'historique. |
| G8 | Public | Champ « public » sur la fiche (Femme, Homme, Enfant [Fille, Garçon, Bébé], Mixte), distinct de l'arbre des types. |
| G9 | Classement | Données brutes de la boutique gardées telles quelles ; rangement dans nos listes par **règles de mots-clés** ; correction admin jamais écrasée ; IA au 2b. |
| G10 | Vente | « À vendre » et « Vendu » sont des étapes, pas un profil ; une vue dédiée les rassemble. |
| G11 | Admin | L'admin voit les fiches et **combien** d'utilisatrices les ont gardées, jamais **lesquelles** (règle D13). |
| G12 | Photos de la boutique | Les photos de produits recopiées posent une question de droit d'auteur : inscrite à la revue juridique du chantier 6 ; l'admin ne recopie pas de photos à la main pour les enseignes bloquées. |

**Critère de réussite** : coller un lien puis garder l'article prend moins de 10 s ; une utilisatrice retrouve,
fait avancer, déplace et partage ses articles sans jamais perdre de donnée, y compris au passage anonyme → compte.

## 3. Données

Identifiants `uuid`, dates `timestamptz`, montants en centimes avec la devise de la fiche (`EUR` par défaut).
Les tables marquées (*) appartiennent à l'utilisatrice : supprimées avec son compte, déplacées ou fusionnées au
passage anonyme → compte.

**`profiles`** (*)
- `user_id`, `name` (1–40), `audience` (`women|men|child|mixed`), `child_detail` (`girl|boy|baby`, facultatif),
  `color` (token de la palette), `position`, `created_at`.
- Un profil « Moi » est créé à la création du compte.

**`items`** (*) — l'article
- `user_id`, `profile_id`, `product_id` (non nul dans le 2a ; nullable pour les articles nés d'une photo au 2b).
- `stage` : `spotted|ordered|owned|for_sale|sold|returned`.
- `favorite` (booléen).
- `size_label` (≤ 40), `size_note` (≤ 200), `notes` (≤ 2 000).
- `price_paid_cents`, `sale_price_cents`, `sale_channel` (≤ 60, ex. « Vinted »).
- Corrections : `name_override`, `brand_override`, `category_id`, `color_id`.
- `cover_media_id` (nul = première photo de la boutique).
- `deleted_at` (corbeille), `created_at`, `updated_at`.
- Unique (`user_id`, `product_id`) parmi les articles non supprimés.

**`item_events`** (*) — l'historique
- `item_id`, `type` (`stage|profile`), `stage` (pour `stage`), `from_profile_id` et `to_profile_id` (pour
  `profile`), `at` (date de l'événement, modifiable par l'utilisatrice), `amount_cents` (prix payé ou de vente),
  `created_at`.
- Une ligne à chaque changement d'étape et à chaque transfert. Base de l'historique par année (chantier 3).

**`item_media`** (*) — ses photos
- `item_id`, `media_id` (table `media` du chantier 0, déjà privée), `position`. 10 photos au plus par article.

**`wishlists`** (*) et **`wishlist_items`**
- `wishlists` : `user_id`, `name` (1–80), `share_token_hash` (nul = non partagée), `shared_at`, `position`,
  `created_at`.
- `wishlist_items` : `wishlist_id`, `item_id`, `position`, `added_at`. Un article peut être dans plusieurs listes.

**`tags`** (*) et **`item_tags`**
- `tags` : `user_id`, `name` (1–40, unique par compte), `color`.
- `item_tags` : `item_id`, `tag_id`.

**Fiche commune (`products`), ajouts**
- `published_at` (mise en ligne par la boutique), `gtin`, `sku`.
- `shop_data` (jsonb) : catégorie et fil d'Ariane de la boutique, mots-clés, couleurs, matière/composition,
  entretien, collection — tel que lu, longueurs plafonnées.
- `audience`, `child_detail`, `category_id`, `color_id`, `material_id`, `pattern_id`, `season`
  (`summer|winter|mid|all`), `classified_by` (`rule|admin`).

**Listes de référence**
- `categories` : `parent_id`, `slug`, `name`, `position`, `keywords` (texte[]). Arbre à plusieurs niveaux
  (ex. Vêtements > Robes > Robe longue).
- `colors` (≈ 16, `hex` pour l'affichage), `materials`, `patterns` : `slug`, `name`, `keywords`.
- Une première version est fournie au démarrage du worker (comme les boutiques de départ), sans jamais écraser les
  modifications de l'admin.

**Fusion anonyme → compte**
- Profils : « Moi » réuni avec « Moi », les autres ajoutés.
- Deux articles pour la même fiche : on garde l'étape la plus avancée ; favori, photos, listes, étiquettes et
  événements réunis.
- Étiquettes de même nom réunies ; listes ajoutées.

## 4. Parcours et écrans

**Navigation** : Envies · Commandé · Dressing · À vendre · Listes (sur téléphone, 4 onglets en bas, « À vendre » et
« Listes » dans « Plus »). En haut : sélecteur de profil et bouton « + Ajouter ».

**Adaptation aux écrans (exigence de la fondatrice, 2026-11-05)** : le site doit être aussi agréable sur ordinateur
que sur téléphone et tablette — jamais « tout petit » au milieu d'un grand écran.
- Téléphone (< 48 rem) : une colonne, barre d'onglets en bas, grille de 2 vignettes.
- Tablette (48–64 rem) : grille de 3 à 4 vignettes, onglets en haut ; la fiche passe en deux colonnes (photos à
  gauche, informations à droite) en paysage.
- Ordinateur (≥ 64 rem) : menu latéral, contenu jusqu'à ≈ 90 rem de large, grille de 5 à 6 vignettes, fiche en deux
  colonnes avec galerie de photos ; le texte courant reste limité à ≈ 70 caractères par ligne.
- Tailles de texte et espacements en tokens qui grandissent avec l'écran (typographie fluide), cibles tactiles de
  44 px au moins sur écran tactile.
- Les pages déjà livrées (accueil, fiche du chantier 1, admin) sont reprises selon ces règles.
- Tests de bout en bout sur trois formats : téléphone, tablette, ordinateur.

**Fiche → article** (page `/produits/<id>` du chantier 1)
- Avant de garder : **♡ Favori** · **Ajouter à une liste** · **Je l'ai commandé**. Le premier geste crée l'article
  à l'étape correspondante, dans le profil courant.
- Article gardé : la même adresse affiche **son article** — ses photos et celles de la boutique (choix de la
  vignette), frise des étapes, taille, montants, notes, listes, étiquettes, profil, et toujours « Voir chez … », prix
  et tailles à jour.
- Changer d'étape : petite fenêtre avec la date (aujourd'hui par défaut) et le montant (facultatif) ; « À vendre »
  demande aussi le prix demandé et l'endroit (facultatifs).

**Vues** (Envies = `spotted`, Commandé = `ordered`, Dressing = `owned`, À vendre = `for_sale` ; `sold` et
`returned` visibles par filtre)
- Grille de vignettes 3:4, photo entière sans recadrage.
- Filtres : favori, boutique, type, couleur, public, étiquette ; tri par date d'ajout ou prix.
- Sélection multiple : changer d'étape, ajouter à une liste, déplacer vers un profil, poser une étiquette,
  supprimer.

**Listes** : créer, renommer, réordonner, supprimer ; « Partager » donne un lien à copier ; « Arrêter le partage »
rend l'ancien lien inutilisable. Page publique `/listes/<jeton>` : contenu de G4 uniquement.

**Réglages** : Profils (créer, renommer, couleur, ordre, supprimer seulement s'il est vide), Étiquettes, Corbeille
(restaurer ou supprimer définitivement ; effacement automatique après 30 jours).

**Compte** : bandeau « Garde tes articles : continue avec Google, Apple ou ton e-mail » aux trois moments de G6.

**Annuler** : après chaque action (y compris en lot et la suppression), un message « … · Annuler » pendant 8 s.

**iPhone** : page d'aide « Ajouter Closyria au menu Partager » avec le Raccourci iOS (il ouvre
`/partager?url=…`).

## 5. Admin

- **Fiches** : liste de toutes les fiches, recherche par nom, filtres boutique / état de capture / rangement ; par
  fiche : photos de la boutique, prix, tailles, dates (mise en ligne, ajout, dernière lecture, modification),
  données brutes, rangement, **nombre** d'utilisatrices qui l'ont gardée.
- Actions : **Corriger la fiche** (nom, marque, prix, public, type, couleur, matière, motif, saison — passe
  `classified_by` à `admin`), **Relancer la lecture**.
- **Listes de référence** : arbre des types (ajout, renommage, déplacement, mots-clés), couleurs, matières, motifs.
- Toutes les actions sont journalisées (journal admin existant).

## 6. Architecture

Aucun nouveau service : web (Next), API (Hono), base PostgreSQL, stockage OVH, worker.

**API `/api/me/…`** (accès `user`, anonymes compris ; chaque requête ne voit que le compte connecté)
- `profiles` : lister, créer, modifier, réordonner, supprimer (refus s'il contient des articles).
- `items` :
  - `POST /items { productId, profileId?, action }` (`favorite` | `list` + `wishlistId` | `ordered`) : crée
    l'article, ou renvoie l'existant pour cette fiche.
  - `GET /items?stage=&profile=&favorite=&tag=&shop=&category=&color=&audience=&sort=&cursor=` (pagination par
    curseur, 48 par page).
  - `GET` / `PATCH /items/:id` ; `POST /items/:id/stage { stage, at, amountCents?, channel? }` ;
    `POST /items/:id/move { profileId }`.
  - `POST /items/bulk { ids (≤ 200), op }` ; `DELETE /items/:id` (corbeille) ; `POST /items/:id/restore`.
  - `POST` / `DELETE /items/:id/media` (envoi par la route photos du chantier 0).
- `tags`, `wishlists` (création, modification, ordre, contenu) ; `POST` / `DELETE /wishlists/:id/share`.
- `GET /api/shared/:token` (public) : la liste partagée, contenu de G4.
- Chaque réponse d'action renvoie de quoi « Annuler » (état précédent).

**Fiches et classement**
- `packages/extract` lit en plus : date de mise en ligne (Shopify `published_at`, JSON-LD `releaseDate` si
  présent), `gtin`/`gtin13`/`gtin8`, `sku`, catégorie et fil d'Ariane (`BreadcrumbList`), couleurs, matière.
- `packages/shared/classify` (code pur) : `classify(shopData, référentiels) → { audience, childDetail, categoryId,
  colorId, materialId, patternId, season }` par mots-clés (titre, catégorie de la boutique, fil d'Ariane, adresse).
- Le worker classe à chaque capture réussie, sauf si `classified_by = admin`.

**Tâches de fond** : effacement définitif de la corbeille (quotidien), en plus de l'existant.

**Événements d'audience** (mesure maison, chantier 0) : `item_saved`, `item_stage_changed`, `item_moved`,
`wishlist_shared`, `account_prompt_shown`, `account_created_from_prompt`.

## 7. Sécurité

- Cloisonnement : un test par route `me` vérifie qu'une autre utilisatrice reçoit 404 sur l'article, la liste, le
  profil, l'étiquette ou la photo d'autrui.
- Jeton de partage : 128 bits aléatoires, seule son empreinte (SHA-256) est stockée ; arrêter le partage efface
  l'empreinte.
- Page partagée : aucune donnée personnelle, en-tête `noindex`.
- Limites anti-abus : photos (limites du chantier 0), 300 articles créés par heure et par compte, 200 articles par
  action en lot.
- Validation Zod de chaque entrée ; longueurs plafonnées (section 3).

## 8. Tests

| Niveau | Contenu |
|---|---|
| Unitaires | `classify` (mots-clés, public, priorité titre / fil d'Ariane / adresse), transitions d'étape et événements écrits, fusion anonyme → compte, extraction des nouveaux champs sur les pages enregistrées. |
| Intégration API | Cloisonnement sur chaque route ; pas de doublon par fiche ; fusion (profils, articles, listes, photos, étiquettes) ; partage / arrêt / ancien lien ; transferts et leur trace ; corbeille ; annulation ; correction admin non écrasée par une capture. |
| Bout en bout (téléphone, tablette et ordinateur) | Coller un lien → ♡ → Envies ; avancer jusqu'à « Dans mon dressing » avec prix payé ; partager une liste et l'ouvrir dans une autre session ; anonyme → compte sans perte ; déplacer vers « Léa » ; axe sur toutes les nouvelles pages. |

## 9. Mise en prod

1. Livraison en dev, tests de la fondatrice.
2. **Sauvegardes automatiques de la prod** (petit chantier à part, juste avant) : copie chiffrée de la base chaque
   nuit sur OVH, gardée 30 jours, essai de restauration.
3. Mise en prod des chantiers 1 et 2a ensemble, en suivant `docs/plans/2026-11-05-mise-en-service-chantier-1.md`
   complétée pour le 2a.
