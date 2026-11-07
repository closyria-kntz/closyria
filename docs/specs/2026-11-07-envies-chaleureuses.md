# Envies chaleureuses — partie 1 : mes envies

Date : 2026-11-07 · Statut : **livrée en dev (branche envies-chaleureuses), à tester par la fondatrice**.
Maquette validée (palette C) : https://claude.ai/artifact/Q6tEj3ZNKbrXbunv6B1LTQ (rangée « Palette C », 5 écrans).
Partie 2 (avis et choix des amies sur le lien de partage) : cahier des charges séparé, après celui-ci.

## 1. Pourquoi

Retours de la fondatrice (2026-11-07) :
- « Favori » est trop léger. Entre amies on dit « Mims » (mignon) et on met 🔥 quand on aime beaucoup ; ces nuances
  servent à choisir au moment de commander. Certains achats sont prioritaires.
- On ne sait pas comment mettre un lien dans les Envies sans passer par « Favori ».
- Le ♡ doit se toucher directement sur les vignettes, sans ouvrir la fiche.
- Les cases à cocher des vignettes sont moches : un menu « … » à la place.
- Elle veut cocher des envies et voir le total, avec un budget, pour préparer une commande.
- L'app doit être plus chaleureuse et conviviale.

## 2. Décisions validées

| # | Sujet | Décision |
|---|---|---|
| E1 | Niveaux d'amour | 4 niveaux : 😕 Bof · 🤍 J'aime · 🥰 Mims · 🔥 En feu. Ils remplacent « Favori ». |
| E2 | Personnaliser | Chaque utilisatrice change l'émoji et le nom de chacun des 4 niveaux (Réglages). Le nombre reste 4. |
| E3 | Prioritaire | Une étiquette à part, sur n'importe quel niveau. |
| E4 | Avis | Un « Pourquoi ? » en une phrase à côté du niveau (pour elle ; les avis des amies sont la partie 2). |
| E5 | Préparer une commande | Une sélection **enregistrée**, total et écart au budget affichés en direct. |
| E5b | Budget | Par **profil** et par **liste**, sur une période : semaine, mois, dates au choix ou sans période ; ce qui est déjà commandé dans la période est déduit (§ 3.7). |
| E6 | Vignettes | Niveau touchable sur la vignette, menu « … » ; plus de case à cocher hors du mode « Sélectionner ». |
| E7 | Palette | C · chocolat et rose poudré, caractères Fraunces (titres) et DM Sans (texte), coins plus ronds. |
| E8 | Cadre fixe | Gardé (déjà en dev). |

## 3. Ce que voit l'utilisatrice

### 3.1 Mettre un lien dans ses envies (fiche d'un article pas encore gardé)
- Bloc « Tu l'aimes comment ? » : les 4 niveaux en gros boutons ; **J'aime** est présélectionné.
- Bouton « Prioritaire » (bascule) et champ « Pourquoi ? (facultatif) », 200 caractères au plus.
- Bouton principal **« Ajouter à mes envies »** → l'article est gardé à l'étape « Repéré » avec ce niveau, cette
  priorité et cet avis ; message « Ajouté à tes envies · Annuler ».
- Boutons secondaires inchangés dans leur effet : « Ajouter à une liste », « Déjà commandé » (ex-« Commandé »).
- Le bouton « Favori » disparaît.

