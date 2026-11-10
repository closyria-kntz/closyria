# Acheter ensemble (partie 2c)

Partie 2 du lien de partage : 2a avis des amies (`docs/specs/2026-11-07-avis-des-amies.md`), 2b offrir
(`docs/specs/2026-11-09-offrir.md`), 2c acheter ensemble (ce document). Même lien `/l/<token>`, même façon de
reconnaître une amie (prénom + clé d'appareil, § 3.2 de 2a, « Ce n'est pas toi ? » de 2b § 10).

## 1. Pourquoi

Partager les frais de port. La fondatrice passe **une seule commande** chez une boutique pour elle et ses amies, afin
d'atteindre la livraison offerte ou de diviser le port. Chaque amie ajoute ce qu'elle veut pour elle ; l'app calcule
ce que chacune doit. L'app ne touche jamais l'argent.

Réussi quand : une amie ajoute ses articles depuis le lien sans compte, tout le monde voit l'avancée vers la livraison
offerte, et la fondatrice sait, après avoir commandé, combien chacune lui doit et qui a payé.

## 2. Décisions validées (2026-11-10)

| # | Sujet | Décision |
|---|---|---|
| C1 | But | Partager les frais de port (une commande, une boutique). |
| C2 | Ce qu'une amie ajoute | « Je le prends aussi » sur un article de la liste de cette boutique (taille, quantité), et « Ajouter un autre article » par lien de la **même** boutique. |
| C3 | Port | Options de livraison notées **en admin** pour chaque boutique (plusieurs possibles) ; à l'ouverture la fondatrice en choisit une, ou saisit port et seuil elle-même. |
| C4 | Argent | Montant dû affiché + « Payé » coché par la fondatrice. Pas de paiement dans l'app. |
| C5 | Déroulé | Ouverte → close → commandée. Date limite facultative. Rouvrir possible avant « J'ai commandé ». Annuler possible avant « J'ai commandé ». |
| C6 | Visibilité | Tout le monde voit qui prend quoi (prénoms, articles, total, avancée). Le montant dû d'une amie n'est vu que par elle et par la fondatrice. |

## 3. Ce que voit et fait une amie (le lien)

