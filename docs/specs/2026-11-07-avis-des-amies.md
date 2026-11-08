# Envies chaleureuses — partie 2a : les avis des amies

Date : 2026-11-07 · Statut : **livrée sur la branche avis-des-amies, à déployer en dev (clé SHARE_LINK_KEY à ajouter)**.
Maquette validée : https://claude.ai/artifact/LiaSpnDBfXYatHNLQV7Zrc (3 écrans, clair et sombre).
Suite de `docs/specs/2026-11-07-envies-chaleureuses.md` (partie 1, en dev).

La partie 2 se fait en trois chantiers, dans cet ordre, chacun avec son propre cahier des charges :

1. **2a — les avis des amies** (ce document) ;
2. **2b — offrir** : les amies réservent ce qu'elles offrent, sans doublon, sans que la fondatrice voie qui offre quoi ;
3. **2c — acheter ensemble** : chaque amie coche ce qu'elle prendrait pour elle, pour une commande groupée.

2a est conçu pour que 2b et 2c s'y ajoutent sans le refaire : même façon de reconnaître une amie (§ 3.2), même lien.

## 1. Pourquoi

Retours de la fondatrice (2026-11-07) : le lien de partage est en lecture seule, « il n'y a pas d'interaction avec les
amies », et le budget n'y apparaît pas. Entre amies, on se demande « tu en penses quoi ? » avant de commander. Les avis
des amies doivent arriver là où elle choisit ses achats (sa liste, l'aperçu de « Préparer une commande »).

## 2. Décisions validées

| # | Sujet | Décision |
|---|---|---|
| A1 | Usage d'abord | Te conseiller (avis). Offrir (2b) puis acheter ensemble (2c) viendront après. |
| A2 | Reconnaître une amie | Son prénom, tapé une fois et retenu sur l'appareil (téléphone ou navigateur de l'ordinateur). Pas de compte, pas d'e-mail. |
| A3 | Même prénom | Sur une même liste, un même prénom = une seule personne : l'avis le plus récent remplace le précédent. Deux amies du même prénom se distinguent (« Léa M. »). |
| A4 | Contenu d'un avis | Un des 4 niveaux de la fondatrice (ses émojis et ses noms) + un petit mot facultatif de 200 caractères au plus. |
| A5 | Qui voit les avis | Toutes celles qui ont le lien voient tous les avis (prénom, niveau, petit mot, date). |
| A6 | Ce qui apparaît d'elle | Par défaut : son prénom, son niveau, « Prioritaire » et son « Pourquoi ? ». Le budget est caché par défaut. Un réglage par liste pour chacun. |
| A7 | Être prévenue | Dans l'app seulement : pastille « N nouveaux avis » sur la liste, avis marqués « nouveau » jusqu'à ce qu'elle les ait vus. Pas d'e-mail ni de notification pour l'instant. |
| A8 | Garder la main | L'amie modifie ou efface son avis depuis son appareil. La fondatrice efface n'importe quel avis (avec « Annuler »). Réglage « Autoriser les avis » par liste. « Changer le lien » coupe l'ancien. |
| A9 | Lien toujours visible | Le lien reste affiché dans la page de la liste (Copier, Envoyer…), rangé chiffré dans la base avec une clé gardée à part. |
| A10 | Garde-fous | Une trentaine d'avis par heure au plus, par appareil et par liste ; pas d'adresse web dans les petits mots. |

## 3. Ce que voit une amie (le lien `/l/<lien>`)

### 3.1 La page
- En haut : « La liste de {prénom} » (le prénom de la fondatrice, si « Montrer mon prénom » est actif), puis le nom de
  la liste et une phrase d'invitation : « Dis-lui ce que tu en penses 💬 ».
- Si « Montrer le budget » est actif : un encadré « Budget de la liste : 150 € » (le montant seulement, pas la période
  ni ce qui est déjà commandé).
- Pour chaque article, comme aujourd'hui : photo de la boutique, nom, marque, prix, « Voir chez {boutique} ».
- Si « Montrer mes avis » est actif : l'avis de la fondatrice, en rose léger (fond `color-selected-surface`, contour
  `color-selected-line`) : « {prénom} 🔥 En feu · Prioritaire » et son « Pourquoi ? » entre guillemets. Rien si elle
  n'a mis ni niveau, ni « Prioritaire », ni « Pourquoi ? ».
- Puis les avis des amies, du plus récent au plus ancien : initiale dans un rond, prénom, émoji et nom du niveau,
  petit mot, date relative (« il y a 2 h », « hier », puis la date).
