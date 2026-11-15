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

Choix validé par la fondatrice (2026-11-15) : Postfix sur notre machine.

Ce qui est construit :

- `commandes.closyria.com` (prod) et `commandes.dev.closyria.com` (dev) ont pour MX `mx.closyria.com` (la machine).
  Postfix y reçoit seulement (aucun envoi, aucune réponse, aucun avis de non-remise, aucun relais, même depuis la
  machine), refuse dès la réception plus de 2 048 000 octets, plus de 5 destinataires, toute adresse d'un autre
  domaine, et limite le débit de chaque serveur d'envoi. Il accepte tout destinataire des deux domaines (il ne dit
  pas lesquels existent). Il chiffre quand l'expéditeur le propose (certificat par défaut de Debian : Gmail et Outlook
  ne vérifient pas celui d'un MX sans MTA-STS ni DANE). Identifiants de file longs (`enable_long_queue_ids`), jamais
  réutilisés. L'installation simule d'abord `apt-get` (rien ne doit être retiré ; au retrait complet, rien d'autre que
  Postfix), refuse une machine où un autre serveur d'e-mail est installé ou écoute sur le port 25, garde une copie des réglages, finit par un essai de bout en bout et revient
  en arrière d'elle-même si un pas échoue (`deploy/README.md`) ;
- pour chaque destinataire, Postfix lance `deploy/inbound/closyria-inbound-relay.mjs` (compte `closyria-mx`, secret
  dans `/etc/closyria-inbound/`), qui poste le message et l'enveloppe SMTP (identifiant de file, adresse du client,
  HELO, MAIL FROM, RCPT TO) à `POST /api/inbound-email` sur `127.0.0.1`, signés HMAC-SHA256 avec
  `INBOUND_EMAIL_SECRET` (horodatage à 5 minutes près, comparaison en temps constant). Sans secret : 404. Une requête
  passée par Caddy (`X-Forwarded-For`) : 404, même bien signée. L'identifiant de file et l'adresse forment une clé
  unique : une reprise de Postfix (ou un rejeu) ne crée rien de plus (`duplicate`) ;
- l'API vérifie avec `mailauth` : DKIM sur les octets reçus (rsa-sha1 refusé, une signature `l=` qui ne couvre
  qu'une partie du corps ne compte pas), SPF à partir de l'adresse du client et du MAIL FROM, ARC, alignement relâché
  par la liste des suffixes publics (partie privée comprise). Un en-tête du message n'est jamais cru comme verdict ;
- **panne DNS** : l'API répond 503 (rien n'est gardé, Postfix réessaie jusqu'à 5 jours, puis abandon sans réponse)
  seulement quand le contrôle qui déciderait est en temperror : la signature DKIM de son domaine sur un transfert
  dont le `From:` est elle (règle 1), ou SPF sur son expéditeur de transfert Gmail exact (règle 2, si activée).
  Ailleurs, la panne ne change rien : l'e-mail suit son sort normal (ignoré). Remplace la règle « panne DNS vaut refus » de
  la première version : un e-mail d'elle ne se perd plus pour une panne passagère.

**Expéditeur effectif** (celui du message de transfert, sa boîte à elle, jamais la boutique citée dedans) :

1. **un transfert fait par elle** (« Transférer » de Gmail, Outlook, iCloud) : son adresse en `From:` (un seul
   champ, une seule adresse, syntaxe valide, pas de groupe, ASCII), une signature DKIM valide **alignée** sur ce
   domaine, sur tout le corps, et qui **signe le `To:` ou le `Cc:`** (un seul de chaque) où figure l'adresse de
   commande. SPF seul ne suffit jamais : sans cela, un e-mail d'elle envoyé à quelqu'un d'autre, renvoyé tel quel sur
   son adresse de commande, passerait ;