### 3.1 Bandeau
Commande ouverte → bandeau 🛍️ en haut du lien : « Commande groupée chez {boutique} avec {prénom}, jusqu'au {date} »
(sans date : sans « jusqu'au »). Prénom de la fondatrice caché (réglage existant) : « Commande groupée chez {boutique} ».
Avancée :
- option avec seuil, non atteint : « Total {total} · Plus que {reste} pour la livraison offerte » ;
- seuil atteint : « Total {total} · Livraison offerte ✓ » ;
- sans seuil : « Total {total} · Port {port}, partagé entre celles qui commandent ».

### 3.2 « Je le prends aussi »
Sur chaque article de la liste dont la boutique est celle de la commande (tant qu'elle est ouverte et avant la date
limite). Une fenêtre demande :
- la taille : liste des tailles connues de l'article s'il y en a, sinon champ libre (facultatif) ;
- la quantité (1 à 5, 1 par défaut) ;
- le prénom si l'appareil ne le connaît pas (même étape que les avis et cadeaux, mêmes règles « Une Léa est déjà
  passée… C'est toi ? »).
Ajouté : l'article affiche « Tu le prends aussi (T38 × 1) · Modifier · Retirer ». Une amie peut prendre le même
article deux fois en tailles différentes (« Je le prends aussi » reste proposé).

### 3.3 « Ajouter un autre article »
Dans le bloc de la commande. L'amie colle un lien :
- boutique différente → refus : « Ce lien n'est pas chez {boutique}. » ;
- même boutique → « Lecture de l'article… » (même capture que pour la fondatrice) puis nom, photo, prix ; elle choisit
  taille et quantité ;
- lecture impossible (boutique protégée, délai dépassé) → elle saisit nom et prix elle-même ; le lien reste.
Au plus 20 lignes par amie et par commande ; limite de fréquence contre les abus (comme les avis).

### 3.4 Récapitulatif
Bloc « Commande groupée » sur le lien, par personne (la fondatrice d'abord, puis par ordre d'arrivée) :
« Léa : Robe Lina T38 · Sac Mila ». Les lignes d'une amie montrent photo, nom, taille, quantité, prix.
Pour elle seulement : « Ta part : {montant} (articles {sous-total} + port {part}) », marqué « provisoire » tant que
la commande n'est pas commandée. Elle modifie ou retire ses lignes jusqu'à la clôture.

### 3.5 États
- Close : « Commande close, {prénom} va commander. » Plus d'ajout ni de modification.
- Commandée : « Commandé le {date}. » et pour elle « Tu dois {montant} à {prénom} » puis « Payé ✓ » une fois coché.
- Annulée : « Commande annulée. » (visible 30 jours, puis le bloc disparaît).
- Ligne retirée par la fondatrice : visible de l'amie seule, barrée, « Retiré par {prénom} ».

### 3.6 Avec les cadeaux
Indépendants. « Je le prends aussi » est un achat pour soi : il ne réserve rien et ne révèle rien des cadeaux.

## 4. Ce que voit la fondatrice

### 4.1 Ouvrir
Bloc « Partage » d'une liste partagée : « Ouvrir une commande groupée ». Fenêtre :
- boutique : parmi les boutiques des articles de la liste (une seule commande en cours par liste, § 5.1) ;
- livraison : les options de la boutique (admin), ou « Autre » → port (€) et « offerte dès » (€, facultatif) ;
- date limite (facultative, aujourd'hui ou après).
L'option choisie est **copiée** dans la commande : la modifier ensuite en admin ne change pas une commande ouverte.

### 4.2 Page « Commande groupée »
`/listes/{id}/commande-groupee`. Accès : lien depuis la page de la liste, et bandeau dans « Mes envies » tant qu'une
commande est ouverte ou close.
- En haut : boutique, livraison, date limite, total et avancée (mêmes phrases que § 3.1), état.
- Bloc « Toi » : les articles de la liste de cette boutique, à cocher (« Je le prends dans cette commande »), avec
  taille et quantité ; sous-total, part de port, total.
- Un bloc par amie : lignes (photo, nom, taille, quantité, prix, lien vers la boutique), sous-total, part de port,
  montant dû. Action « Retirer » sur une ligne (annulable 8 s).
- Actions selon l'état : « Clôturer » / « Rouvrir » / « J'ai commandé » / « Annuler la commande groupée »
  (confirmation).
- Modifier la date limite et la livraison tant qu'elle n'est pas commandée.

### 4.3 « J'ai commandé »
Fenêtre de confirmation qui montre chaque ligne avec son prix, **modifiable** (code promo, prix réel), et le port
réel (modifiable). Valider :
- fige prix, port et montants dus ;
- ses propres articles cochés passent en « Commandé » par le chemin existant (avertissement 🎁 compris, `confirmUnlessReserved`) ;
- les lignes des amies ne deviennent jamais des articles de la fondatrice.
Ensuite : case « Payé » par amie (annulable). La commande est « soldée » quand toutes les amies ont payé.

### 4.4 Admin : livraison des boutiques
Page d'une boutique dans l'admin : section « Livraison ». Options : nom (« Point relais »), port (€), « offerte dès »
(€, facultatif). Ajouter, modifier, supprimer ; journal d'audit comme les autres actions admin.

### 4.5 Ce qui ne change pas
Pas d'e-mail ni de notification aux amies. Rien de la commande groupée dans « Mes envies » au-delà du bandeau.

## 5. Règles

### 5.1 Une commande par liste
Au plus une commande groupée **ouverte ou close** par liste. Dès qu'elle est commandée ou annulée, une nouvelle peut
être ouverte, même si des paiements sont encore en attente. Les commandes passées restent consultables depuis la page
de la liste (« Commandes groupées passées »), avec leurs cases « Payé ».

### 5.2 Calcul
- Prix d'une ligne : prix courant connu de l'article (capture), ou saisi ; × quantité. Article sans prix : compté 0 et
  signalé « Prix inconnu » ; « J'ai commandé » demande de le renseigner.
- Total = somme des lignes de tout le monde (fondatrice comprise).
- Port : 0 si un seuil existe et total ≥ seuil ; sinon le port, partagé **à parts égales** entre les personnes qui ont
  au moins une ligne. Arrondi au centime inférieur pour chacune ; le reste va à la fondatrice.
- Monnaie : celle de la boutique ; une ligne dans une autre monnaie est refusée.
- Jusqu'à « J'ai commandé », les montants suivent les prix courants ; ensuite tout est figé.

### 5.3 Date limite
Après la date limite (fin de journée, heure de Paris), plus d'ajout ni de modification par les amies ; la commande
reste « ouverte » pour la fondatrice qui clôture et commande.

### 5.4 Lien et partage
Lien arrêté → le bloc et le bandeau disparaissent, rien n'est supprimé ; repartager les remet. Commandes groupées,
avis et cadeaux sont indépendants.

### 5.5 Identité des amies
Même identité que 2a/2b (prénom normalisé + appareils rattachés). Modifier/retirer une ligne exige un appareil
rattaché au prénom de la ligne.

## 6. Technique (pour l'équipe)

- Tables :
  - `shop_shipping_options` (shop_id, label, shipping_cents, free_from_cents nullable, position).
  - `group_orders` (wishlist_id, shop_id, status `open|closed|ordered|cancelled`, deadline date nullable,
    shipping_label, shipping_cents, free_from_cents nullable, currency, ordered_at, cancelled_at, timestamps).
    Index unique partiel : une seule `open|closed` par liste.
  - `group_order_lines` (group_order_id, buyer_name, buyer_name_key, product_id nullable, item_id nullable,
    manual_name, manual_price_cents, url, size_label, quantity, final_price_cents nullable, removed_at, timestamps).
  - `group_order_payments` (group_order_id, buyer_name_key, amount_cents figé, paid_at nullable).
- Ligne de la fondatrice : `item_id` (ses articles), `buyer_name_key` null.
- Lien d'amie : trouve ou crée le produit et la capture comme `POST /captures` (même file `capture-user`), contrôle de
  la boutique par `shop_domains`. La lecture se suit par la vue partagée (statut de la ligne), sans route de capture
  publique.
- API publique (sous `/api/shared/{token}/group-order`) : lecture dans `GET /api/shared/{token}` (avec `x-device-key`
  pour « ta part »), `POST lines` (item de la liste ou url), `PATCH/DELETE lines/{id}` ; mêmes codes que 2b
  (`name_taken`, 403 fermé, 429).
- API fondatrice : `/me/wishlists/{id}/group-orders` (créer, modifier, clôturer, rouvrir, commander avec prix finaux,
  annuler), `/me/group-orders/{id}/payments/{nameKey}` (payé / annuler), retrait de ligne avec annulation.
- Admin : `/admin/shops/{id}/shipping-options` (CRUD, audit).
- Calcul du port et des parts dans `packages/shared` (fonction pure, testée), utilisé par l'API et l'affichage.
- Rendu serveur du lien : sans montants personnels (ils dépendent de l'appareil), comme les cadeaux.

## 7. Tests attendus

- Unitaires : calcul (seuil atteint / non, parts égales, centimes, prix inconnu, quantités), états et transitions.
- Intégration API : ouverture (une seule par liste), lignes d'amie (liste, lien même boutique, autre boutique refusée,
  saisie manuelle, 20 max, date limite passée, close), retrait par la fondatrice, commander (figé, prix modifiés),
  payé, annuler, lien arrêté, montant dû visible seulement par la bonne amie.
- Admin : options de livraison CRUD, audit, copie dans la commande.
- E2E (3 appareils, axe) : la fondatrice ouvre, deux amies ajoutent (liste + lien), avancée vers la livraison offerte,
  clôture, « J'ai commandé » avec un prix corrigé, « Payé », ce que voit chaque amie à chaque étape.

## 8. Hors de ce chantier

- Paiement dans l'app.
- E-mails et notifications.
- Plusieurs boutiques dans une commande.
- Codes promo calculés automatiquement.
- Livraison chez chaque amie.

## 9. Décisions prises pendant la construction (2026-11-10)

Prises par le plan :
- Quand la fondatrice ne prend rien, le centime de port qui reste va à la première amie arrivée.
- La monnaie de la commande est celle du premier article de la boutique dans la liste (sinon l'euro) ; un article
  dans une autre monnaie est refusé.
- Les montants dus sont créés au moment de « J'ai commandé », un par amie qui a au moins un article, et ne bougent plus.
- Un lien collé par une amie ne crée jamais de boutique : seules les boutiques connues de Closyria sont acceptées.

Prises pendant la construction :
- La page de la commande se relit toute seule toutes les 10 secondes tant qu'elle est affichée et que la commande est
  ouverte ou close, et aussi quand on revient sur l'onglet.
- « J'ai commandé » montre une ligne par article de tout le monde avec son prix (vide s'il est inconnu, à remplir), et le
  port déjà rempli : 0 si la livraison offerte est atteinte, sinon le port de la commande.
- Avant d'envoyer « J'ai commandé », l'avertissement 🎁 est posé sur ses propres articles cochés ; « Attendre » n'envoie
  rien et la commande reste comme elle était.
- « Retirer » la ligne d'une amie : annulable 8 secondes (« Annuler » dans le message).
- « Annuler la commande groupée » demande confirmation : « Annuler la commande groupée ? », « Oui, annuler » / « Garder ».
- Bandeau « Commande groupée chez {boutique} en cours » + « Voir », dans « Mes envies » et sur la page de la liste, un par
  commande ouverte ou close.
- La fondatrice choisit la boutique parmi celles des articles de la liste ; les options de livraison de la boutique
  sont lues par une route réservée aux comptes connectés.
- « Payé » est une case à cocher par amie ; la décocher annule.
- Chaque commande de « Commandes groupées passées » s'ouvre en détail (« Voir »), quel que soit son âge : la page la
  montre en lecture seule, sauf les cases « Payé » (route `GET /api/me/group-orders/{id}`). Chaque ligne donne la
  date, le total dans la monnaie de la commande, et les amies qui n'ont pas encore payé.
- Après « Attendre » dans l'avertissement 🎁, rouvrir « J'ai commandé » garde les prix et le port qu'elle avait corrigés.
- Une fois « J'ai commandé » fait, le port qu'elle a vraiment payé (« Port payé ») est partagé à parts égales entre
  celles qui commandent, même si la livraison offerte était atteinte : le seuil ne compte plus. Tout montant dû
  affiché ensuite (« Doit … » chez elle, « Tu dois … » chez l'amie) est celui figé à ce moment-là.
- Le lien de la liste ne montre que la commande groupée la plus récente de la liste : toujours si elle est ouverte ou
  close ; commandée, tant qu'une amie n'a pas payé ou pendant 30 jours ; annulée, pendant 30 jours ; sinon aucune
  (jamais une commande plus ancienne à sa place).
