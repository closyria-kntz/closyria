# Après la commande — cahier des charges

Première partie du chantier 3 « Commandes et argent » de la V1 (`docs/specs/2026-11-01-v1-conception.md`, §7.3),
centrée sur la vie d'un article entre la commande et sa réception. Le suivi des remboursements, des avoirs et du
budget vient ensuite.

## 1. Pourquoi

Après une commande, tout est à la main : savoir où en est le colis, penser à passer l'article « Reçu », ne pas rater
la date limite de retour. Réussi quand une utilisatrice transfère un e-mail de commande (ou colle un numéro de suivi)
et n'a plus rien à faire jusqu'à la réception, puis est prévenue avant la fin du délai de retour.

## 2. Décisions validées (2026-11-14)

| # | Sujet | Décision |
|---|---|---|
| C1 | Entrée | Transfert de l'e-mail de commande ou d'expédition vers une adresse personnelle Closyria **et** numéro de suivi collé sur un article « Commandé ». |
| C2 | Lecture | Formats connus d'abord (Shopify, données structurées, numéros de suivi), IA en secours ; l'utilisatrice valide toujours d'un geste. |
| C3 | Suivi | La Poste en direct (Colissimo, La Poste, Chronopost) + un agrégateur pour les autres transporteurs (Mondial Relay, GLS, DPD, Colis Privé…) ; sinon lien « Suivre chez le transporteur ». |
| C4 | Livraison | Passage automatique en « Reçu » + « Retour possible jusqu'au … » (délai de la boutique, 14 jours par défaut, réglable en admin) + rappel 3 jours avant. |
| C5 | Instagram | Un lien Instagram peut être la source d'un article ; on ne lit pas Instagram : nom, prix et photo sont saisis par elle. |

## 3. Ce que voit l'utilisatrice

### 3.1 Son adresse de commandes
- Compte → « Mes commandes par e-mail » : son adresse personnelle (ex. `marie-k7f2@commandes.closyria.com`), bouton
  « Copier », aide pas à pas pour transférer un e-mail et créer une règle de transfert automatique (Gmail, Outlook,
  iCloud). Sans compte : « Crée ton compte pour suivre tes commandes ».
- « Changer d'adresse » : l'ancienne cesse de fonctionner (protection en cas de fuite).

### 3.2 Une commande reçue par e-mail
- Notification « Commande reçue de {boutique} » et carte à valider (Accueil et page « Mes commandes ») : articles
  trouvés (nom, taille, couleur, quantité, prix, photo s'il y en a une), numéro de suivi et transporteur, date de
  commande. Chaque article est relié à son envie quand c'est le même produit, sinon créé.
- « C'est bon » : les articles passent à « Commandé » et le suivi démarre. « Corriger » : elle modifie avant de
  valider. « Ce n'est pas une commande » : ignoré.
- E-mail illisible : carte « On n'a pas su lire cet e-mail » avec saisie manuelle (boutique, articles, numéro).

### 3.3 Coller un numéro de suivi
- Sur un article « Commandé » (ou une commande) : « Ajouter un numéro de suivi » ; transporteur deviné par le format,
  modifiable.

### 3.4 Pendant le transport
- Sur l'article et la commande : « En route » avec la dernière étape (« Pris en charge », « En cours de livraison »,
  « Disponible en point relais »…) et la date estimée ; bouton « Suivre chez le transporteur ».
- Notifications (mêmes règles que les alertes : calme de nuit, plafond) : « Ton colis {boutique} est en cours de
  livraison » (facultatif, coupé d'office), « Ton colis {boutique} est arrivé » / « disponible en point relais ».

### 3.5 Livraison et retour
- À la livraison : articles en « Reçu » automatiquement, badge « Retour possible jusqu'au {date} ».
- Rappel « Plus que 3 jours pour retourner {article} » (notification + « une »).
- Pas de nouvelles du transporteur 10 jours après l'expédition (ou numéro non suivable) : « Tu as reçu ta commande
  {boutique} ? » → « Oui » (passe en « Reçu ») / « Pas encore ».

### 3.6 Lien Instagram
- Coller un lien `instagram.com/…` : article créé avec ce lien comme source et un formulaire court (nom, prix,
  boutique, photo depuis sa galerie). Aucune lecture d'Instagram.

## 4. Admin

- Boutiques : délai de retour (jours) et lien vers sa page de retours ; transporteurs vus.
- « E-mails de commande » (prévu V1 §8) : e-mails reçus non lus ou mal lus (sans contenu personnel affiché par
  défaut), taux de lecture par boutique, coût IA du mois.
- Tableau de bord : colis suivis, livrés, en échec de suivi.

## 5. Règles

- **Sécurité** : seuls les e-mails dont l'expéditeur (après transfert) est **son adresse vérifiée** sont acceptés ;
  contrôle SPF/DKIM/DMARC du message reçu ; tout autre e-mail est ignoré sans réponse. Taille maximale, pièces jointes
  ignorées, liens jamais suivis automatiquement.
- **Données personnelles** : l'e-mail brut est gardé 30 jours au plus (pour corriger une lecture) puis effacé ; on
  garde seulement le résultat validé. Avant l'IA, on retire ce qui n'est pas utile (adresse postale, téléphone,
  moyens de paiement). Suppression du compte = suppression de tout.
- **Coûts** : IA seulement si les formats connus échouent ; plafond mensuel en admin (au-delà, saisie manuelle).
  Agrégateur seulement pour les transporteurs non couverts par La Poste.
- **Pas de contournement** : pas de lecture d'Instagram ni de pages protégées ; suivi via les accès officiels.
- **Rythme du suivi** : interrogation des transporteurs toutes les 2 à 6 heures selon l'étape, arrêt à la livraison
  ou après 30 jours.

## 6. Technique (pour l'équipe)

- Réception des e-mails : sous-domaine `commandes.closyria.com` (MX) vers le service de réception entrante du
  fournisseur d'e-mail (webhook signé vers l'API) ; à défaut, un serveur de réception dédié. Configuration DNS par la
  fondatrice (une commande, un message).
- Lecture : `packages/extract` (formats connus) ; IA via `packages/ai` (nouveau), modèle léger, sortie validée par Zod.
- Suivi : connecteur La Poste (clé « Okapi ») et connecteur agrégateur (clé), file pg-boss dédiée ; variables
  d'environnement facultatives (sans clé : la fonction est coupée proprement).
- Nouvelles tables : adresses de commande, e-mails reçus (purge 30 jours), commandes, colis et étapes ; délai de
  retour sur `shops`.

## 7. Tests attendus

- Unitaires : lecture des formats connus (Shopify FR, données structurées), détection des numéros et transporteurs,
  calcul de la date limite de retour, rythme du suivi.
- Intégration : e-mail accepté / refusé (mauvais expéditeur, signature invalide), validation → articles « Commandé »,
  liaison aux envies, suivi → « Reçu », rappel J-3, purge 30 jours, suppression de compte.
- E2E (3 appareils, axe) : adresse et aide, carte à valider, numéro collé, article en route puis reçu, lien Instagram.

## 8. Hors de ce chantier

Remboursements et avoirs, budget, annuaire des boutiques (fiche et réseaux sociaux), affichage officiel des posts
Instagram, connexion directe à une boîte mail.