2. **le transfert automatique de Gmail**, **coupé par défaut** (`INBOUND_AUTOFORWARD=off`). Activé : sa boîte est
   chez Gmail (`gmail.com`, `googlemail.com`), le MAIL FROM est exactement
   `<sa partie locale>+caf_=<adresse de commande, @ écrit =>@<son domaine Gmail>`, SPF réussit pour ce domaine, et
   une seconde preuve que Google l'a relayé : un jeu ARC vérifié signé par `google.com`, ou une signature DKIM de
   `google.com` (pas `gmail.com` : tout e-mail d'un compte Gmail en porte une). **La vraie garantie est SPF plus
   l'étiquette `caf_` exacte** (seuls les serveurs de Gmail envoient pour `gmail.com`, et Gmail écrit cette
   étiquette pour une adresse de transfert qu'elle a confirmée, à vérifier aussi) ; la preuve Google n'est qu'un contrôle de plus.
   À vérifier sur un vrai transfert automatique en dev **avant** `INBOUND_AUTOFORWARD=on` (TODO dans
   `inbound/sender.ts`) ;
3. **la confirmation de transfert de Gmail** (`forwarding-noreply@google.com`, DKIM `google.com` valide) : quand
   son texte nomme l'adresse de commande comme destination (sa confirmation pour une autre destination, renvoyée
   ici, ne compte pas) et que l'adresse qui demande le transfert est la sienne, son code est gardé sur l'adresse de commande et
   montré 24 h (`pendingGmailCode` de `GET /api/me/order-inbox`, affiché par la Task 7). Rien d'autre n'est gardé.

La comparaison avec l'adresse du compte se fait sans tenir compte des majuscules ; le compte doit avoir son adresse
vérifiée ; les adresses internationalisées (non ASCII) ne sont pas acceptées comme expéditrice. Sinon : ligne
`ignored` (adresse prétendue, `auth_ok = false`), **rien d'autre** : ni message brut, ni file.

Limites acceptées (à dire dans l'aide de la Task 7) : un alias (« Envoyer en tant que » de Gmail, « Masquer mon
adresse » d'iCloud, alias Outlook) n'est pas son adresse ; une redirection qui réécrit l'expéditeur (« Rediriger »
d'Outlook, certaines règles iCloud) est ignorée ; une copie cachée (Cci) de l'adresse de commande aussi (elle n'est
dans aucun `To:` ni `Cc:` signé). L'aide doit indiquer « Transférer », l'adresse de commande en destinataire.

**Autres décisions** :

- adresse : prénom sans accents en minuscules (20 caractères au plus) ou « commande », un tiret, 4 caractères de
  `abcdefghjkmnpqrstuvwxyz23456789` (sans i, l, o, 0, 1). Jamais redonnée. « Changer d'adresse » : l'ancienne cesse
  aussitôt, ses e-mails ne laissent aucune trace (comme une adresse inconnue) ;
- ordre d'écriture : la ligne (`queued`), puis l'objet `users/<user>/inbound/<id>.eml` dans le stockage privé, puis sa
  clé sur la ligne. Écriture ratée : ligne `failed`, l'objet éventuellement écrit est effacé. Ligne supprimée entre-temps
  (suppression du compte, qui verrouille ses adresses) : l'objet est effacé. File d'attente en panne : `failed`, le
  brut reste ses 30 jours (saisie à la main). Si même le passage à `failed` échoue, la purge passe `failed` toute
  ligne restée `queued` sans message plus d'une heure (son objet éventuel effacé d'abord) ;
- quotas par adresse et par 24 heures, comptés à part : 100 e-mails acceptés, 20 ignorés ; au-delà, rien ;
- code de confirmation Gmail : effacé par la purge de la nuit une fois ses 24 heures passées ;
- purge : tâche `order-email-purge` chaque nuit à 03:45 (UTC), qui applique `inboundEmailPurge` aux lignes passées
  leur `purge_after` (réception + 30 jours). L'objet est effacé d'abord ; la ligne ne change (supprimée, ou clé
  effacée) qu'une fois l'objet vraiment supprimé, sinon elle attend la nuit suivante ;
- le relais ne fait jamais renvoyer d'avis : API d'accord (202), message trop gros (413) ou mal formé (400) → remis
  (code 0) ; sinon (401, 404, 503, API absente) → réessai par Postfix (code 75) ;
- journaux : Postfix écrit les adresses et les IP de chaque e-mail ; son journal va dans
  `/var/log/postfix-closyria.log`, effacé après 30 jours, pas dans journald (partagé, sans limite de durée). L'API et le
  relais n'écrivent ni adresse ni contenu.

### 10.2 Lecture des e-mails (Task 3, 2026-11-15)