### 3.2 Les vignettes (Envies, Commandé, Dressing, À vendre, listes)
- En haut à gauche : **pastille du niveau** (émoji + nom). Un toucher passe au niveau suivant
  (Bof → J'aime → Mims → En feu → Bof), message « Niveau : Mims · Annuler ». Sans niveau : pastille « + » qui
  pose J'aime.
- En haut à droite : bouton **« … »** (menu, § 3.3).
- En bas de la photo : étiquette **« Prioritaire »** si posée.
- Sous le prix : l'avis entre guillemets, sur une ligne (coupé au besoin).
- Plus de case à cocher.

### 3.3 Le menu « … » d'une vignette
Panneau qui monte du bas (téléphone) ou petit menu (ordinateur) :
- les 4 niveaux (le courant est marqué) ;
- « Prioritaire » / « Retirer de Prioritaire » ;
- « Mon avis » (modifier le « Pourquoi ? ») ;
- changer d'étape (« Je l'ai commandé », « Dans mon dressing »…, selon l'étape) ;
- « Ajouter à une liste », « Déplacer vers un profil », « Étiquettes » ;
- « Retirer de mes envies » / « Supprimer » (corbeille, « Annuler » pendant 8 s).
Chaque action garde son message « … · Annuler ».

### 3.4 Plusieurs articles à la fois
Bouton **« Sélectionner »** en haut des vues : une coche ronde discrète apparaît sur chaque vignette ; on touche les
vignettes voulues, la barre d'actions en lot existante apparaît (niveau, prioritaire, étape, liste, profil,
étiquette, supprimer). « Terminé » quitte le mode.

### 3.5 Filtres et tri des vues
- Le filtre « Favori » est remplacé par les filtres **par niveau** (puces : 🔥 En feu, 🥰 Mims, 🤍 J'aime, 😕 Bof)
  et **« Prioritaires »**.
- Nouveau tri **« Ce que j'aime le plus »** : niveau décroissant, prioritaires d'abord à niveau égal, puis date.

### 3.6 Préparer une commande (Envies)
- Bouton « Préparer une commande » en haut d'Envies → page dédiée (`/envies/commande`).
- En haut, le **budget du profil** (§ 3.7) : « Budget de la semaine : 150 € · Déjà commandé : 89 € ».
- La liste des envies du profil courant, triée « Ce que j'aime le plus » ; chaque ligne se coche d'un toucher.
- La sélection est **enregistrée** : on la retrouve en revenant, sur tous ses appareils.
- Bandeau du bas, en direct : « 3 articles · 187 € » et, avec un budget, ce qui resterait après la sélection :
  « Il te resterait 13 € » ou « 37 € au-dessus » (en rose). Prix pris : le prix actuel de la boutique ; un article sans prix compte pour 0 et
  porte « prix inconnu ».
- **« J'ai commandé »** : les articles cochés passent à « Commandé » (date du jour), la sélection se vide,
  message « 3 articles passés en Commandé · Annuler ». Ils comptent aussitôt dans « Déjà commandé ».
- Depuis une **liste**, le même bouton « Préparer une commande » ne montre que les articles de la liste et le budget
  de la liste.
- Un article qui quitte les Envies (autre étape, supprimé) sort de la sélection.

### 3.7 Les budgets
- **Où** : un budget par **profil** (Moi, Léa…) et, en plus, un budget par **liste** (« Noël : 300 € »). Les deux sont
  facultatifs et indépendants : un article de la liste « Noël » du profil Moi compte dans les deux.
- **Période** :
  - **par semaine** (du lundi au dimanche) ou **par mois** (du 1er au dernier jour) : remise à zéro automatique au
    début de chaque période ;
  - **dates au choix** (« du 1er au 15 décembre ») : rien n'est compté hors de ces dates ; à la fin, le budget reste
    affiché comme terminé jusqu'à ce qu'elle en crée un autre ;
  - **sans période** : une enveloppe qui compte tout depuis sa création, remise à zéro par « Recommencer à zéro ».
- **Ce qui est déduit (« Déjà commandé »)** : chaque article du profil (ou de la liste) passé à « Commandé » pendant
  la période, quelle que soit la façon (« J'ai commandé », fiche, lot). Montant : le prix payé s'il est noté, sinon le
  prix de la boutique au moment du passage à « Commandé » (enregistré à ce moment-là). Un article **renvoyé**
  pendant la période est recrédité, de même qu'un article « Commandé » remis dans « Repéré » (« Remettre dans mes
  envies », seul ou en lot) ; un passage à « Commandé » annulé (« Annuler ») ne compte pas.
- **Pas de découpage par jour** : le budget d'une période est une enveloppe dépensée quand on veut.
- **Historique** : pour les budgets par semaine et par mois, les périodes passées restent visibles
  (« octobre : 230 € sur 200 € »).
- **Où le régler** : un bouton « Budget » sur la page « Préparer une commande » (budget du profil) et dans le menu
  d'une liste (budget de la liste) ; montant, période, dates.
- Le budget d'une liste est **privé** : les amies qui ouvrent le lien de partage ne le voient pas (à revoir en
  partie 2 si besoin).