- Un bouton « Donner mon avis » sous chaque article (« Modifier mon avis » si cet appareil en a déjà donné un). Absent
  si « Autoriser les avis » est coupé ; une phrase remplace alors le bouton en haut de page : « Les avis sont fermés
  sur cette liste. »
- Pas de compte, pas de cookie de suivi ; la page n'est toujours pas indexée par les moteurs de recherche.

### 3.2 Donner son avis
- Une fenêtre monte du bas (téléphone) ou s'ouvre au centre (ordinateur), avec le même comportement de fermeture que
  l'aperçu de la partie 1 (« Fermer », Échap, clic à côté, glisser vers le bas).
- Titre « Ton avis sur {article} ».
- **Prénom** : demandé seulement si cet appareil n'en a pas encore ; retenu ensuite sur l'appareil (stockage local du
  navigateur) avec une **clé d'appareil** tirée au hasard. Un lien « Ce n'est pas moi » sous le prénom permet d'en
  changer. 1 à 40 caractères, espaces en trop retirés.
- **Niveau** : les 4 niveaux de la fondatrice en gros boutons (ses émojis et ses noms) ; obligatoire.
- **Petit mot** : facultatif, 200 caractères au plus, compteur affiché à partir de 150. Une adresse web (« http », « www. »,
  un nom de domaine) est refusée avec le message « Les liens ne sont pas acceptés dans les avis. »
- Bouton « Envoyer mon avis » ; sous le bouton : « Visible par toutes celles qui ont le lien. »
- **Même prénom déjà utilisé sur la liste depuis un autre appareil** : l'app demande « Une Léa a déjà donné son avis
  sur cette liste. C'est toi ? ». « Oui, c'est moi » → cet appareil devient le sien aussi, ses avis précédents sont
  remplacés quand elle en donne un nouveau ; « Non » → le champ propose « Léa M. » (prénom + initiale à compléter).
- Après l'envoi : message « Avis envoyé · Annuler » ; l'avis apparaît aussitôt sous l'article.
- « Modifier mon avis » rouvre la fenêtre remplie, avec en plus « Effacer mon avis » (message « Avis effacé ·
  Annuler »).
- Limites : au plus **30 avis envoyés ou modifiés par heure** par appareil et par liste, et 120 par heure par adresse
  réseau et par liste ; au-delà : « Tu as donné beaucoup d'avis d'un coup. Réessaie dans un moment. »

## 4. Ce que voit la fondatrice (dans l'app)

### 4.1 « Listes »
- Une liste qui a des avis non vus affiche une pastille « 1 nouvel avis » / « N nouveaux avis » (couleur des pastilles
  « au-dessus » de la partie 1 : `color-danger-soft` / `color-danger-edge` / `color-danger`).