- **Formats connus d'abord** (`packages/extract/src/order-email`) : données structurées schema.org (`Order`,
  `ParcelDelivery`, celles que lit Gmail), puis les notifications Shopify par défaut (confirmation et expédition, en
  français et en anglais), lues sur le texte de l'e-mail (HTML ramené à des lignes). Rien d'autre n'est deviné : un
  champ absent reste vide. La date de commande est la date de l'e-mail d'origine pour une confirmation Shopify (lue
  dans l'en-tête du transfert, heure de Paris), inconnue pour une expédition. Le prix d'une ligne est celui **d'une
  pièce** (le total de la ligne divisé par la quantité). Liens jamais suivis, pièces jointes jamais lues.
- **IA en secours** (`packages/ai`, SDK officiel, modèle `claude-haiku-5-5`, sortie JSON imposée par le schéma Zod,
  revérifiée ensuite) seulement si aucun format connu ne lit l'e-mail et si `ANTHROPIC_API_KEY` est là. Avant l'envoi,
  dans le doute on retire : liens (seul leur domaine reste), adresses e-mail (`%40` compris), tout ce qui a la forme
  d'un IBAN (toute casse) ou d'une carte (13 chiffres et plus, espaces, points ou tirets), contrôle réussi ou non,
  téléphones (français, `+`, nationaux de tout pays : 9 chiffres et plus avec séparateurs, ou après « Tél », « Mobile »…),
  adresses postales (lignes de rue, code postal avant ou après la ville, blocs « Adresse de livraison »…), lignes
  « À : » / « Cc : » ; un numéro de suivi écrit avec des espaces peut partir aussi (le colis s'ajoute à la main).
  40 000 caractères au plus, l'objet de l'e-mail en tête. Sans clé, plafond atteint ou réponse inutilisable : e-mail
  `failed` (« On n'a pas su lire cet e-mail »).
- **Plafond** : réglage `ai_monthly_cap_cents` de la table `app_settings` (10 € sans réglage, modifiable par l'admin à
  la Task 8). Coût de chaque appel compté sur l'usage en jetons (prix Haiku 5.5 : 0,10 $ / 0,50 $ le million en entrée /
  sortie), par mois de Paris, dans `ai_usage_months`. Un appel réserve d'abord son coût le plus haut possible, en une
  seule requête qui refuse de dépasser le plafond (deux appels simultanés ne le dépassent pas ensemble), puis le
  remplace par le coût réel. Un dollar est compté pour un euro (le plafond est atteint un peu tôt, jamais tard).
- **Boutique** : le domaine de l'expéditeur d'origine, sinon un signataire DKIM du message, sinon le site le plus lié
  (deux liens au moins) ; jamais une messagerie, un transporteur, une plateforme, un routeur d'e-mails ou de clics
  (Mailjet, Mailgun, Klaviyo…), un raccourcisseur, un réseau social, ni le domaine de son adresse à elle. La boutique
  qui possède ce domaine, sinon créée `pending` à son nom de domaine, comme pour une capture ; aucun domaine plausible :
  commande sans boutique (pas de boutique devinée).
- **Doublons (RF 2)** : même titulaire + même boutique + même numéro de commande, ou un même numéro de suivi → la
  commande existante (brouillon ou validée, jamais une écartée) est complétée : colis ajoutés ; pour un brouillon,
  articles manquants ajoutés et taille, couleur, prix et date manquants remplis. Verrous consultatifs de transaction
  sur (elle, boutique, numéro) et (elle, numéro de suivi), et la commande lue `for update` (une validation en cours
  passe d'abord). Les colis reçoivent leur `next_check_at` (rythme de
  `nextParcelCheck`), la Task 5 les prend.
- **Notification** : nouvelle sorte d'alerte `order_received` (envoi immédiat, calme de nuit et plafond du chantier 4),
  seulement à la création d'une commande et seulement si elle est encore à valider à l'envoi. Titre « Commande reçue de
  {boutique} » (« Commande reçue » sans boutique), texte « Vérifie les articles, puis « C'est bon ». », lien vers
  « Nouvelles » en attendant la page « Mes commandes » (Task 7). Envoyée au résumé par le plafond du jour, elle n'y
  figure pas (la carte reste dans « Nouvelles »).
- **File** `order-email-parse` : 3 nouvelles tentatives (IA indisponible, stockage ou base en panne) ; à la dernière,
  l'e-mail passe `failed` plutôt que de rester `queued`. Une seconde exécution du même travail ne fait rien.