### 3.8 Réglages → Mes niveaux
- 4 lignes : émoji (choix dans une grille d'émojis courants, ou saisie libre d'un seul émoji) et nom (20 caractères
  au plus).
- « Enregistrer » ; « Revenir aux niveaux de départ ».
- Ses noms et émojis s'affichent partout dans l'app (et, en partie 2, sur ses listes partagées).

### 3.9 Nouvelle palette et ton
- Palette C, en clair et en sombre (§ 5.4), appliquée à toute l'app (l'admin suit les mêmes jetons).
- Caractères : Fraunces pour les titres, DM Sans pour le texte, hébergés avec l'app (pas d'appel à Google).
- Coins plus ronds (cartes 26 px, boutons en pilule).
- Textes plus chaleureux : « Mes envies », « Tu l'aimes comment ? », « Ajouter à mes envies ».

## 4. Ce qui change pour les données existantes

- Les articles « Favori » prennent le niveau **🤍 J'aime** ; les autres n'ont pas de niveau.
- Décocher un niveau ou en changer ne supprime jamais l'article (fin de la règle « envie nue retirée quand on
  enlève le ♡ », source de la surprise avec la cape Margot). On retire un article par « … » → « Retirer de mes envies ».
- Le champ « Notes » existant reste ; l'avis (« Pourquoi ? ») est un champ à part, court, affiché sur la vignette.

## 5. Technique