### 4.2 La page d'une liste
- **Bloc « Partage »** :
  - liste partagée : le lien en entier, « Copier le lien », « Envoyer… » (menu de partage du téléphone ; masqué si le
    navigateur ne le propose pas), « Changer le lien » (confirmation : « L'ancien lien ne marchera plus. ») et
    « Arrêter le partage » (inchangé) ;
  - liste partagée **avant cette version** (lien jamais gardé) : « Ce lien ne peut pas être réaffiché. » et un bouton
    « Créer un lien à garder » (même confirmation que « Changer le lien ») ; l'ancien lien marche tant qu'elle ne le
    change pas ;
  - quatre réglages (interrupteurs), enregistrés aussitôt : **Autoriser les avis** (actif), **Montrer mon prénom**
    (actif), **Montrer mes avis** (actif), **Montrer le budget** (coupé) ;
  - le texte d'explication du partage dit désormais ce que voient les amies selon ces réglages.
- **Sous chaque article** : les avis des amies (même présentation que sur le lien), les non vus marqués « nouveau »,
  un bouton « Effacer » par avis → « Avis de Léa effacé · Annuler ».
- **Vu** : ouvrir la page de la liste marque ses avis comme vus (la pastille disparaît de « Listes ») ; les marques
  « nouveau » restent affichées jusqu'à la visite suivante.

### 4.3 Ailleurs
- **Aperçu de « Préparer une commande »** et **fiche de l'article** : une section « Avis des amies » sous ses infos,
  avec les avis de toutes ses listes partagées où l'article figure (le nom de la liste en petit si plusieurs).
- Le rafraîchissement automatique de la partie 1 (toutes les 10 s) prend aussi les avis : un avis donné apparaît sans
  recharger.

## 5. Règles

- Un avis porte sur **un article d'une liste** ; retirer l'article de la liste ou supprimer la liste efface ses avis.
  Arrêter le partage **garde** les avis (décision de la fondatrice, 2026-11-08) : elle les voit toujours, peut les
  effacer et « Annuler » ; un nouveau partage les montre à nouveau, et l'amie garde la main sur le sien depuis le même
  appareil. « Changer le lien » les garde aussi.
- Un article déplacé à « Commandé » reste dans la liste et garde ses avis.
- Unicité : un avis par (liste, article, prénom), le prénom comparé sans majuscules ni espaces en trop.
- L'amie n'agit sur un avis (modifier, effacer) qu'avec la clé d'appareil qui l'a écrit, ou qui a été rattachée à
  son prénom par « Oui, c'est moi ».
- Les niveaux affichés sont ceux de la fondatrice **au moment où on regarde** (si elle renomme « Mims », les avis
  suivent).
- Le prénom de la fondatrice : le nom de son compte (« Mon compte »), seulement son premier mot.
- Les petits mots et prénoms sont affichés comme du texte, jamais interprétés (pas de lien cliquable, pas de mise en
  forme).
- Ce que le lien ne montre jamais (inchangé) : ses photos, notes, tailles, profils, et désormais ni la période du
  budget ni ce qui est déjà commandé.

## 6. Technique (pour l'équipe)

### 6.1 Données (une migration)
- `wishlists` : + `share_token_encrypted` (texte, nullable, le lien chiffré), + `allow_opinions` (vrai), +
  `show_owner_name` (vrai), + `show_owner_opinions` (vrai), + `show_budget` (faux), + `opinions_seen_at`
  (horodatage, nullable). `share_token_hash` reste la clé de recherche du lien.
- Nouvelle table `wishlist_opinions` : `id`, `wishlist_id` (→ wishlists, suppression en cascade), `item_id`
  (→ items, cascade), `author_name` (1 à 40), `author_name_key` (prénom normalisé), `level` (1 à 4), `note`
  (≤ 200, nullable), `created_at`, `updated_at` ; unique (`wishlist_id`, `item_id`, `author_name_key`).
- Nouvelle table `wishlist_opinion_devices` : `wishlist_id`, `author_name_key`, `device_key_hash` (SHA-256 de la clé
  d'appareil, jamais la clé), `created_at` ; clé primaire sur les trois premiers.
- Retirer un article d'une liste (`wishlist_items`) efface ses avis sur cette liste (déclencheur ou code applicatif,
  testé).

### 6.2 Lien chiffré
- Chiffrement AES-256-GCM avec une clé `SHARE_LINK_KEY` (32 octets en base64) dans `/etc/closyria/{dev,prod}.env`.
  **La fondatrice ajoute la clé elle-même** dans son terminal (commande fournie au déploiement) ; jamais dans le dépôt.
  L'API refuse de démarrer si la clé manque ou est invalide.
- `GET /api/me/wishlists/:id/share` → `{ url }` (déchiffré) ou `{ url: null, legacy: true }`.

### 6.3 API publique (sans compte, `/api/shared/:token`)
- `GET` : la vue publique étendue (`sharedWishlistViewSchema` + `ownerName`, `ownerOpinion` par article, `budget`
  (montant, devise), `allowOpinions`, `levels` (ses 4 niveaux), `opinions` par article, `itemId` public par article).
- `PUT /items/:itemId/opinion` `{ name, level, note, deviceKey }` → crée ou remplace ; `409 name_taken` si le prénom
  existe sur la liste sans être rattaché à cette clé (le client pose alors « C'est toi ? ») ; `PUT` avec
  `claim: true` rattache la clé au prénom.
- `DELETE /items/:itemId/opinion` `{ name, deviceKey }`.
- Limites (A10) avec le limiteur existant (`apps/api/src/rate-limit.ts`) ; `429` au-delà.
- Validation Zod partagée (`packages/shared`) ; refus des adresses web dans `note` côté API (pas seulement l'écran).

### 6.4 API de la fondatrice
- La vue d'une liste inclut ses avis et le nombre de non vus ; `POST /api/me/wishlists/:id/opinions/seen`.
- `DELETE /api/me/wishlists/:id/opinions/:opinionId` (+ restauration pour « Annuler »).
- `PATCH /api/me/wishlists/:id` accepte les quatre réglages.
- `POST /api/me/wishlists/:id/share` crée ou change le lien et le garde chiffré.
- L'empreinte de `/api/me/changes` inclut `wishlist_opinions`.

### 6.5 Écrans
- `app/l/[token]` devient en partie interactif (composant client pour les avis et la fenêtre).
- La fenêtre réutilise le comportement de `components/item-preview.tsx` (feuille / glisser / Échap), factorisé.
- Pastille « nouveaux avis », bloc « Partage » refait, section « Avis des amies » (liste, aperçu, fiche).

## 7. Tests attendus
- Intégration API : créer, modifier, effacer un avis ; prénom pris (`409`) puis « C'est toi ? » ; une autre clé ne peut
  ni modifier ni effacer ; avis refusés si « Autoriser les avis » est coupé ; adresse web refusée ; limites (`429`) ;
  retirer l'article efface ses avis ; lien chiffré relu ; ancien lien (empreinte seule) toujours valide ; aucune
  donnée privée dans la vue publique (photos privées, notes, tailles, période du budget).
- Parcours navigateur (téléphone, tablette, ordinateur, axe) : une amie donne son avis (prénom retenu au rechargement),
  la fondatrice voit la pastille puis l'avis « nouveau », l'efface et l'annule ; les réglages changent ce que voit le
  lien ; copier le lien ; clair et sombre.

## 8. Hors de ce chantier
- Offrir (2b) et acheter ensemble (2c).
- E-mail récapitulatif ou notification sur le téléphone (à proposer si elle rate des avis).
- Compte pour les amies.
- Répondre à un avis (fil de discussion).

## 9. Écarts et précisions (2026-11-08)
Décidés ou constatés pendant la réalisation ; ils complètent ou corrigent ce qui précède.
- ~~Arrêter le partage efface les avis~~ → remplacé le 2026-11-08 : arrêter le partage (DELETE) garde les avis et les appareils des amies ; l'aperçu d'un article et « Annuler » marchent aussi sur une liste qui n'est plus partagée.
- Deux codes d'erreur en plus : `forbidden` (effacer l'avis d'une autre personne) et `opinion_exists` (conflit à la restauration).
- Une amie peut reprendre un prénom avec « Oui, c'est moi » (risque accepté, décision A3) ; changer le lien coupe l'accès à toutes les autres.
- Textes choisis pendant le développement, absents de la spec, à relire par la fondatrice : « Tu en penses quoi ? », « Son avis » / « Liste partagée » quand son prénom est masqué, les noms des champs, les messages d'erreur.
- L'aperçu de commande ne se rafraîchit pas en direct tant qu'il est ouvert (la mise à jour automatique est en pause pendant les fenêtres) ; il relit les avis à chaque ouverture. Les pages, elles, se rafraîchissent en direct.
- La bande de photos de l'aperçu de commande est maintenant atteignable au clavier (défaut qui existait déjà).
- Le budget sur le lien public est toujours en euros (pas de colonne de devise).
- « Arrêter le partage » demande d'abord : « Arrêter le partage ? », « L'ancien lien ne marchera plus. Les avis des amies restent visibles pour toi. », boutons « Arrêter » / « Annuler » (validé par la fondatrice, texte revu le 2026-11-08). La page de la liste garde les avis.
- Décision A : les listes déjà partagées avant cette version ne se mettent pas à montrer ses avis (`show_owner_opinions` passe à faux pour elles dans la migration) ; les nouveaux partages gardent le défaut (vrai).
- Adresse web : `http(s)://` et `www.` sont reconnus quelle que soit la casse ; une adresse nue n'est reconnue qu'avec une fin en minuscules (« zara.com », « Shop.fr » oui ; « Trop belle.Ca te va », « Shop.FR » non), pour ne pas bloquer une phrase collée à une majuscule.
- Un prénom qui contient une adresse web est refusé aussi (erreur `web_address`, même message que pour le petit mot) ; de même à la restauration d'un avis effacé, qui exige en plus que la liste soit toujours partagée.
- Limites : en plus des 40 et 200 caractères (graphèmes) vus à l'écran, le prénom est plafonné à 320 points de code et le petit mot à 1 600, les mêmes que les contraintes de la base (qui comptent en points de code) ; un drapeau ou un émoji avec teinte passent partout.
- Une invitée (sans compte) n'a pas de prénom : le lien ne montre jamais « La liste de Anonymous ».
- `SHARE_LINK_KEY` est obligatoire dans tous les environnements : la fondatrice doit l'ajouter à `/etc/closyria/dev.env` (puis `prod.env`) avant de déployer cette branche, sinon l'API refuse de démarrer (voir `deploy/README.md`).
