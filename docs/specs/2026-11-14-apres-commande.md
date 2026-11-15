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

## 10. Décisions de construction

### 10.1 Réception des e-mails (Task 2, 2026-11-15)

**Décision : pas la réception entrante de Brevo. Un serveur de réception sur notre machine (Postfix) remet chaque
e-mail, brut, à l'API de l'environnement, signé ; l'API calcule elle-même SPF, DKIM et l'alignement.** C'est le
« serveur de réception dédié » prévu au §6 à défaut du fournisseur.

Ce que dit la documentation de Brevo (lue le 2026-11-15 : `developers.brevo.com/docs/inbound-parse-webhooks`,
`/docs/secured-webhooks`, `/reference/get-inbound-email-events-by-uuid`) :

- le webhook envoie du JSON (`items[]`) : `From`, `To`, `Recipients` (RCPT TO), `Subject`, `RawHtmlBody`,
  `RawTextBody`, le texte extrait, les pièces jointes (métadonnées et jeton de téléchargement), `Headers` (tous les
  en-têtes), une note de spam (rspamd) ;
- **pas de message brut** (MIME) : on ne peut pas vérifier une signature DKIM nous-mêmes, elle porte sur les octets
  exacts du message ;
- **pas de résultat SPF, DKIM ou DMARC calculé par Brevo à la réception**, ni l'adresse du serveur d'envoi, ni le
  MAIL FROM (seulement l'en-tête `Return-Path`). Les `Received-SPF` et `ARC-Authentication-Results` de l'exemple
  viennent des serveurs d'avant ; n'importe quel en-tête peut être écrit par l'expéditeur ;
- le webhook n'est **pas signé** : identifiant et mot de passe dans l'URL, jeton « bearer » ou en-têtes choisis, et
  des plages d'adresses IP publiées dans le centre d'aide (page non lisible sans navigateur ; `1.179.112.0/20` selon
  des sources tierces).

Avec Brevo, la règle du §5 (expéditeur effectif = son adresse vérifiée **et** SPF ou DKIM aligné, Review Focus 1) ne
peut donc pas être tenue : un faux e-mail avec son adresse en `From:` et un faux `Authentication-Results` passerait.
Les autres fournisseurs de réception (Amazon SES, SendGrid, Mailgun, Postmark) n'ont pas été étudiés en détail :
chacun demande un nouveau compte et ajoute un sous-traitant pour des données personnelles, ce qui se décide avec la
fondatrice.

Ce qui est construit :

- `commandes.closyria.com` (prod) et `commandes.dev.closyria.com` (dev) ont pour MX `mx.closyria.com` (la machine).
  Postfix y reçoit seulement (aucun envoi, aucune réponse, aucun avis de non-remise), refuse dès la réception plus de
  2 048 000 octets et toute adresse d'un autre domaine, chiffre quand l'expéditeur le propose (certificat par défaut
  de Debian : Gmail et Outlook ne vérifient pas celui d'un MX sans MTA-STS ni DANE) ;
- pour chaque destinataire, Postfix lance `deploy/inbound/closyria-inbound-relay.mjs`, qui poste le message et
  l'enveloppe SMTP (adresse du client, HELO, MAIL FROM, RCPT TO) à `POST /api/inbound-email` sur `127.0.0.1`, signés
  HMAC-SHA256 avec `INBOUND_EMAIL_SECRET` (horodatage à 5 minutes près, comparaison en temps constant). Sans secret :
  404. Une requête passée par Caddy (`X-Forwarded-For`) : 404, même bien signée ;
- l'API vérifie avec `mailauth` : SPF à partir de l'adresse du client et du MAIL FROM, DKIM sur les octets reçus
  (rsa-sha1 refusé, une signature `l=` qui ne couvre qu'une partie du corps ne compte pas), alignement relâché par la
  liste des suffixes publics (partie privée comprise). Un en-tête du message n'est jamais cru. Une panne DNS vaut refus.

**Expéditeur effectif** (celui du message de transfert, sa boîte à elle, jamais la boutique citée dedans) :

1. un transfert fait par elle (« Transférer » de Gmail, Outlook, iCloud) : son adresse en `From:` (un seul champ, une
   seule adresse), avec une signature DKIM valide alignée sur ce domaine, ou SPF réussi pour un MAIL FROM aligné ;
2. un transfert automatique (adresse de transfert Gmail) : le `From:` de la boutique est gardé, mais le MAIL FROM est
   sa boîte (Gmail écrit `marie+caf_=…@gmail.com` : un `+tag` de sa boîte compte comme elle), avec SPF réussi pour ce
   domaine exactement.

La comparaison avec l'adresse du compte se fait sans tenir compte des majuscules ; le compte doit avoir son adresse
vérifiée. Sinon : ligne `ignored` (adresse prétendue, `auth_ok = false`), **rien d'autre** : ni message brut, ni file.

Limites acceptées (à dire dans l'aide de la Task 7) : un alias (« Envoyer en tant que » de Gmail, « Masquer mon
adresse » d'iCloud, alias Outlook) n'est pas son adresse ; une redirection qui réécrit l'expéditeur (« Rediriger »
d'Outlook, certaines règles iCloud) est ignorée : l'aide doit indiquer « Transférer ». Les chaînes ARC ne sont pas
utilisées (il faudrait faire confiance au serveur qui transfère).

**Autres décisions** :

- adresse : prénom sans accents en minuscules (20 caractères au plus) ou « commande », un tiret, 4 caractères de
  `abcdefghjkmnpqrstuvwxyz23456789` (sans i, l, o, 0, 1). Jamais redonnée. « Changer d'adresse » : l'ancienne cesse
  aussitôt, ses e-mails ne laissent aucune trace (comme une adresse inconnue) ;
- ordre d'écriture : la ligne (`queued`), puis l'objet `users/<user>/inbound/<id>.eml` dans le stockage privé, puis sa
  clé sur la ligne. Écriture ratée : ligne `failed`, l'objet éventuellement écrit est effacé. Ligne supprimée entre-temps
  (suppression du compte, qui verrouille ses adresses) : l'objet est effacé. File d'attente en panne : `failed`, le
  brut reste ses 30 jours (saisie à la main) ;
- au plus 100 e-mails gardés par adresse et par 24 heures (au-delà : rien) ;
- purge : tâche `order-email-purge` chaque nuit à 03:45 (UTC), qui applique `inboundEmailPurge` aux lignes passées
  leur `purge_after` (réception + 30 jours) et efface les objets après la validation ;
- le relais ne fait jamais renvoyer d'avis : API d'accord (202), message trop gros (413) ou mal formé (400) → remis
  (code 0) ; sinon → réessai par Postfix (code 75), 5 jours au plus, puis abandon sans réponse.