### 5.1 Base de données (une migration)
- `items.love_level` : entier 1 à 4 ou `null` (1 Bof, 2 J'aime, 3 Mims, 4 En feu), contrôle `between 1 and 4`.
- `items.priority` : booléen, `false` par défaut.
- `items.why` : texte, 200 caractères au plus, `null` par défaut.
- `items.in_order_draft` : booléen, `false` par défaut (la sélection « Préparer une commande »), index partiel
  `(user_id, profile_id) where in_order_draft`.
- Budgets : table `budgets` (`id`, `user_id`, `profile_id` **ou** `wishlist_id` — exactement l'un des deux,
  `amount_cents` > 0, `period` `week`|`month`|`custom`|`none`, `starts_on`/`ends_on` pour `custom`, `reset_at`
  pour `none`, `created_at`) ; au plus un budget par profil et un par liste (index uniques partiels).
- Montant au passage à « Commandé » : `item_events.spent_cents` (colonne dédiée ; `amount_cents` garde le montant saisi) rempli avec
  le prix payé, sinon le prix courant de la boutique ; « Déjà commandé » = somme des événements `ordered` de la
  période, moins les événements `returned` de la période, sans les événements annulés.
- Périodes : calculées en heure de Paris (lundi 00:00, le 1er 00:00).
- Niveaux personnalisés : table `love_levels` (`user_id`, `level` 1–4, `emoji`, `label`), clé (`user_id`, `level`) ;
  absente = niveaux de départ.
- Reprise : `love_level = 2 where favorite`, puis suppression de la colonne `favorite` dans la même migration
  (le filtre et l'API « favori » disparaissent).
- Fusion anonyme → compte : niveau le plus haut, prioritaire si l'un l'est, avis de la cible sinon de la source,
  sélection si l'une l'est.

### 5.2 API
- `ItemView` : `loveLevel`, `priority`, `why`, `inOrderDraft` (à la place de `favorite`).
- Garder un article : `action` `wish` (niveau, priorité, avis) remplace `favorite` ; `list` et `ordered` gardent
  leur effet.
- `PATCH /me/items/{id}` accepte `loveLevel`, `priority`, `why`, `inOrderDraft`.
- Lots : `setFields` porte le niveau, le prioritaire et la sélection, avec annulation comme les autres.
- Vues : filtres `loveLevel` (plusieurs valeurs) et `priority`, tri `love`.
- `GET/PUT /me/love-levels` (4 niveaux).
- `GET/PUT/DELETE /me/profiles/{id}/budget` et `/me/wishlists/{id}/budget` : réglage, et lecture avec la période en
  cours (`spentCents`, `remainingCents`, dates) ; `GET …/budget/history` (périodes passées) ;
  `POST …/budget/reset` (sans période).
- `POST /me/order-draft/ordered` : passe la sélection du profil à « Commandé » et la vide, en une transaction,
  annulable.

### 5.3 Web
- Composants : `LoveLevelPill` (vignette), `LoveLevelPicker` (fiche et menu), `ItemMenu` (« … »),
  `SelectMode` (« Sélectionner »), page `/envies/commande`, page `/reglages/niveaux`.
- Contexte des niveaux de l'utilisatrice (comme les profils) pour afficher ses émojis et noms partout.

### 5.4 Jetons de design
- Nouvelles couleurs dans `primitives.ts`, mêmes noms de jetons sémantiques (l'UI ne change pas de classes) :
  - clair : fond `#F2EDE7`, carte `#FFFFFF`, encre `#2B1D17`, encre douce `#6E5A50`, trait `#E5D7CC`,
    accent chocolat `#5A3A2E`, rose poudré `#EBC7C3` (conseils), jaune beurre `#F3E3A6`, sauge `#D5DCC8`, fond creux
    `#EBE3DB`, fond des photos latte `#EADBC8` (le camel `#DCC3A6` a été retiré) ;
  - sombre : fond `#1E1612`, carte `#2A201B`, encre `#F2EDE7`, encre douce `#C9B8AE`, accent rose poudré `#EBC7C3`
    (encre d'accent chocolat foncé), fond creux `#241A15`, trait `#3D2F28`, conseils `#3D2F28`, fond des photos
    `#241A15` — valeurs ajustées pour passer les tests de contraste existants.
- Adouci le 2026-11-07 après test : encre claire `#4A332A` (au lieu de `#2B1D17`) ; encre sombre `#DDD0C6` et encre
  douce sombre `#B5A398`. Bandeau de « Préparer une commande » (version B) : jetons `color-band` (`#F6E4E1` / sombre
  `#33251F`), `color-band-line` (`#D8A9A3` / `#6B4A44`), `color-band-button` (`#7A5444` / rose poudré) et
  `color-band-button-ink` (blanc / chocolat foncé).
- Polices : `@fontsource-variable/fraunces` et `@fontsource-variable/dm-sans` à la place de Cormorant Garamond et
  Jost ; mise à jour de `docs/specs/2026-11-01-direction-visuelle.md`.

## 6. Tests

- Unitaires : niveau suivant (cycle), tri « Ce que j'aime le plus », calcul total / écart au budget (prix inconnus,
  sans budget), contrastes de la palette (tests existants).
- Intégration API : reprise des favoris en J'aime, garder avec `wish`, filtres et tri, lots et annulation, budgets
  (profil et liste ; semaine, mois, dates, sans période ; changement de semaine et de mois en heure de Paris ;
  prix payé ou prix boutique ; renvoyé recrédité ; passage annulé non compté), « J'ai commandé » (transaction, annulation), fusion anonyme → compte, niveaux personnalisés (4 exactement,
  un émoji, 20 caractères).
- Parcours navigateur (téléphone, tablette, ordinateur, axe sans violation) : lien collé → « Ajouter à mes envies »
  en Mims ; toucher la pastille d'une vignette ; menu « … » → Prioritaire puis Retirer ; mode « Sélectionner » ;
  préparer une commande avec budget, revenir le lendemain (sélection gardée), « J'ai commandé » ; renommer un niveau
  et le voir sur les vignettes.

## 7. Hors de cette partie

- Partie 2 : avis et choix des amies sur le lien de partage (cahier des charges à suivre).
- Les autres écrans (accueil, fiche gardée en détail, admin) prennent la palette mais pas de nouvelle mise en page.

## 8. Points supposés, à confirmer

1. Les anciens favoris deviennent **🤍 J'aime** (et non 🥰 Mims).
2. Le budget d'une liste reste **privé** (les amies ne le voient pas sur le lien de partage).
3. « J'aime » est **présélectionné** sur la fiche d'un lien collé, pour ajouter en un toucher.
4. Le prix compté est le **prix actuel de la boutique** (pas un prix que tu saisis).
5. La pastille d'une vignette **tourne** d'un toucher ; le choix direct d'un niveau passe par « … ».

## 9. Écarts et décisions prises pendant le code

Ce qui change par rapport au texte ci-dessus, ou qui précise un cas non prévu :
- Dans « Préparer une commande », cocher un article n'affiche pas de message « Annuler » : il suffit de le décocher. « J'ai commandé » sans rien de coché répond « Coche au moins une envie ».
- « Recommencer à zéro » (budget) demande une confirmation et ne peut pas être annulé ; enregistrer ou supprimer un
  budget affiche en revanche un message avec « Annuler ».
- Plus de 200 articles cochés : la commande est refusée avec le message « Tu as coché plus de 200 articles :
  décoches-en quelques-uns ».
- Une seule coche par article : cocher un article depuis une liste le coche aussi dans « Préparer une commande » de
  son profil, et inversement.
- Pas d'opérations de lot dédiées (niveau, prioritaire, commande) : l'action groupée existante les porte, avec
  l'annulation.
- Quand deux profils sont fusionnés (profil anonyme et compte), le budget du profil anonyme est repris si le profil du
  compte n'en a pas ; sinon celui du compte est gardé.
- Le montant dépensé d'un budget ne descend jamais sous 0 ; l'historique remonte au plus 8 semaines ou 12 mois et
  jamais avant la création du budget.
- Le budget d'une liste compte les articles qui sont dans la liste maintenant (si un article y entre ou en sort, le
  total change aussi pour les commandes passées).
- Passer un budget en « Sans période » compte depuis sa création, pas depuis le changement.
- Un article déjà gardé ailleurs et gardé à nouveau prend le niveau, la priorité et la raison choisis à cet instant
  (cela peut faire passer un 🔥 en J'aime) : à revoir.
- Un article « Commandé » remis dans « Repéré » est recrédité comme un renvoi (même montant que sa dernière commande) ;
  un article d'un autre stade remis dans « Repéré » ne change rien.
- Le montant compté dans le budget est enregistré à part (`spent_cents`) ; le montant saisi reste dans `amount_cents`.
- En mode « Sélectionner », toucher la pastille de niveau d'une carte ne la sélectionne pas (toucher ailleurs sur la carte) ; sur téléphone la barre de sélection défile sur le côté et ses actions des bords peuvent être hors écran sans indice. À valider.
- Détails visuels à valider par la fondatrice : onglets du téléphone en 13 px, valeurs sombres du fond creux, du trait,
  des conseils et du fond des photos.

### Retours de la fondatrice après les tests en dev (2026-11-07)

- « Annuler » reste une seule action, la dernière (pas de pile) ; le message de la pastille et du menu « … » nomme l'article (« Robe Lina : Mims »). Pour plusieurs articles d'un coup : « Sélectionner ».
- Mise à jour automatique : une page ouverte demande toutes les 10 s une empreinte de ses données (`GET /api/me/changes`) et ne relit Envies, listes et « Préparer une commande » que si elle a changé ; aussi tout de suite au retour sur la page. En pause onglet caché, fenêtre ouverte ou sélection en cours (le changement arrive ensuite). Pas de connexion permanente.
- « … au-dessus » du budget en rouge (couleur d'erreur). Bandeau de « Préparer une commande » : rose très clair avec contour rose, bouton chocolat au lait (version B). Texte adouci dans toute l'app, en clair et en sombre (§5.4). Pastilles du budget (version B, choisie le 2026-11-07) : « Il te resterait » et « … au-dessus » ont le même style, fond doux, contour et texte en gras (`color-success-soft` / `-edge` / `color-success`, `color-danger-soft` / `-edge` / `color-danger`), en clair comme en sombre. L'ancienne pastille sauge se fondait dans le bandeau (écart 1,15) ; la pastille pleine était trop lourde en clair.
- Réglages → Apparence : Automatique, Clair, Sombre, gardé sur l'appareil.
- Budget sur le lien de partage et échanges avec les amies : partie 2.
