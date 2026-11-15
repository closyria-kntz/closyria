# Déploiement

1. **Construire** (compte développeur, sans privilège) : `deploy/build.sh origin/dev` → affiche l'identifiant de version.
2. **Essayer les migrations sur une copie de la prod** (avant toute mise en prod qui apporte des migrations) :
   `sudo bash deploy/dry-run-prod-migrations.sh <id>`, voir [plus bas](#essai-des-migrations-sur-une-copie-de-la-prod).
3. **Déployer** : `sudo closyria-deploy dev <id>` (sans mot de passe pour la dev) ou `sudo closyria-deploy prod <id>` (mot de passe requis).
4. **Revenir en arrière** : `sudo closyria-deploy <env> rollback`. Les migrations de base ne sont pas annulées.
5. **Lister** : `sudo closyria-deploy <env> list`.

`closyria-deploy` applique les migrations, bascule le lien `current`, redémarre `closyria-<env>.target` et vérifie
`/api/health` et la page d'accueil. Si la nouvelle version ne répond pas sous 30 s, il restaure la précédente.

| Fichier | Installé dans |
|---|---|
| `closyria-deploy` | `/usr/local/bin/` (root:root 755, ne doit jamais être modifiable par le compte développeur) |
| `systemd/*` | `/etc/systemd/system/` |
| `caddy/*.caddy` | contenu ajouté à `/etc/caddy/Caddyfile` |

Secrets : `/etc/closyria/<env>.env` (root:root 600), lus par systemd au démarrage. L'API et le worker refusent de
démarrer si une variable manque ou est invalide, et le journal (`journalctl -u closyria-<env>-api`) dit laquelle.

## Barrière réseau du worker

Le worker télécharge des pages de boutiques à partir d'adresses collées par des visiteurs. `safeFetch` refuse déjà
les adresses privées ; l'unité systemd du worker ajoute une **seconde barrière**, au niveau du noyau, qui tient même
si le code avait un défaut :

```ini
IPAddressDeny=0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 ::1/128 fc00::/7 fe80::/10
IPAddressAllow=127.0.0.53/32
```

Tout ce qui est privé, local ou de liaison locale est refusé, sauf `127.0.0.53` (résolveur DNS du serveur,
`systemd-resolved`). PostgreSQL passe par une socket Unix, donc n'est pas concerné. L'API et le web n'ont pas cette
barrière : ils parlent à `127.0.0.1`.

Avant d'activer, `/etc/resolv.conf` doit pointer vers `127.0.0.53` (`grep nameserver /etc/resolv.conf`) : sinon le
worker ne résout plus aucun nom.

Installer (compte avec sudo), pour la dev puis, plus tard, la prod :

```bash
sudo cp deploy/systemd/closyria-dev-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo closyria-deploy dev <id>   # le redémarrage prend la nouvelle unité
```

Vérifier dans le journal (au démarrage, le worker écrit `network barrier: active (ETIMEDOUT)` — systemd jette les paquets en silence, d’où un délai dépassé —, ou l’avertissement
`network barrier: ABSENT (ECONNREFUSED)` si la barrière n’est pas en place) :

```bash
sudo journalctl -u closyria-dev-worker -n 50 --no-pager | grep 'network barrier'
```

Étapes complètes : `docs/plans/2026-11-05-mise-en-service-chantier-1.md`.

## Variables d'environnement

À mettre dans `/etc/closyria/prod.env` (prod) et `/etc/closyria/dev.env` (dev), une par ligne (`NOM=valeur`).
`APP_VERSION` (fichier `release.env` de chaque version), `NODE_ENV`, `HOST`, `PORT` et `INTERNAL_API_URL` sont déjà
fixés par les unités systemd : ne pas les mettre dans ces fichiers.

| Variable | Sens | Prod | Dev |
|---|---|---|---|
| `APP_ENV` | Environnement. **Obligatoire** : les unités tournent en `NODE_ENV=production`, et sans `APP_ENV` l'API et le worker refusent de démarrer (jamais de repli silencieux sur `development`). `test` est réservé aux tests navigateur et refusé hors adresse locale. | `prod` | `dev` |
| `DATABASE_URL` | Base PostgreSQL, par socket Unix (authentification peer). | `postgresql:///closyria?host=/var/run/postgresql` | `postgresql:///closyria_dev?host=/var/run/postgresql` |
| `BETTER_AUTH_SECRET` | Clé qui signe les sessions. **32 caractères au moins**, différente par environnement, à ne jamais changer sans raison (la changer déconnecte tout le monde). Générer avec `openssl rand -base64 48`. | (secret) | (secret, un autre) |
| `SHARE_LINK_KEY` | Clé qui chiffre les liens de partage conservés en base (pour les réafficher). **32 octets en base64**, différente par environnement. Générer avec `openssl rand -base64 32`. La perdre ou la changer : les liens déjà créés ne s'affichent plus (il faut repartager). | (secret) | (secret, un autre) |
| `BETTER_AUTH_URL` | Adresse publique du site, **en https** (les cookies sont alors `Secure`). C'est aussi la seule origine autorisée à envoyer des formulaires à l'API (protection CSRF). | `https://closyria.com` | `https://dev.closyria.com` |
| `MAIL_TRANSPORT` | Envoi des codes de connexion. **`brevo`** en prod comme en dev (la dev envoie de vrais codes). | `brevo` | `brevo` |
| `BREVO_API_KEY` | Clé API Brevo (Brevo → SMTP & API → Clés API). | `xkeysib-…` | `xkeysib-…` |
| `MAIL_FROM` | Expéditeur des e-mails, sous la forme `Nom <adresse>`. Par défaut `Closyria <bonjour@closyria.com>`. | `Closyria <bonjour@closyria.com>` | idem |
| `S3_ENDPOINT` | Point d'accès du stockage OVH (S3). | `https://s3.gra.io.cloud.ovh.net` | idem |
| `S3_REGION` | Région OVH. | `gra` | `gra` |
| `S3_BUCKET` | Bucket des photos, **un par environnement**. | `closyria-prod` | `closyria-dev` |
| `S3_ACCESS_KEY_ID` | Identifiant de l'utilisateur S3 OVH de l'environnement. | (clé) | (clé) |
| `S3_SECRET_ACCESS_KEY` | Secret de cet utilisateur S3. | (secret) | (secret) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Facultatif : connexion avec Google. Les deux ensemble, ou aucune. | (Google Cloud) | (Google Cloud) |
| `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` | Facultatif : connexion avec Apple. Les deux ensemble, ou aucune. | (Apple Developer) | (Apple Developer) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Facultatif : notifications des alertes (Web Push). Les trois ensemble, ou aucune (sans elles, pas de notification). Voir « Clés des notifications (VAPID) ». | (clés prod), `https://closyria.com` | (clés dev, une autre paire), `https://closyria.com` |
| `INBOUND_EMAIL_SECRET` | Facultatif : réception des e-mails de commande (« Mes commandes par e-mail »). 64 caractères hexadécimaux, un par environnement ; sans lui, réception coupée. Posé par la commande de « Réception des e-mails de commande », jamais à la main. | (secret) | (secret, un autre) |
| `ANTHROPIC_API_KEY` | Facultatif (worker) : lecture par l'IA (Claude Haiku) des e-mails de commande qu'aucun format connu ne lit, dans la limite du plafond du mois (admin → « E-mails de commande », 10 € par défaut). Sans elle, ces e-mails restent « On n'a pas su lire cet e-mail » ; rien n'échoue. Voir « Clés du suivi des colis et de l'IA ». | (clé) | (clé, une autre) |
| `LAPOSTE_OKAPI_KEY` | Facultatif (worker) : suivi des colis Colissimo, Lettre suivie et Chronopost par l'API « Suivi » de La Poste (clé « Okapi », developer.laposte.fr). Sans elle, ces colis ne sont pas suivis (ils attendent, « Suivre chez le transporteur » reste) ; rien n'échoue. | (clé) | (clé, une autre si possible) |
| `TRACKING_AGGREGATOR_KEY` | Facultatif (worker) : suivi des autres transporteurs (Mondial Relay, GLS, DPD, Colis Privé, UPS, DHL) par l'agrégateur 17TRACK (clé « Security Key » du compte API, en-tête `17token`). Sans elle, ces colis ne sont pas suivis ; rien n'échoue. | (clé) | (clé) |
| `INBOUND_AUTOFORWARD` | Facultatif : `on` pour accepter le transfert automatique de Gmail ; `off` par défaut (voir « Réception des e-mails de commande »). | `off` | `off` (puis `on` pour l'essai) |
| `DEV_ACCESS_PASSWORD`, `DEV_ACCESS_TOKEN` | **Dev seulement** : le mot de passe de la page « Accès au site de test » et le jeton du cookie que Caddy laisse passer (Caddy le lit dans `/etc/caddy/closyria-dev.env`, jamais dans le Caddyfile). Les deux ensemble, ou aucune ; refusées en prod. Voir « Accès au site de test (dev) ». | (jamais) | (secrets) |

Exemple de `/etc/closyria/prod.env` (systemd ne comprend pas les commentaires en fin de ligne : un `# …` après une
valeur ferait partie de la valeur ; `BETTER_AUTH_SECRET` se génère avec `openssl rand -base64 48`) :

```bash
APP_ENV=prod
DATABASE_URL=postgresql:///closyria?host=/var/run/postgresql
BETTER_AUTH_SECRET=…
BETTER_AUTH_URL=https://closyria.com
SHARE_LINK_KEY=…
MAIL_TRANSPORT=brevo
BREVO_API_KEY=xkeysib-…
MAIL_FROM=Closyria <bonjour@closyria.com>
S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net
S3_REGION=gra
S3_BUCKET=closyria-prod
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

**Brevo** : l'adresse de `MAIL_FROM` doit être un expéditeur validé dans Brevo (Expéditeurs, domaines et IP dédiées),
et le domaine `closyria.com` **authentifié** : ajouter chez le registrar les enregistrements DNS que Brevo donne
(SPF, DKIM, et un enregistrement DMARC), puis cliquer sur « Vérifier » dans Brevo. Sans cela, les codes arrivent en
indésirables ou pas du tout.

**Photos** : le worker lit le même fichier d'environnement et a besoin des mêmes `S3_*` (copie des photos de capture). Sans les cinq variables `S3_*`, l'API refuse de démarrer hors développement ; les ajouter **avant** de
déployer. En développement local, sans elles, les photos restent en mémoire jusqu'au redémarrage. La politique de
sécurité des pages (`img-src` dans `apps/web/src/security-headers.ts`) autorise `https://s3.gra.io.cloud.ovh.net` :
changer de `S3_ENDPOINT` demande de la changer aussi.

**Google** (facultatif) : dans Google Cloud Console → API et services → Identifiants, créer un « ID client OAuth »
de type application Web, avec comme URI de redirection autorisée, exactement :
`https://closyria.com/api/auth/callback/google` (prod) et `https://dev.closyria.com/api/auth/callback/google` (dev).

**Apple** (facultatif) : dans Apple Developer, un Services ID (c'est `APPLE_CLIENT_ID`) avec le domaine et l'URL de
retour, exactement : `https://closyria.com/api/auth/callback/apple` (prod) et
`https://dev.closyria.com/api/auth/callback/apple` (dev). `APPLE_CLIENT_SECRET` est un jeton (JWT) signé avec la clé
privée Apple, valable **6 mois au plus** : noter dans l'agenda de le régénérer avant son expiration, sinon la
connexion avec Apple cesse de marcher du jour au lendemain.

Fuseau horaire : l'application ouvre toutes ses connexions à la base en UTC, quel que soit le réglage du serveur
PostgreSQL ; rien à configurer.

## Clés des notifications (VAPID)

Les notifications des alertes (taille revenue, prix visé, résumé du soir) passent par Web Push, signé avec une paire de
clés VAPID **propre à chaque environnement**. Trois variables, dans `/etc/closyria/<env>.env` :

| Variable | Valeur |
|---|---|
| `VAPID_PUBLIC_KEY` | Clé publique (base64url, 87 caractères, commence par `B`). Le site la lit par `GET /api/push/key`. |
| `VAPID_PRIVATE_KEY` | Clé privée (base64url, 43 caractères). **Secret** : jamais dans le dépôt, jamais affichée. |
| `VAPID_SUBJECT` | `https://closyria.com` (même valeur en dev : c'est le contact donné aux services de push). |

- **Tout ou rien** : les trois ensemble, ou aucune. S'il en manque une ou deux, l'API et le worker refusent de démarrer
  et le journal dit laquelle manque. Une valeur mal formée est refusée de la même façon.
- **Sans clés, les notifications sont simplement coupées** : le site ne propose pas « Activer les notifications », le
  worker n'envoie rien (les alertes restent visibles dans « Nouvelles » et en « une »). Rien d'autre ne change.
- **Ne jamais changer une paire en service** : les appareils déjà abonnés le sont avec l'ancienne clé publique et ne
  recevraient plus rien (il faudrait que chacune réactive ses notifications).
- **Redémarrer l'API et le worker** après l'ajout : ils ne lisent le fichier qu'au démarrage.

Les clés se génèrent avec `npx web-push generate-vapid-keys` (outil de la bibliothèque `web-push`, déjà utilisée par
le worker). Pour qu'elles ne s'affichent jamais à l'écran, on les génère et on les ajoute au fichier d'un seul geste :
**une seule commande par environnement**, à lancer une fois depuis le compte avec sudo. Elle s'arrête sans rien écrire
si le fichier contient déjà des clés VAPID, et sans rien écrire si la génération échoue (`npx` ou `node` en erreur, ou
résultat vide : elle le dit) ; sinon elle ajoute les trois lignes (précédées d'un saut de ligne, pour ne pas coller la
première à une dernière ligne qui n'en aurait pas), puis redémarre l'API et le worker. Les clés ne passent que par une
variable du shell, effacée à la fin.

**Toute commande à lancer une seule fois se donne dans UN SEUL message** : la commande entière, d'un bloc, prête à
copier ; jamais en morceaux répartis sur plusieurs messages (une moitié collée sans l'autre laisserait un fichier à
moitié rempli, que l'API refuserait au démarrage).

Dev :

```bash
F=/etc/closyria/dev.env; if sudo grep -q '^VAPID_' "$F"; then echo "Clés VAPID déjà présentes : rien n'est changé."; elif ! K="$(set -o pipefail; npx --yes web-push@4.0.0 generate-vapid-keys --json | node -e 'const k=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!k.publicKey||!k.privateKey)process.exit(1);process.stdout.write(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=https://closyria.com`)')" || [ -z "$K" ]; then echo "Échec : les clés VAPID n'ont pas été générées (npx ou node) ; rien n'est écrit." >&2; else printf '\n%s\n' "$K" | sudo tee -a "$F" >/dev/null && sudo systemctl restart closyria-dev-api closyria-dev-worker && echo "Clés VAPID ajoutées, API et worker redémarrés."; fi; unset K F
```

Prod (même commande, avec `prod`) :

```bash
F=/etc/closyria/prod.env; if sudo grep -q '^VAPID_' "$F"; then echo "Clés VAPID déjà présentes : rien n'est changé."; elif ! K="$(set -o pipefail; npx --yes web-push@4.0.0 generate-vapid-keys --json | node -e 'const k=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!k.publicKey||!k.privateKey)process.exit(1);process.stdout.write(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=https://closyria.com`)')" || [ -z "$K" ]; then echo "Échec : les clés VAPID n'ont pas été générées (npx ou node) ; rien n'est écrit." >&2; else printf '\n%s\n' "$K" | sudo tee -a "$F" >/dev/null && sudo systemctl restart closyria-prod-api closyria-prod-worker && echo "Clés VAPID ajoutées, API et worker redémarrés."; fi; unset K F
```

Vérifier ensuite (la clé publique seule, jamais la privée) :

```bash
curl -s http://127.0.0.1:3101/api/push/key          # (dev : sur le serveur ; de dehors, Caddy demande l'accès)
sudo journalctl -u closyria-dev-worker -n 50 --no-pager | grep -i vapid
```

## Réception des e-mails de commande

« Mes commandes par e-mail » donne à chacune une adresse (`marie-k7f2@commandes.closyria.com` en prod,
`…@commandes.dev.closyria.com` en dev) où elle transfère ses e-mails de commande. Pourquoi pas Brevo et comment le
tri est fait : `docs/specs/2026-11-14-apres-commande.md`, §10.1.

Comment ça marche :

- **Postfix**, sur la machine, reçoit les e-mails des deux domaines (port 25) et **n'envoie jamais rien** : pas de
  réponse, pas d'avis de non-remise (`default_transport = error`), pas de relais (`reject_unauth_destination`, même
  depuis la machine). Il refuse dès la réception un e-mail de plus de 2 Mo (2 048 000 octets), plus de 5
  destinataires par e-mail, et limite chaque serveur d'envoi (5 connexions à la fois ; par minute : 20 connexions,
  30 e-mails, 60 destinataires). Il ne dit pas quelles adresses existent : tout destinataire des deux domaines est
  accepté, l'API garde ou non ;
- pour chaque destinataire, Postfix lance le relais `/usr/local/lib/closyria/inbound-relay.mjs` (copie de
  `deploy/inbound/closyria-inbound-relay.mjs`, compte système `closyria-mx`, sans droits) qui remet le message brut et
  l'enveloppe SMTP (identifiant de file, adresse du serveur d'envoi, HELO, expéditeur, destinataire) à l'API de
  l'environnement, sur `127.0.0.1` (jamais par Caddy), **signés** avec le secret de l'environnement, lu dans
  `/etc/closyria-inbound/<env>.secret` (`/etc/closyria` n'est lisible que par root) ;
- l'API vérifie la signature, puis calcule elle-même DKIM, SPF, ARC et l'alignement à partir du message et de
  l'enveloppe (aucun en-tête du message n'est cru). Seuls les e-mails transférés depuis **son adresse vérifiée** sont
  gardés (brut dans le stockage S3 privé, 30 jours) ; les autres sont ignorés, sans réponse. Une panne DNS fait
  répondre 503 : Postfix réessaie plus tard. Une reprise du même e-mail (même identifiant de file) n'est gardée qu'une
  fois ;
- **sans `INBOUND_EMAIL_SECRET`, la réception est coupée** : `POST /api/inbound-email` répond 404 (une requête passée
  par Caddy aussi, toujours). Les adresses se créent quand même dans Compte → « Mes commandes par e-mail ».

| Variable | Valeur |
|---|---|
| `INBOUND_EMAIL_SECRET` | 64 caractères hexadécimaux (`openssl rand -hex 32`), **un par environnement**, le même que dans `/etc/closyria-inbound/<env>.secret` (dossier root:closyria-mx 750, fichier 640), que lit le relais. Facultatif : sans lui, réception coupée. |
| `INBOUND_AUTOFORWARD` | `off` (par défaut) ou `on` : accepter le transfert **automatique** de Gmail (adresse de transfert dans les réglages de Gmail). À laisser sur `off` tant qu'un vrai transfert automatique n'a pas été vérifié sur la dev (spec §10.1). Le transfert à la main marche dans les deux cas. |

**Données personnelles dans les journaux** : Postfix écrit, pour chaque e-mail, les adresses de l'expéditeur et du
destinataire et l'adresse IP du serveur d'envoi (jamais le contenu). Pour ne pas les laisser dans le journal de la
machine (journald, partagé, sans limite de durée par défaut), la commande envoie le journal de Postfix dans son
propre fichier, `/var/log/postfix-closyria.log` (`maillog_file`), tourné chaque jour et **effacé après 30 jours**
(`/etc/logrotate.d/postfix-closyria`). Seuls quelques messages de démarrage de Postfix restent dans journald. Le relais
n'écrit que `result=queued` (ou `ignored`, `dropped`…), sans adresse.

### 1. Le DNS, chez le registrar (la fondatrice, une fois)

Avant la commande. `mx.closyria.com` a la même adresse que `closyria.com` (la lire avec `dig +short closyria.com A`,
et `dig +short closyria.com AAAA` pour l'IPv6) ; le `TXT` dit que ces domaines n'envoient jamais d'e-mail (personne
ne peut écrire « de » ces adresses).

```text
mx.closyria.com.              A      <adresse IPv4 de closyria.com>
mx.closyria.com.              AAAA   <adresse IPv6 de closyria.com>      (seulement si closyria.com en a une)
commandes.closyria.com.       MX 10  mx.closyria.com.
commandes.closyria.com.       TXT    "v=spf1 -all"
commandes.dev.closyria.com.   MX 10  mx.closyria.com.
commandes.dev.closyria.com.   TXT    "v=spf1 -all"
```

**Ce qui est vraiment nécessaire pour recevoir seulement** :

- **obligatoire** : le `MX` de chaque domaine (`commandes.closyria.com`, `commandes.dev.closyria.com`) vers
  `mx.closyria.com`, et le `A` de `mx.closyria.com` (plus le `AAAA` seulement si la machine a une IPv6 publique : un
  `AAAA` qui ne mène pas à la machine ferait échouer une partie des envois vers nous) ;
- **recommandé, pas nécessaire à la réception** : le `TXT` `"v=spf1 -all"` de chaque domaine, qui dit au monde que ces
  adresses n'envoient jamais rien (un e-mail qui prétendrait venir d'elles est refusé ailleurs) ;
- **inutile** pour recevoir : DKIM, DMARC, le PTR (DNS inverse) de la machine et tout enregistrement de Brevo — ils
  ne servent qu'à **envoyer**, et ce serveur n'envoie rien. Les e-mails de Closyria (codes de connexion) continuent de
  partir par Brevo depuis `closyria.com`, sans rapport avec ces sous-domaines.

Compter quelques heures de propagation. Contrôle : `dig +short MX commandes.closyria.com` doit répondre
`10 mx.closyria.com.` (idem pour `commandes.dev.closyria.com`). Chez OVH, le port 25 entrant d'un VPS est ouvert ;
la commande ouvre aussi le pare-feu `ufw` s'il est actif.

### 2. La commande, une par environnement, d'un bloc

À lancer depuis la racine du dépôt à jour, avec le compte qui a sudo, **après** avoir déployé dans cet environnement
la version qui contient la réception, la dev d'abord. Chaque commande se donne **dans un seul message**, entière.
Elle :

1. vérifie avant tout que le dépôt est à jour, que le DNS du domaine pointe vers `mx.closyria.com`, que l'API de
   l'environnement connaît la réception, que `INBOUND_EMAIL_SECRET` n'est pas déjà là, **qu'aucun autre serveur
   d'e-mail n'est installé** (exim4, nullmailer, msmtp-mta, dma, opensmtpd, sendmail), que Postfix, s'il est déjà
   installé, vient de cette commande, et sinon que rien n'écoute sur le port 25. Au moindre doute elle s'arrête sans
   rien changer (la machine est partagée) ;
2. installe Postfix s'il manque (sans question), **après une simulation** (`apt-get -s`) : si l'installation devait
   retirer le moindre paquet, elle s'arrête sans rien changer ; puis **garde une copie** de `main.cf` et `master.cf`
   (`….avant-closyria-<env>.<date>`), crée le compte `closyria-mx`, copie le relais, crée `/etc/closyria-inbound` ;
3. tire le secret (`openssl rand -hex 32`), l'écrit dans `/etc/closyria-inbound/<env>.secret` et dans
   `/etc/closyria/<env>.env` (par l'entrée standard, jamais affiché ni en argument), redémarre l'API et vérifie que la
   réception répond ;
4. règle Postfix (réception seulement, le domaine de l'environnement ajouté à ceux déjà reçus, limites de débit,
   journal à part), le fait vérifier par `postfix check`, ouvre le port 25 dans `ufw` s'il est actif, redémarre
   Postfix et contrôle qu'il écoute ;
5. **essai de bout en bout** : lance le relais avec le compte `closyria-mx` et la protection mémoire de Postfix (`MemoryDenyWriteExecute`, d'où `node --jitless`), comme Postfix le fera, sur un e-mail
   d'essai pour une adresse qui n'existe pas. Il doit finir sans erreur et l'API répondre `dropped` (signature
   acceptée, secret lisible par le relais).

**À partir de l'étape 3, tout échec la fait revenir en arrière d'elle-même** : secret retiré des deux fichiers,
`main.cf` et `master.cf` d'avant remis, domaine retiré de la table, règle `ufw` du port 25 et rotation du journal
retirées si c'est cet essai qui les a créées, API et Postfix redémarrés (Postfix arrêté s'il vient d'être installé).
Le message dit ce qui a raté.

Dev :

```bash
(
set -uo pipefail
ENV=dev; DOMAIN=commandes.dev.closyria.com; PORT=3101
R=deploy/inbound/closyria-inbound-relay.mjs; E=/etc/closyria/$ENV.env; KD=/etc/closyria-inbound; K=$KD/$ENV.secret
RELAY=/usr/local/lib/closyria/inbound-relay.mjs; MAP=/etc/postfix/closyria-transport
MAIN=/etc/postfix/main.cf; MASTER=/etc/postfix/master.cf; ROT=/etc/logrotate.d/postfix-closyria
STAMP="$(date +%Y%m%d-%H%M%S)"; FRESH=no; UFW_ADDED=no; ROT_CREATED=no
stop() { echo "$1" >&2; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: message/rfc822' --data-binary x "$1"; }
installed() { [ "$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null)" = "install ok installed" ]; }
# 1. Vérifications, avant tout changement.
[ -f "$R" ] || stop "Lancer depuis la racine du dépôt Closyria à jour : $R introuvable. Rien n'est changé."
grep -q 'closyria-inbound/' "$R" || stop "$R n'est pas la bonne version : mettre le dépôt à jour. Rien n'est changé."
command -v dig >/dev/null || stop "dig manque (sudo apt-get install -y dnsutils) : rien n'est changé."
[ "$(dig +short MX "$DOMAIN")" = "10 mx.closyria.com." ] || stop "Le DNS de $DOMAIN ne donne pas encore « 10 mx.closyria.com. » : rien n'est changé."
[ "$(code "http://127.0.0.1:$PORT/api/me/order-inbox")" = 401 ] || stop "L'API $ENV ne connaît pas la réception : déployer d'abord la version qui la contient. Rien n'est changé."
sudo grep -q '^INBOUND_EMAIL_SECRET=' "$E" && stop "INBOUND_EMAIL_SECRET déjà dans $E : rien n'est changé."
sudo test -e "$K" && stop "$K existe déjà : rien n'est changé."
for p in exim4-base exim4-daemon-light exim4-daemon-heavy nullmailer msmtp-mta dma opensmtpd sendmail-bin sendmail; do
  installed "$p" && stop "Un autre serveur d'e-mail est installé ($p) : rien n'est changé. En parler avant."
done
if [ -x /usr/sbin/postconf ]; then
  sudo grep -q '^# closyria-inbound' "$MAIN" 2>/dev/null || stop "Postfix est déjà installé, pas par cette commande ($MAIN) : rien n'est changé. En parler avant."
else
  [ -n "$(ss -ltnH 'sport = :25')" ] && stop "Quelque chose écoute déjà sur le port 25 : rien n'est changé. En parler avant."
fi
# 2. Postfix (sans question s'il manque), une copie de ses réglages, le compte et le relais, le dossier du secret.
if [ ! -x /usr/sbin/postconf ]; then
  # Simulation d'abord (apt-get -s) : l'installation ne doit retirer aucun paquet de la machine partagée.
  SIM="$(apt-get -s install -y postfix ssl-cert 2>&1)" || stop "La simulation de l'installation de Postfix (apt-get -s) a échoué : rien n'est changé."
  GONE="$(printf '%s\n' "$SIM" | awk '/^(Remv|Purg) /{print $2}' | paste -sd' ')"
  [ -z "$GONE" ] || stop "Installer Postfix retirerait des paquets ($GONE) : rien n'est changé. En parler avant."
  echo "postfix postfix/main_mailer_type select No configuration" | sudo debconf-set-selections
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postfix ssl-cert || stop "Installation de Postfix impossible : $E n'est pas changé."
  FRESH=yes
  sudo systemctl stop postfix 2>/dev/null
fi
sudo test -f "$MAIN" || sudo cp /usr/share/postfix/main.cf.debian "$MAIN" || stop "Création de $MAIN impossible : $E n'est pas changé."
sudo grep -q '^# closyria-inbound' "$MAIN" || printf '\n# closyria-inbound : réception des e-mails de commande (deploy/README.md)\n' | sudo tee -a "$MAIN" >/dev/null
sudo cp -p "$MAIN" "$MAIN.avant-closyria-$ENV.$STAMP" && sudo cp -p "$MASTER" "$MASTER.avant-closyria-$ENV.$STAMP" || stop "Copie de sûreté des réglages de Postfix impossible : $E n'est pas changé."
id closyria-mx >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin closyria-mx || stop "Création du compte closyria-mx impossible : $E n'est pas changé."
sudo install -D -o root -g root -m 755 "$R" "$RELAY" || stop "Copie du relais impossible : $E n'est pas changé."
sudo install -d -o root -g closyria-mx -m 750 "$KD" || stop "Création de $KD impossible : $E n'est pas changé."
# 3. Le secret, pour le relais et pour l'API (jamais affiché ni en argument), puis l'API redémarrée et vérifiée.
undo() {
  echo "Retour en arrière : secret retiré, réglages de Postfix d'avant remis (et la règle ufw, la rotation du journal s'ils viennent de cet essai), API et Postfix redémarrés." >&2
  sudo sed -i '/^INBOUND_EMAIL_SECRET=/d' "$E"; sudo rm -f "$K"
  sudo cp -p "$MAIN.avant-closyria-$ENV.$STAMP" "$MAIN"; sudo cp -p "$MASTER.avant-closyria-$ENV.$STAMP" "$MASTER"
  if sudo test -f "$MAP"; then sudo sed -i "/^${DOMAIN//./\\.} /d" "$MAP"; sudo postmap "$MAP"; fi
  sudo systemctl restart "closyria-$ENV-api"
  if [ "$UFW_ADDED" = yes ]; then sudo ufw delete allow 25/tcp >/dev/null; fi
  if [ "$ROT_CREATED" = yes ]; then sudo rm -f "$ROT"; fi
  if [ "$FRESH" = yes ]; then sudo systemctl stop postfix; else sudo systemctl restart postfix; fi
  stop "$1 Rien n'est resté de cet essai (Postfix, s'il vient d'être installé, reste installé mais arrêté : voir « Tout retirer »)."
}
T="$(openssl rand -hex 32)" && [ "${#T}" = 64 ] || stop "openssl n'a pas donné de secret : $E n'est pas changé."
printf '%s\n' "$T" | (umask 077; sudo tee "$K" >/dev/null) && sudo chown root:closyria-mx "$K" && sudo chmod 640 "$K" || undo "Écriture de $K impossible."
printf '\nINBOUND_EMAIL_SECRET=%s\n' "$T" | sudo tee -a "$E" >/dev/null || undo "Écriture dans $E impossible."
unset T
sudo systemctl restart "closyria-$ENV-api" || undo "closyria-$ENV-api ne redémarre pas (sudo journalctl -u closyria-$ENV-api -n 50)."
A=000; for _ in $(seq 30); do A="$(code "http://127.0.0.1:$PORT/api/inbound-email")"; [ "$A" = 401 ] && break; sleep 1; done
[ "$A" = 401 ] || undo "La réception ne répond pas (réponse $A au lieu de 401 ; sudo journalctl -u closyria-$ENV-api -n 50)."
# 4. Postfix : réception seulement, jamais d'envoi ni de relais, débit limité, son propre journal (30 jours).
sudo touch "$MAP" && { sudo grep -q "^${DOMAIN//./\\.} " "$MAP" || echo "$DOMAIN closyria-$ENV:" | sudo tee -a "$MAP" >/dev/null; } || undo "Écriture de $MAP impossible."
sudo postmap "$MAP" || undo "postmap $MAP a échoué."
sudo postconf -e "myhostname = mx.closyria.com" "mydomain = closyria.com" "myorigin = \$myhostname" \
  "inet_interfaces = all" "inet_protocols = all" "mynetworks = 127.0.0.0/8 [::1]/128" \
  "mydestination =" "local_recipient_maps =" "local_transport = error:5.1.1 aucune boite locale" \
  "relay_domains = $(sudo awk '{print $1}' "$MAP" | paste -sd' ')" "relay_recipient_maps =" "transport_maps = hash:$MAP" \
  "default_transport = error:5.7.1 ce serveur n'envoie pas d'e-mails" "relay_transport = error:5.7.1 ce serveur n'envoie pas d'e-mails" \
  "smtpd_relay_restrictions = reject_unauth_destination" "smtpd_recipient_restrictions = reject_unauth_destination" \
  "smtpd_helo_required = yes" "disable_vrfy_command = yes" "smtpd_banner = \$myhostname ESMTP" \
  "message_size_limit = 2048000" "mailbox_size_limit = 0" "smtpd_recipient_limit = 5" \
  "smtpd_client_connection_count_limit = 5" "smtpd_client_connection_rate_limit = 20" \
  "smtpd_client_message_rate_limit = 30" "smtpd_client_recipient_rate_limit = 60" "anvil_rate_time_unit = 60s" \
  "smtpd_tls_security_level = may" "smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem" \
  "smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key" "smtp_tls_security_level = none" \
  "maillog_file = /var/log/postfix-closyria.log" "enable_long_queue_ids = yes" "biff = no" \
  "closyria-${ENV}_destination_recipient_limit = 1" || undo "Réglage de Postfix impossible ($MAIN)."
sudo postconf -M "postlog/unix-dgram=postlog unix-dgram n - n - 1 postlogd" || undo "Réglage du journal de Postfix impossible (master.cf)."
sudo postconf -M "closyria-$ENV/unix=closyria-$ENV unix - n n - 4 pipe user=closyria-mx null_sender= argv=/usr/bin/node --jitless $RELAY $ENV \${queue_id} \${sender} \${client_address} \${client_helo} \${recipient}" || undo "Réglage de Postfix impossible (master.cf)."
sudo test -e "$ROT" || ROT_CREATED=yes
printf '/var/log/postfix-closyria.log {\n  daily\n  rotate 30\n  maxage 30\n  missingok\n  notifempty\n  compress\n  copytruncate\n}\n' | sudo tee "$ROT" >/dev/null || undo "Écriture de $ROT impossible."
sudo postfix check || undo "postfix check refuse le réglage (détail ci-dessus)."
UFW="$(sudo ufw status 2>/dev/null)"
if grep -q '^Status: active' <<<"$UFW" && ! grep -qE '^25/tcp +ALLOW' <<<"$UFW"; then
  sudo ufw allow 25/tcp >/dev/null && UFW_ADDED=yes || undo "ufw n'ouvre pas le port 25."
fi
sudo systemctl enable postfix >/dev/null 2>&1; sudo systemctl restart postfix || undo "Postfix ne redémarre pas (sudo journalctl -u postfix@- -n 50)."
sleep 2; [ -n "$(ss -ltnH 'sport = :25')" ] || undo "Postfix n'écoute pas sur le port 25 (sudo tail -n 50 /var/log/postfix-closyria.log)."
# 5. De bout en bout : le relais, avec le compte de Postfix, signe et remet un e-mail à une adresse inconnue.
OUT="$(printf 'From: verification@closyria.com\r\nSubject: verification\r\n\r\nverification\r\n' | sudo systemd-run --quiet --pipe --wait --collect -p User=closyria-mx -p MemoryDenyWriteExecute=yes /usr/bin/node --jitless "$RELAY" "$ENV" "VERIF$(openssl rand -hex 6)" "" 127.0.0.1 localhost "verification-$(openssl rand -hex 4)@$DOMAIN" 2>&1)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "result=dropped" ] || undo "Essai de bout en bout raté : le relais répond « $OUT » (code $RC) au lieu de « result=dropped »."
echo "C'est fait : $DOMAIN reçoit les e-mails (domaines reçus : $(/usr/sbin/postconf -h relay_domains))."
echo "Copies des réglages d'avant : $MAIN.avant-closyria-$ENV.$STAMP et $MASTER.avant-closyria-$ENV.$STAMP."
echo "Essai réel : Compte → « Mes commandes par e-mail », copier l'adresse, y transférer un e-mail de commande depuis l'adresse du compte."
)
```

Prod (même commande ; seule la deuxième ligne change) :

```bash
(
set -uo pipefail
ENV=prod; DOMAIN=commandes.closyria.com; PORT=3001
R=deploy/inbound/closyria-inbound-relay.mjs; E=/etc/closyria/$ENV.env; KD=/etc/closyria-inbound; K=$KD/$ENV.secret
RELAY=/usr/local/lib/closyria/inbound-relay.mjs; MAP=/etc/postfix/closyria-transport
MAIN=/etc/postfix/main.cf; MASTER=/etc/postfix/master.cf; ROT=/etc/logrotate.d/postfix-closyria
STAMP="$(date +%Y%m%d-%H%M%S)"; FRESH=no; UFW_ADDED=no; ROT_CREATED=no
stop() { echo "$1" >&2; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: message/rfc822' --data-binary x "$1"; }
installed() { [ "$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null)" = "install ok installed" ]; }
# 1. Vérifications, avant tout changement.
[ -f "$R" ] || stop "Lancer depuis la racine du dépôt Closyria à jour : $R introuvable. Rien n'est changé."
grep -q 'closyria-inbound/' "$R" || stop "$R n'est pas la bonne version : mettre le dépôt à jour. Rien n'est changé."
command -v dig >/dev/null || stop "dig manque (sudo apt-get install -y dnsutils) : rien n'est changé."
[ "$(dig +short MX "$DOMAIN")" = "10 mx.closyria.com." ] || stop "Le DNS de $DOMAIN ne donne pas encore « 10 mx.closyria.com. » : rien n'est changé."
[ "$(code "http://127.0.0.1:$PORT/api/me/order-inbox")" = 401 ] || stop "L'API $ENV ne connaît pas la réception : déployer d'abord la version qui la contient. Rien n'est changé."
sudo grep -q '^INBOUND_EMAIL_SECRET=' "$E" && stop "INBOUND_EMAIL_SECRET déjà dans $E : rien n'est changé."
sudo test -e "$K" && stop "$K existe déjà : rien n'est changé."
for p in exim4-base exim4-daemon-light exim4-daemon-heavy nullmailer msmtp-mta dma opensmtpd sendmail-bin sendmail; do
  installed "$p" && stop "Un autre serveur d'e-mail est installé ($p) : rien n'est changé. En parler avant."
done
if [ -x /usr/sbin/postconf ]; then
  sudo grep -q '^# closyria-inbound' "$MAIN" 2>/dev/null || stop "Postfix est déjà installé, pas par cette commande ($MAIN) : rien n'est changé. En parler avant."
else
  [ -n "$(ss -ltnH 'sport = :25')" ] && stop "Quelque chose écoute déjà sur le port 25 : rien n'est changé. En parler avant."
fi
# 2. Postfix (sans question s'il manque), une copie de ses réglages, le compte et le relais, le dossier du secret.
if [ ! -x /usr/sbin/postconf ]; then
  # Simulation d'abord (apt-get -s) : l'installation ne doit retirer aucun paquet de la machine partagée.
  SIM="$(apt-get -s install -y postfix ssl-cert 2>&1)" || stop "La simulation de l'installation de Postfix (apt-get -s) a échoué : rien n'est changé."
  GONE="$(printf '%s\n' "$SIM" | awk '/^(Remv|Purg) /{print $2}' | paste -sd' ')"
  [ -z "$GONE" ] || stop "Installer Postfix retirerait des paquets ($GONE) : rien n'est changé. En parler avant."
  echo "postfix postfix/main_mailer_type select No configuration" | sudo debconf-set-selections
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postfix ssl-cert || stop "Installation de Postfix impossible : $E n'est pas changé."
  FRESH=yes
  sudo systemctl stop postfix 2>/dev/null
fi
sudo test -f "$MAIN" || sudo cp /usr/share/postfix/main.cf.debian "$MAIN" || stop "Création de $MAIN impossible : $E n'est pas changé."
sudo grep -q '^# closyria-inbound' "$MAIN" || printf '\n# closyria-inbound : réception des e-mails de commande (deploy/README.md)\n' | sudo tee -a "$MAIN" >/dev/null
sudo cp -p "$MAIN" "$MAIN.avant-closyria-$ENV.$STAMP" && sudo cp -p "$MASTER" "$MASTER.avant-closyria-$ENV.$STAMP" || stop "Copie de sûreté des réglages de Postfix impossible : $E n'est pas changé."
id closyria-mx >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin closyria-mx || stop "Création du compte closyria-mx impossible : $E n'est pas changé."
sudo install -D -o root -g root -m 755 "$R" "$RELAY" || stop "Copie du relais impossible : $E n'est pas changé."
sudo install -d -o root -g closyria-mx -m 750 "$KD" || stop "Création de $KD impossible : $E n'est pas changé."
# 3. Le secret, pour le relais et pour l'API (jamais affiché ni en argument), puis l'API redémarrée et vérifiée.
undo() {
  echo "Retour en arrière : secret retiré, réglages de Postfix d'avant remis (et la règle ufw, la rotation du journal s'ils viennent de cet essai), API et Postfix redémarrés." >&2
  sudo sed -i '/^INBOUND_EMAIL_SECRET=/d' "$E"; sudo rm -f "$K"
  sudo cp -p "$MAIN.avant-closyria-$ENV.$STAMP" "$MAIN"; sudo cp -p "$MASTER.avant-closyria-$ENV.$STAMP" "$MASTER"
  if sudo test -f "$MAP"; then sudo sed -i "/^${DOMAIN//./\\.} /d" "$MAP"; sudo postmap "$MAP"; fi
  sudo systemctl restart "closyria-$ENV-api"
  if [ "$UFW_ADDED" = yes ]; then sudo ufw delete allow 25/tcp >/dev/null; fi
  if [ "$ROT_CREATED" = yes ]; then sudo rm -f "$ROT"; fi
  if [ "$FRESH" = yes ]; then sudo systemctl stop postfix; else sudo systemctl restart postfix; fi
  stop "$1 Rien n'est resté de cet essai (Postfix, s'il vient d'être installé, reste installé mais arrêté : voir « Tout retirer »)."
}
T="$(openssl rand -hex 32)" && [ "${#T}" = 64 ] || stop "openssl n'a pas donné de secret : $E n'est pas changé."
printf '%s\n' "$T" | (umask 077; sudo tee "$K" >/dev/null) && sudo chown root:closyria-mx "$K" && sudo chmod 640 "$K" || undo "Écriture de $K impossible."
printf '\nINBOUND_EMAIL_SECRET=%s\n' "$T" | sudo tee -a "$E" >/dev/null || undo "Écriture dans $E impossible."
unset T
sudo systemctl restart "closyria-$ENV-api" || undo "closyria-$ENV-api ne redémarre pas (sudo journalctl -u closyria-$ENV-api -n 50)."
A=000; for _ in $(seq 30); do A="$(code "http://127.0.0.1:$PORT/api/inbound-email")"; [ "$A" = 401 ] && break; sleep 1; done
[ "$A" = 401 ] || undo "La réception ne répond pas (réponse $A au lieu de 401 ; sudo journalctl -u closyria-$ENV-api -n 50)."
# 4. Postfix : réception seulement, jamais d'envoi ni de relais, débit limité, son propre journal (30 jours).
sudo touch "$MAP" && { sudo grep -q "^${DOMAIN//./\\.} " "$MAP" || echo "$DOMAIN closyria-$ENV:" | sudo tee -a "$MAP" >/dev/null; } || undo "Écriture de $MAP impossible."
sudo postmap "$MAP" || undo "postmap $MAP a échoué."
sudo postconf -e "myhostname = mx.closyria.com" "mydomain = closyria.com" "myorigin = \$myhostname" \
  "inet_interfaces = all" "inet_protocols = all" "mynetworks = 127.0.0.0/8 [::1]/128" \
  "mydestination =" "local_recipient_maps =" "local_transport = error:5.1.1 aucune boite locale" \
  "relay_domains = $(sudo awk '{print $1}' "$MAP" | paste -sd' ')" "relay_recipient_maps =" "transport_maps = hash:$MAP" \
  "default_transport = error:5.7.1 ce serveur n'envoie pas d'e-mails" "relay_transport = error:5.7.1 ce serveur n'envoie pas d'e-mails" \
  "smtpd_relay_restrictions = reject_unauth_destination" "smtpd_recipient_restrictions = reject_unauth_destination" \
  "smtpd_helo_required = yes" "disable_vrfy_command = yes" "smtpd_banner = \$myhostname ESMTP" \
  "message_size_limit = 2048000" "mailbox_size_limit = 0" "smtpd_recipient_limit = 5" \
  "smtpd_client_connection_count_limit = 5" "smtpd_client_connection_rate_limit = 20" \
  "smtpd_client_message_rate_limit = 30" "smtpd_client_recipient_rate_limit = 60" "anvil_rate_time_unit = 60s" \
  "smtpd_tls_security_level = may" "smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem" \
  "smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key" "smtp_tls_security_level = none" \
  "maillog_file = /var/log/postfix-closyria.log" "enable_long_queue_ids = yes" "biff = no" \
  "closyria-${ENV}_destination_recipient_limit = 1" || undo "Réglage de Postfix impossible ($MAIN)."
sudo postconf -M "postlog/unix-dgram=postlog unix-dgram n - n - 1 postlogd" || undo "Réglage du journal de Postfix impossible (master.cf)."
sudo postconf -M "closyria-$ENV/unix=closyria-$ENV unix - n n - 4 pipe user=closyria-mx null_sender= argv=/usr/bin/node --jitless $RELAY $ENV \${queue_id} \${sender} \${client_address} \${client_helo} \${recipient}" || undo "Réglage de Postfix impossible (master.cf)."
sudo test -e "$ROT" || ROT_CREATED=yes
printf '/var/log/postfix-closyria.log {\n  daily\n  rotate 30\n  maxage 30\n  missingok\n  notifempty\n  compress\n  copytruncate\n}\n' | sudo tee "$ROT" >/dev/null || undo "Écriture de $ROT impossible."
sudo postfix check || undo "postfix check refuse le réglage (détail ci-dessus)."
UFW="$(sudo ufw status 2>/dev/null)"
if grep -q '^Status: active' <<<"$UFW" && ! grep -qE '^25/tcp +ALLOW' <<<"$UFW"; then
  sudo ufw allow 25/tcp >/dev/null && UFW_ADDED=yes || undo "ufw n'ouvre pas le port 25."
fi
sudo systemctl enable postfix >/dev/null 2>&1; sudo systemctl restart postfix || undo "Postfix ne redémarre pas (sudo journalctl -u postfix@- -n 50)."
sleep 2; [ -n "$(ss -ltnH 'sport = :25')" ] || undo "Postfix n'écoute pas sur le port 25 (sudo tail -n 50 /var/log/postfix-closyria.log)."
# 5. De bout en bout : le relais, avec le compte de Postfix, signe et remet un e-mail à une adresse inconnue.
OUT="$(printf 'From: verification@closyria.com\r\nSubject: verification\r\n\r\nverification\r\n' | sudo systemd-run --quiet --pipe --wait --collect -p User=closyria-mx -p MemoryDenyWriteExecute=yes /usr/bin/node --jitless "$RELAY" "$ENV" "VERIF$(openssl rand -hex 6)" "" 127.0.0.1 localhost "verification-$(openssl rand -hex 4)@$DOMAIN" 2>&1)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "result=dropped" ] || undo "Essai de bout en bout raté : le relais répond « $OUT » (code $RC) au lieu de « result=dropped »."
echo "C'est fait : $DOMAIN reçoit les e-mails (domaines reçus : $(/usr/sbin/postconf -h relay_domains))."
echo "Copies des réglages d'avant : $MAIN.avant-closyria-$ENV.$STAMP et $MASTER.avant-closyria-$ENV.$STAMP."
echo "Essai réel : Compte → « Mes commandes par e-mail », copier l'adresse, y transférer un e-mail de commande depuis l'adresse du compte."
)
```

**Si la commande s'est arrêtée** : aux étapes 1 et 2, rien n'a changé dans `/etc/closyria/` ; corriger ce qu'elle dit
et la relancer (Postfix déjà installé par un premier essai est repris tel quel). Après, elle est revenue en arrière :
corriger d'après son message (et `sudo journalctl -u closyria-<env>-api -n 50` ou
`sudo tail -n 50 /var/log/postfix-closyria.log`), puis la relancer.

**Ensuite** :

- journal de la réception : `sudo tail -n 50 /var/log/postfix-closyria.log` (une ligne `status=sent (delivered via
  closyria-<env> service (result=…))` par e-mail remis à l'API ; `status=deferred` si l'API ne répondait pas ou si le
  DNS était en panne : Postfix réessaie seul pendant 5 jours, puis abandonne sans réponse) et
  `sudo journalctl -u closyria-<env>-api -n 50 | grep inbound` ;
- **ne pas changer un secret en service sans changer les deux fichiers** : le relais lit
  `/etc/closyria-inbound/<env>.secret` à chaque e-mail, l'API `INBOUND_EMAIL_SECRET` au démarrage. S'ils diffèrent, les
  e-mails restent en file chez Postfix (réessayés) jusqu'à ce qu'ils concordent ;
- **mettre à jour le relais** (s'il change dans le dépôt) : `sudo install -o root -g root -m 755
  deploy/inbound/closyria-inbound-relay.mjs /usr/local/lib/closyria/inbound-relay.mjs` (pris au prochain e-mail).

### 3. Retirer la réception

**Un environnement** (ici la dev ; pour la prod, `ENV=prod; DOMAIN=commandes.closyria.com`), d'un bloc : retire son
secret des deux fichiers, redémarre son API, retire son domaine de Postfix (le reste de Postfix ne change pas).

```bash
(
set -uo pipefail
ENV=dev; DOMAIN=commandes.dev.closyria.com
MAP=/etc/postfix/closyria-transport; MAIN=/etc/postfix/main.cf
stop() { echo "$1" >&2; exit 1; }
sudo grep -q '^# closyria-inbound' "$MAIN" 2>/dev/null || stop "Postfix ne vient pas de la commande Closyria ($MAIN) : rien n'est changé."
sudo sed -i '/^INBOUND_EMAIL_SECRET=/d' "/etc/closyria/$ENV.env" && sudo rm -f "/etc/closyria-inbound/$ENV.secret" || stop "Retrait du secret impossible."
sudo systemctl restart "closyria-$ENV-api" || echo "closyria-$ENV-api ne redémarre pas : sudo journalctl -u closyria-$ENV-api -n 50" >&2
sudo sed -i "/^${DOMAIN//./\\.} /d" "$MAP" && sudo postmap "$MAP" || stop "Retrait de $DOMAIN dans $MAP impossible."
sudo postconf -e "relay_domains = $(sudo awk '{print $1}' "$MAP" | paste -sd' ')" || stop "Réglage de relay_domains impossible."
sudo postconf -X "closyria-${ENV}_destination_recipient_limit"; sudo postconf -MX "closyria-$ENV/unix"
sudo postfix check && sudo systemctl reload postfix || stop "postfix check refuse le réglage : voir ci-dessus."
echo "$DOMAIN ne reçoit plus rien (les e-mails déjà en file sont abandonnés sans réponse)."
)
```

**Tout** (les deux environnements, Postfix compris), d'un bloc : retire les secrets et redémarre les deux API, arrête
et désinstalle Postfix (`apt-get purge`, seulement si sa simulation `apt-get -s` ne retire **aucun autre paquet** :
sinon elle s'arrête avant tout changement et dit lesquels ; ses réglages partent avec : copier avant les `….avant-closyria-*` de `/etc/postfix`
si on veut les garder), ferme le port 25 dans `ufw`, efface le dossier du secret, le relais, le journal et sa
rotation, et le compte `closyria-mx`. Elle refuse de toucher un Postfix qui ne vient pas de la commande d'installation.

```bash
(
set -uo pipefail
MAIN=/etc/postfix/main.cf
stop() { echo "$1" >&2; exit 1; }
sudo grep -q '^# closyria-inbound' "$MAIN" 2>/dev/null || stop "Postfix ne vient pas de la commande Closyria ($MAIN) : rien n'est changé."
# Simulation d'abord (apt-get -s) : retirer Postfix ne doit retirer aucun autre paquet de la machine partagée.
SIM="$(apt-get -s purge -y postfix 2>&1)" || stop "La simulation du retrait de Postfix (apt-get -s) a échoué : rien n'est changé."
OTHERS="$(printf '%s\n' "$SIM" | awk '/^(Remv|Purg) /{print $2}' | grep -vx postfix | paste -sd' ')"
[ -z "$OTHERS" ] || stop "Retirer Postfix retirerait aussi : $OTHERS. Rien n'est changé. En parler avant."
for ENV in dev prod; do sudo sed -i '/^INBOUND_EMAIL_SECRET=/d' "/etc/closyria/$ENV.env"; done
sudo systemctl restart closyria-dev-api closyria-prod-api
sudo systemctl stop postfix
sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y postfix || stop "apt-get purge postfix a échoué : le reste n'est pas touché, relancer après avoir lu l'erreur."
if grep -q '^Status: active' <<<"$(sudo ufw status 2>/dev/null)"; then sudo ufw delete allow 25/tcp >/dev/null; fi
sudo rm -rf /etc/postfix /etc/closyria-inbound /usr/local/lib/closyria/inbound-relay.mjs /etc/logrotate.d/postfix-closyria /var/log/postfix-closyria.log*
if id closyria-mx >/dev/null 2>&1; then sudo userdel closyria-mx; fi
echo "Tout est retiré : plus de serveur d'e-mail ni de port 25, secrets, relais, compte et journal effacés. Les MX peuvent être retirés chez le registrar."
)
```

## Clés du suivi des colis et de l'IA

« Après la commande » a trois clés facultatives de plus, toutes lues par le **worker** au démarrage, dans
`/etc/closyria/<env>.env` (spec `docs/specs/2026-11-14-apres-commande.md`, §10.2, §10.4 et §10.7) :

| Variable | D'où elle vient | Sans elle |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys (une clé par environnement, commence par `sk-ant-`). Mettre aussi une limite de dépense mensuelle dans la console : c'est une seconde barrière, derrière le plafond de l'admin. | Les e-mails que les formats connus ne lisent pas restent « On n'a pas su lire cet e-mail ». |
| `LAPOSTE_OKAPI_KEY` | developer.laposte.fr → l'API « Suivi » (v2), sa clé « Okapi ». | Colissimo, Lettre suivie et Chronopost ne sont pas suivis (« Suivre chez le transporteur » reste). |
| `TRACKING_AGGREGATOR_KEY` | 17TRACK → compte API → « Security Key » (en-tête `17token`). | Mondial Relay, GLS, DPD, Colis Privé, UPS et DHL ne sont pas suivis. |

`INBOUND_EMAIL_SECRET` (la réception) **n'est pas** dans cette commande : il est tiré sur la machine et posé par la
commande de « Réception des e-mails de commande » (étape 3), jamais à la main ni recopié.

Ces clés viennent de comptes extérieurs : elles ne peuvent pas être tirées sur la machine. La commande les **demande**
une à une, sans les afficher (`read -s` : rien ne s'écrit à l'écran ni dans l'historique), refuse une clé mal formée
avant d'écrire quoi que ce soit, n'ajoute que celles qui manquent (une clé déjà là est gardée, jamais remplacée),
puis redémarre le worker et dit quelles fonctions sont en service. Si le worker ne redémarre pas, elle retire ce
qu'elle vient d'ajouter et le redémarre comme avant. Entrée vide : la clé est passée (à ajouter plus tard en relançant
la même commande). Une commande par environnement, **dans un seul message**, d'un bloc.

Dev :

```bash
(
set -uo pipefail
ENV=dev; E=/etc/closyria/$ENV.env; W=closyria-$ENV-worker
stop() { echo "$1" >&2; exit 1; }
sudo test -f "$E" || stop "$E introuvable : rien n'est changé."
LINES=""; ADDED=""
for NAME in ANTHROPIC_API_KEY LAPOSTE_OKAPI_KEY TRACKING_AGGREGATOR_KEY; do
  if sudo grep -q "^$NAME=" "$E"; then echo "$NAME : déjà là, gardée."; continue; fi
  printf "%s (coller la clé puis Entrée ; rien ne s'affiche ; Entrée seule : passer) : " "$NAME" >&2
  IFS= read -rs V; echo >&2
  V="${V//[[:space:]]/}"
  [ -z "$V" ] && { echo "$NAME : passée."; continue; }
  [[ "$V" =~ ^[A-Za-z0-9._~+/=-]{16,300}$ ]] || { unset V LINES; stop "$NAME : la clé collée n'a pas la forme d'une clé (caractères ou longueur) : rien n'est écrit."; }
  [ "$NAME" != ANTHROPIC_API_KEY ] || [[ "$V" == sk-ant-* ]] || { unset V LINES; stop "ANTHROPIC_API_KEY doit commencer par sk-ant- : rien n'est écrit."; }
  LINES+="$NAME=$V"$'\n'; ADDED+="$NAME "
done
unset V
[ -n "$LINES" ] || stop "Aucune clé à ajouter : rien n'est changé."
# Un saut de ligne seulement si le fichier n'en a pas à la fin (relancée, la commande n'ajoute pas de lignes vides).
{ sudo tail -c1 "$E" | grep -q . && printf '\n'; printf '%s' "$LINES"; } | sudo tee -a "$E" >/dev/null || { unset LINES; stop "Écriture dans $E impossible."; }
unset LINES
SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
# Le worker doit redémarrer, puis rester actif 15 secondes de suite.
UP=yes; sudo systemctl restart "$W" || UP=no
for _ in $(seq 15); do [ "$UP" = yes ] || break; sleep 1; systemctl is-active --quiet "$W" || UP=no; done
if [ "$UP" = no ]; then
  for NAME in $ADDED; do sudo sed -i "/^$NAME=/d" "$E"; done
  sudo systemctl restart "$W"
  stop "Le worker ne repart pas avec ces clés : elles sont retirées, worker redémarré comme avant (sudo journalctl -u $W -n 50)."
fi
OFF="$(sudo journalctl -u "$W" --since "$SINCE" --no-pager | grep -E 'AI off|tracking off' | sed 's/.*: //' | paste -sd';')"
echo "Ajoutées : $ADDED; worker redémarré."
echo "Encore coupé : ${OFF:-rien}."
)
```

Prod (même commande ; seule la deuxième ligne change) :

```bash
(
set -uo pipefail
ENV=prod; E=/etc/closyria/$ENV.env; W=closyria-$ENV-worker
stop() { echo "$1" >&2; exit 1; }
sudo test -f "$E" || stop "$E introuvable : rien n'est changé."
LINES=""; ADDED=""
for NAME in ANTHROPIC_API_KEY LAPOSTE_OKAPI_KEY TRACKING_AGGREGATOR_KEY; do
  if sudo grep -q "^$NAME=" "$E"; then echo "$NAME : déjà là, gardée."; continue; fi
  printf "%s (coller la clé puis Entrée ; rien ne s'affiche ; Entrée seule : passer) : " "$NAME" >&2
  IFS= read -rs V; echo >&2
  V="${V//[[:space:]]/}"
  [ -z "$V" ] && { echo "$NAME : passée."; continue; }
  [[ "$V" =~ ^[A-Za-z0-9._~+/=-]{16,300}$ ]] || { unset V LINES; stop "$NAME : la clé collée n'a pas la forme d'une clé (caractères ou longueur) : rien n'est écrit."; }
  [ "$NAME" != ANTHROPIC_API_KEY ] || [[ "$V" == sk-ant-* ]] || { unset V LINES; stop "ANTHROPIC_API_KEY doit commencer par sk-ant- : rien n'est écrit."; }
  LINES+="$NAME=$V"$'\n'; ADDED+="$NAME "
done
unset V
[ -n "$LINES" ] || stop "Aucune clé à ajouter : rien n'est changé."
# Un saut de ligne seulement si le fichier n'en a pas à la fin (relancée, la commande n'ajoute pas de lignes vides).
{ sudo tail -c1 "$E" | grep -q . && printf '\n'; printf '%s' "$LINES"; } | sudo tee -a "$E" >/dev/null || { unset LINES; stop "Écriture dans $E impossible."; }
unset LINES
SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
# Le worker doit redémarrer, puis rester actif 15 secondes de suite.
UP=yes; sudo systemctl restart "$W" || UP=no
for _ in $(seq 15); do [ "$UP" = yes ] || break; sleep 1; systemctl is-active --quiet "$W" || UP=no; done
if [ "$UP" = no ]; then
  for NAME in $ADDED; do sudo sed -i "/^$NAME=/d" "$E"; done
  sudo systemctl restart "$W"
  stop "Le worker ne repart pas avec ces clés : elles sont retirées, worker redémarré comme avant (sudo journalctl -u $W -n 50)."
fi
OFF="$(sudo journalctl -u "$W" --since "$SINCE" --no-pager | grep -E 'AI off|tracking off' | sed 's/.*: //' | paste -sd';')"
echo "Ajoutées : $ADDED; worker redémarré."
echo "Encore coupé : ${OFF:-rien}."
)
```

Changer une clé (révoquée, compromise) : la retirer (`sudo sed -i '/^LAPOSTE_OKAPI_KEY=/d' /etc/closyria/dev.env`),
puis relancer la commande. Retirer une clé coupe sa fonction proprement après le redémarrage du worker.

### Vérifications en vrai, après installation (la dev d'abord)

Les tests automatiques n'utilisent jamais le réseau : les réponses des transporteurs et de l'IA y sont écrites d'après
leurs documentations. Il faut donc un essai réel par pièce, **sur la dev**, avant la prod :

1. **Réception** : Compte → « Mes commandes par e-mail », copier l'adresse ; depuis l'adresse du compte, transférer à
   la main un vrai e-mail de confirmation de commande (une boutique Shopify, de préférence). Puis
   `sudo tail -n 20 /var/log/postfix-closyria.log` : une ligne `status=sent (delivered via closyria-dev service
   (result=queued))`. Dans la minute, la carte « Commande reçue de {boutique} » sur l'Accueil ; dans l'admin,
   « E-mails de commande » compte un e-mail reçu et lu. `result=ignored` : l'expéditeur n'était pas l'adresse vérifiée
   du compte, ou sa signature n'a pas passé (voir §10.1 de la spec).
2. **Suivi La Poste** : un vrai numéro Colissimo (ou Chronopost) en cours, collé sur un article « Commandé » avec
   « Ajouter un numéro de suivi ». Le worker passe tous les quarts d'heure :
   `sudo journalctl -u closyria-dev-worker -n 100 --no-pager | grep -E 'parcel'` doit dire `parcels: 1 checked`, sans
   `check failed`, et le colis montrer son étape. `check failed (unreadable…)` : la réponse réelle ne ressemble pas à
   celle de la documentation — le noter et ne pas passer en prod.
3. **Suivi 17TRACK** : de même avec un vrai numéro d'un autre transporteur (Mondial Relay, GLS, DPD…). Au premier
   passage 17TRACK enregistre le numéro ; l'étape vient au passage suivant (15 minutes plus tard).
4. **IA (Haiku)** : transférer un vrai e-mail de commande d'une boutique **qui n'est pas** sur Shopify et sans données
   structurées (sinon les formats connus le lisent et l'IA n'est pas appelée). Dans l'admin, « E-mails de commande » →
   « IA du mois » compte une lecture et son coût (quelques centimes au plus) ; la carte de commande arrive comme pour
   l'essai 1. `AI off` dans le journal du worker : la clé n'est pas lue (relancer la commande ci-dessus).
5. **Tableau de bord** : la tuile « Colis suivis » compte les colis des essais 2 et 3.

### Reste à faire

- **`INBOUND_AUTOFORWARD` reste sur `off`** (prod comme dev) tant qu'un **vrai** transfert automatique de Gmail n'a
  pas été essayé sur la dev : passer `INBOUND_AUTOFORWARD=on` dans `/etc/closyria/dev.env`, redémarrer l'API dev,
  ajouter l'adresse de commande comme adresse de transfert dans les réglages de Gmail, vérifier que le code de
  confirmation de Gmail s'affiche dans « Mes commandes par e-mail », puis qu'un e-mail de commande reçu dans Gmail
  arrive bien (essai 1 ci-dessus). Seulement ensuite, décider pour la prod.
- Les réponses réelles de La Poste et de 17TRACK, vues aux essais 2 et 3, confirment (ou corrigent) les formes
  écrites d'après les documentations (spec §10.4).
- **Avant la prod** : ce chantier apporte les migrations 0037 à 0045 ; les essayer d'abord sur une copie de la prod
  (`sudo bash deploy/dry-run-prod-migrations.sh <id>`, étape 2 en tête de ce fichier), qui dit leur durée.
- Tant que la réception n'est pas installée dans un environnement (pas d'`INBOUND_EMAIL_SECRET`), « Mes commandes par
  e-mail » ne donne aucune adresse et dit « Bientôt disponible » ; la saisie à la main et les numéros collés marchent.

## Accès au site de test (dev)

`dev.closyria.com` n'est ouvert qu'aux appareils qui ont donné le mot de passe du site de test. Il ne passe plus par la
fenêtre de mot de passe du navigateur : l'app de l'écran d'accueil de l'iPhone ne l'affiche jamais (écran noir), et il
faut cette app pour essayer les notifications.

Comment ça marche :

- une page ouverte sans accès mène à **`/acces-dev`** (« Accès au site de test ») : le mot de passe, une fois, puis
  retour à la page demandée ;
- l'API (`POST /api/dev-access`) compare le mot de passe (`DEV_ACCESS_PASSWORD`) et pose le cookie
  `closyria_dev_access` (le jeton `DEV_ACCESS_TOKEN`, valable un an, `HttpOnly`, `Secure`, `SameSite=Lax`) ;
  5 essais par 10 minutes et par adresse ;
- Caddy laisse passer les requêtes qui portent ce cookie avec le bon jeton. Sans lui : une page est renvoyée vers
  `/acces-dev`, tout le reste (données, API, curl) reçoit 401. Restent ouverts sans cookie : `/acces-dev`,
  `/api/dev-access`, `/_next/static/*` (scripts, styles, polices de la page) et `/theme-init.js` (clair / sombre) ;
- **le jeton n'est jamais dans la configuration de Caddy** : `/etc/caddy/Caddyfile` est lisible par tous les comptes
  de la machine, et l'API d'administration de Caddy (`127.0.0.1:2019/config/`) répond sans mot de passe. Le bloc dit
  `{env.DEV_ACCESS_TOKEN}`, que Caddy lit dans son environnement à chaque requête. Le jeton est dans
  `/etc/caddy/closyria-dev.env` (root:root 600), chargé par le drop-in systemd
  `/etc/systemd/system/caddy.service.d/closyria-dev.conf` ; et, pour l'API, dans `/etc/closyria/dev.env`. Si le
  jeton manque à Caddy, le site reste fermé à tous (jamais ouvert) ;
- la prod n'est pas concernée : sans ces variables (refusées avec `APP_ENV=prod`), la route n'existe pas (404),
  la page non plus, et le bloc Caddy de la prod ne change pas.

**Avant** : déployer en dev la version qui contient la page (`sudo closyria-deploy dev <id>`), puis mettre à jour le
dépôt (branche `dev`) d'où la commande est lancée. Pendant ce temps, l'ancien mot de passe du navigateur reste en place.

**La commande, une seule fois, d'un bloc** (depuis la racine du dépôt, avec le compte qui a sudo). **Le serveur web
redémarre à la fin : environ une seconde de coupure pour tous les sites de la machine** (un redémarrage, pas un
rechargement : Caddy ne relit son environnement qu'au démarrage). Elle :

1. vérifie avant tout que le dépôt est à jour, que `/etc/closyria/dev.env` n'a pas déjà de `DEV_ACCESS_*`, que
   `/etc/caddy/closyria-dev.env` et le drop-in n'existent pas, que `/etc/caddy/Caddyfile` a exactement un bloc
   `dev.closyria.com {` et que la page `/acces-dev` est déployée ;
2. demande le mot de passe deux fois avec `read -rs` (pas affiché, pas dans l'historique). 8 caractères au moins ;
   ni espace, ni guillemet, ni `\` (systemd les lirait autrement) ;
3. tire le jeton (`openssl rand -hex 32`), prépare le nouveau Caddyfile dans un fichier temporaire (le bloc
   `dev.closyria.com` remplacé par celui du dépôt, sans jeton), le fait vérifier par `caddy validate` et garde une
   copie de l'actuel (`/etc/caddy/Caddyfile.avant-acces-dev.<date>`). Un refus arrête tout, sans rien changer ;
4. ajoute `DEV_ACCESS_PASSWORD` et `DEV_ACCESS_TOKEN` à `/etc/closyria/dev.env` (précédées d'un saut de ligne),
   redémarre `closyria-dev-api` et vérifie que la route répond. Sinon, elle s'arrête **avant** de toucher à Caddy :
   le site garde l'ancien mot de passe ;
5. écrit le jeton dans `/etc/caddy/closyria-dev.env` (600, par l'entrée standard), le drop-in, le nouveau Caddyfile,
   `systemctl daemon-reload`, puis **un seul** `systemctl restart caddy`, et contrôle par Caddy lui-même :
   `/api/health` sans cookie doit répondre 401, avec le cookie 200. Si le redémarrage ou le contrôle échoue, elle
   revient en arrière : ancien Caddyfile, drop-in et fichier du jeton retirés, `daemon-reload`, redémarrage.

Le jeton et le mot de passe ne passent que par des variables du shell et l'entrée standard, jamais en argument de
commande (visible des autres comptes), dans un sous-shell qui disparaît à la fin.

```bash
(
set -uo pipefail
R=deploy/caddy/dev.closyria.com.caddy; E=/etc/closyria/dev.env; C=/etc/caddy/Caddyfile
K=/etc/caddy/closyria-dev.env; D=/etc/systemd/system/caddy.service.d/closyria-dev.conf
stop() { echo "$1" >&2; exit 1; }
# 1. Vérifications, avant toute question et tout changement.
[ -f "$R" ] || stop "Lancer depuis le dépôt Closyria à jour (branche dev) : $R introuvable. Rien n'est changé."
grep -q '{env.DEV_ACCESS_TOKEN}' "$R" || stop "$R n'est pas la bonne version : mettre le dépôt à jour. Rien n'est changé."
sudo grep -q '^DEV_ACCESS_' "$E" && stop "DEV_ACCESS_* déjà présentes dans $E : rien n'est changé."
sudo test -e "$K" && stop "$K existe déjà : rien n'est changé."
sudo test -e "$D" && stop "$D existe déjà : rien n'est changé."
[ "$(sudo grep -c '^dev\.closyria\.com {$' "$C")" = 1 ] || stop "Il faut exactement une ligne « dev.closyria.com { » dans $C : rien n'est changé."
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/acces-dev)" = 200 ] || stop "La page /acces-dev ne répond pas : déployer d'abord la version qui la contient (sudo closyria-deploy dev <id>). Rien n'est changé."
echo "À la fin, le serveur web redémarre : environ une seconde de coupure pour tous les sites de la machine."
# 2. Le mot de passe : ni affiché, ni dans l'historique.
IFS= read -rsp "Mot de passe du site de test (8 caractères au moins ; ni espace, ni guillemet, ni \\) : " P; echo
IFS= read -rsp "Encore une fois : " P2; echo
[ "$P" = "$P2" ] || stop "Les deux saisies diffèrent : rien n'est changé."
[ "${#P}" -ge 8 ] && [ "${#P}" -le 200 ] || stop "Il faut entre 8 et 200 caractères : rien n'est changé."
case "$P" in *[[:space:]\"\'\\]*) stop "Ni espace, ni guillemet, ni \\ (le fichier d'environnement les lirait autrement) : rien n'est changé." ;; esac
# 3. Le jeton, et le nouveau Caddyfile (sans jeton : Caddy le lit dans son environnement), vérifié avant tout changement.
T="$(openssl rand -hex 32)" && [ "${#T}" = 64 ] || stop "openssl n'a pas donné de jeton : rien n'est changé."
W="$(mktemp)"; H="$(mktemp)"; trap 'rm -f "$W" "$H"' EXIT
sudo cat "$C" | awk -v repo="$R" '
  /^dev\.closyria\.com \{$/ { inblock = 1; seen = 1
    while ((getline line < repo) > 0) { if (line ~ /^dev\.closyria\.com \{$/) copy = 1; if (copy) print line }
    next }
  inblock && /^\}$/ { inblock = 0; next }
  !inblock { print }
  END { if (!seen || inblock) exit 3 }' > "$W" || stop "Le bloc dev.closyria.com de $C n'a pas pu être remplacé (accolade fermante introuvable ?) : rien n'est changé."
[ "$(grep -c 'closyria_dev_access={env.DEV_ACCESS_TOKEN}' "$W")" = 3 ] || stop "Le nouveau Caddyfile n'a pas le bon bloc dev.closyria.com : rien n'est changé."
sudo caddy validate --config "$W" --adapter caddyfile >/dev/null 2>&1 || stop "caddy validate refuse le nouveau Caddyfile : rien n'est changé (détail : sudo caddy validate --config $C)."
B="$C.avant-acces-dev.$(date +%Y%m%d-%H%M%S)"
sudo cp -p "$C" "$B" || stop "Copie de sûreté de $C impossible : rien n'est changé."
# 4. L'API apprend le mot de passe et le jeton.
printf '\nDEV_ACCESS_PASSWORD=%s\nDEV_ACCESS_TOKEN=%s\n' "$P" "$T" | sudo tee -a "$E" >/dev/null || stop "Écriture dans $E impossible : Caddy n'est pas changé."
unset P P2
sudo systemctl restart closyria-dev-api || stop "closyria-dev-api ne redémarre pas (sudo journalctl -u closyria-dev-api -n 50) : Caddy n'est pas changé, le site garde l'ancien mot de passe."
S=000; for _ in $(seq 30); do S="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:3101/api/dev-access)"; [ "$S" = 400 ] && break; sleep 1; done
[ "$S" = 400 ] || stop "L'API ne propose pas /api/dev-access (réponse $S ; sudo journalctl -u closyria-dev-api -n 50) : Caddy n'est pas changé, le site garde l'ancien mot de passe."
# 5. Caddy : le jeton dans un fichier root 600 (par l'entrée standard, jamais en argument), le drop-in qui le charge,
#    le nouveau Caddyfile, un seul redémarrage (le fichier d'environnement de Caddy change : un rechargement ne le lit pas).
undo() {
  echo "Retour en arrière : ancien Caddyfile, drop-in et fichier du jeton retirés, redémarrage de Caddy." >&2
  sudo cp -p "$B" "$C"; sudo rm -f "$D" "$K"; sudo systemctl daemon-reload; sudo systemctl restart caddy
  stop "$1"
}
printf 'DEV_ACCESS_TOKEN=%s\n' "$T" | (umask 077; sudo tee "$K" >/dev/null) && sudo chown root:root "$K" && sudo chmod 600 "$K" || undo "Écriture de $K impossible."
sudo mkdir -p "${D%/*}" && printf '[Service]\nEnvironmentFile=%s\n' "$K" | sudo tee "$D" >/dev/null || undo "Écriture de $D impossible."
sudo cp "$W" "$C" || undo "Écriture de $C impossible."
sudo systemctl daemon-reload || undo "systemctl daemon-reload a échoué."
echo "Redémarrage du serveur web…"
sudo systemctl restart caddy || undo "Caddy ne redémarre pas avec le nouveau fichier (sudo journalctl -u caddy -n 50)."
# Contrôle par Caddy : sans cookie, l'API est refusée ; avec le cookie (lu dans un fichier 600, jamais en argument), elle répond.
printf 'Cookie: closyria_dev_access=%s\n' "$T" > "$H"; unset T
for _ in $(seq 15); do A="$(curl -s -o /dev/null -w '%{http_code}' https://dev.closyria.com/api/health)"; [ "$A" = 401 ] && break; sleep 1; done
G="$(curl -s -o /dev/null -w '%{http_code}' -H @"$H" https://dev.closyria.com/api/health)"
[ "$A" = 401 ] && [ "$G" = 200 ] || undo "Contrôle raté (sans cookie : $A au lieu de 401 ; avec : $G au lieu de 200)."
echo "C'est fait. Sur chaque appareil, ouvrir https://dev.closyria.com : la page « Accès au site de test » demande le mot de passe, une fois."
echo "iPhone : une fois dans Safari, puis une fois dans l'app de l'écran d'accueil (elle garde ses propres cookies)."
echo "Ancien Caddyfile gardé dans $B."
)
```

Après :

- sur chaque appareil, ouvrir `https://dev.closyria.com` et donner le mot de passe une fois. **iPhone** : une fois dans
  Safari, puis une fois dans l'app de l'écran d'accueil (elle a ses propres cookies) ;
- contrôle (sans cookie) : une page est renvoyée vers l'accès, le reste est refusé, la page d'accès s'ouvre, et la
  configuration en service ne contient pas le jeton :

  ```bash
  curl -sI -H 'Sec-Fetch-Mode: navigate' https://dev.closyria.com/articles | grep -iE '^(HTTP|location)'   # 302, /acces-dev?suite=/articles
  curl -s -o /dev/null -w '%{http_code}\n' https://dev.closyria.com/api/health                            # 401
  curl -s -o /dev/null -w '%{http_code}\n' https://dev.closyria.com/acces-dev                             # 200
  curl -s 127.0.0.1:2019/config/ | grep -o 'closyria_dev_access=[^*]*' | sort -u                          # {env.DEV_ACCESS_TOKEN} seulement
  ```

- l'ancien commentaire « password-protected » au-dessus du bloc dans `/etc/caddy/Caddyfile` peut être retiré à la
  main ; il ne change rien.

**Si la commande s'est arrêtée** :

- aux étapes 1 à 3 : rien n'a changé ; corriger ce qu'elle dit et la relancer ;
- à l'étape 4 (API) : Caddy n'a pas changé. Corriger d'après le journal, retirer les deux lignes ajoutées
  (`sudo sed -i '/^DEV_ACCESS_/d' /etc/closyria/dev.env`), puis la relancer ;
- à l'étape 5 (Caddy) : elle est revenue en arrière d'elle-même, le site garde l'ancien mot de passe. Lire
  `sudo journalctl -u caddy -n 50`, retirer les deux lignes de `/etc/closyria/dev.env` comme ci-dessus, puis la
  relancer. Si le retour en arrière lui-même a échoué (Caddy arrêté), le faire à la main :

  ```bash
  ls /etc/caddy/Caddyfile.avant-acces-dev.*        # la copie la plus récente
  sudo cp -p /etc/caddy/Caddyfile.avant-acces-dev.<date> /etc/caddy/Caddyfile
  sudo rm -f /etc/systemd/system/caddy.service.d/closyria-dev.conf /etc/caddy/closyria-dev.env
  sudo systemctl daemon-reload && sudo systemctl restart caddy && systemctl is-active caddy
  ```

**Changer le mot de passe** : remplacer la valeur de `DEV_ACCESS_PASSWORD` dans `/etc/closyria/dev.env`, puis
`sudo systemctl restart closyria-dev-api`. Les appareils déjà entrés le restent. **Fermer l'accès à tous les
appareils** : changer le jeton (`openssl rand -hex 32`), le même dans `/etc/caddy/closyria-dev.env` et dans
`DEV_ACCESS_TOKEN` de `/etc/closyria/dev.env`, puis `sudo systemctl restart caddy closyria-dev-api` (environ une
seconde de coupure pour tous les sites de la machine).

## Premières migrations : droits sur la base

Le script de déploiement applique les migrations en tant qu'utilisateur système de l'environnement (`closyria` en
prod, `closyria-dev` en dev), qui doit pouvoir créer des tables. Avant le premier déploiement, vérifier que chaque base
appartient au bon utilisateur :

```bash
sudo -u postgres psql -Atc "SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname IN ('closyria', 'closyria_dev');"
```

La réponse attendue est :

```
closyria|closyria
closyria_dev|closyria-dev
```

Sinon, au choix (le premier est le plus simple) :

```bash
# Donner la base à son utilisateur
sudo -u postgres psql -c 'ALTER DATABASE closyria OWNER TO closyria;'
sudo -u postgres psql -c 'ALTER DATABASE closyria_dev OWNER TO "closyria-dev";'
# … ou seulement le droit de créer des tables dans le schéma public
sudo -u postgres psql -d closyria -c 'GRANT CREATE ON SCHEMA public TO closyria;'
sudo -u postgres psql -d closyria_dev -c 'GRANT CREATE ON SCHEMA public TO "closyria-dev";'
```

Vérification du droit de créer (doit répondre `t`) :

```bash
sudo -u postgres psql -d closyria -Atc "SELECT has_schema_privilege('closyria', 'public', 'CREATE');"
sudo -u postgres psql -d closyria_dev -Atc "SELECT has_schema_privilege('closyria-dev', 'public', 'CREATE');"
```

## Essai des migrations sur une copie de la prod

À lancer **avant chaque mise en prod qui apporte des migrations**, depuis le dépôt, avec un compte qui a sudo :

```bash
sudo bash deploy/dry-run-prod-migrations.sh <release-id>
```

`<release-id>` est l'identifiant affiché par `deploy/build.sh` ; l'archive
`/home/mystery/closyria-artifacts/<release-id>.tar.gz` doit exister.

Ce que fait le script :

1. il affiche à qui appartiennent la base `closyria` et son schéma `public`, et si `closyria` peut y créer des
   objets (une migration qui crée une fonction en a besoin, voir la section précédente) ;
2. il copie la prod dans une base jetable `closyria_dryrun` (`pg_dump` puis `pg_restore` ; les extensions, qui
   demandent un superutilisateur et ne servent pas aux migrations, sont laissées de côté) ;
3. il compte les lignes des tables principales (comptes, profils, boutiques, fiches, articles) ;
4. il applique à la copie les migrations de la version, avec le même programme que le déploiement
   (`api/migrate.mjs`), et affiche leur durée ;
5. il recompte les lignes, puis supprime la copie et ses fichiers temporaires, même en cas d'échec.

Il **ne modifie jamais la prod** : sur la base `closyria`, il ne fait que lire (le `pg_dump` et les requêtes de
vérification). Le résultat attendu se termine par `DRY RUN OK`. Une erreur (une migration qui échoue, un droit qui
manque) arrête le script : la corriger avant de déployer. Les nombres de lignes avant et après doivent être les mêmes,
sauf si une migration en supprime volontairement.

## HSTS dans le Caddyfile en service

Les fichiers `caddy/*.caddy` contiennent déjà l'en-tête HSTS. Dans `/etc/caddy/Caddyfile` en service, chaque bloc
du site doit l'avoir **aussi**, y compris le bloc qui redirige `www` et `.fr` vers `closyria.com`. Ajouter cette ligne
en tête de chacun de ces blocs (sans `preload`) :

```caddy
header Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

Par exemple, pour le bloc de redirection (garder les noms de domaine du bloc existant) :

```caddy
www.closyria.com, closyria.fr, www.closyria.fr {
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	redir https://closyria.com{uri} permanent
}
```

Puis `sudo caddy validate --config /etc/caddy/Caddyfile` et `sudo systemctl reload caddy`. Contrôle :
`curl -sI https://www.closyria.com | grep -i strict-transport` doit afficher la ligne.

`sharp` (traitement des photos) contient du code natif et ne peut pas être intégré au bundle de l'API : `build.sh`
place dans `api/node_modules` sharp et ses binaires linux-x64 (glibc), aux versions du lockfile, puis vérifie qu'il
se charge. L'artefact doit donc être construit sur une machine linux-x64 glibc, comme le serveur.

## Adresse du client et limite de débit

Limites en place : `POST /api/events`, 60 requêtes par minute et par adresse ; `POST /api/media`, 30 photos par heure
et par compte, 60 par heure et par adresse, et 2 photos traitées à la fois par processus (8 autres attendent 5 s,
puis « réessaie dans un instant »). Ces limites identifient le client par la **dernière** entrée de `X-Forwarded-For`
(en mémoire, hachée, jamais stockée). Cela n'est sûr que parce que l'API écoute sur 127.0.0.1 derrière Caddy, qui
**réécrit** `X-Forwarded-For` avec l'adresse qu'il voit (`reverse_proxy` le fait par défaut). L'API ne doit
**jamais** être exposée directement.

Les pages admin lisent la session et les données admin **côté serveur** : le serveur web (Next) appelle alors l'API
sur 127.0.0.1 et lui transmet l'adresse de la visiteuse (dernière entrée du `X-Forwarded-For` que Caddy lui a
donné), pour que les limites de Better Auth comptent chaque visiteuse à part. Le web est donc lui aussi un relais de
confiance : comme l'API, il doit écouter sur 127.0.0.1 (`HOSTNAME=127.0.0.1` dans l'unité systemd) et n'être
joignable que par Caddy. Exposé directement, il laisserait un client choisir l'adresse transmise.

Caddy envoie `/api/*` de l'origine web vers l'API : le web appelle donc `/api/events` en même origine.

## Donner le rôle admin

Le rôle ne se donne jamais par l'application : ni l'inscription ni la modification du profil ne peuvent le changer.
La fondatrice le donne **une seule fois**, à son propre compte, en SQL et en tant que `postgres`.

Les bases sont celles que la fondatrice a créées en tant que `postgres` : `closyria` pour la prod et `closyria_dev`
pour la dev. Elles correspondent à `DATABASE_URL` dans `/etc/closyria/prod.env` et `/etc/closyria/dev.env`.

Faire les cinq étapes d'une traite, sur l'appareil qui portera la passkey (quelques minutes en tout) :

1. **Se connecter** sur `https://closyria.com/connexion` (dev : `https://dev.closyria.com/connexion`) : saisir son
   e-mail, « Recevoir mon code », puis le code reçu et « Me connecter ». Cela crée le compte s'il n'existe pas.
2. **Promouvoir** le compte, dans la bonne base, en remplaçant l'adresse :

   ```bash
   # Prod
   sudo -u postgres psql -d closyria -c "UPDATE \"user\" SET role = 'admin' WHERE email = lower('adresse@exemple.fr');"
   # Dev
   sudo -u postgres psql -d closyria_dev -c "UPDATE \"user\" SET role = 'admin' WHERE email = lower('adresse@exemple.fr');"
   ```

   La réponse doit être `UPDATE 1`. `UPDATE 0` veut dire qu'aucun compte n'a cette adresse : vérifier l'adresse et
   l'étape 1. La base refuse toute autre valeur que `user` ou `admin`.
3. **Ouvrir** `https://closyria.com/admin/passkey-required` (dev : `https://dev.closyria.com/admin/passkey-required`) (dans le même navigateur, toujours connectée par code).
4. **« Enregistrer une passkey »** et suivre le navigateur (empreinte, visage ou code de l'appareil).
5. **« Se connecter avec une passkey »** : l'espace admin s'ouvre. Il exige le rôle `admin` **et** une session ouverte
   par passkey ; une session ouverte par code e-mail, Google ou Apple n'y donne pas accès, même avec le rôle.

Pourquoi d'une traite : tant qu'un compte admin n'a aucune passkey, une session ouverte par code e-mail peut en
enregistrer une première (sans cela, impossible de démarrer). Entre l'étape 2 et l'étape 4, l'accès à la boîte e-mail
suffirait donc pour enregistrer une passkey sur ce compte : cette fenêtre doit durer quelques minutes, pas plus. Dès
qu'une passkey existe, seule une session ouverte par passkey peut en ajouter, en renommer ou en supprimer.

Vérifier ensuite que le compte ne porte que ses propres passkeys (une ligne par appareil enregistré) :

```bash
sudo -u postgres psql -d closyria -c "SELECT name, created_at FROM passkey WHERE user_id = (SELECT id FROM \"user\" WHERE email = lower('adresse@exemple.fr'));"
```

Une ligne inattendue : la supprimer (voir ci-dessous) et recommencer aux étapes 3 à 5.

Pour retirer le rôle : même commande qu'à l'étape 2 avec `role = 'user'`.

### Toutes les passkeys de l'admin sont perdues

Sans passkey, plus de session admin possible, et une session par code e-mail ne peut plus gérer les passkeys
tant qu'il en reste une enregistrée. Pour repartir :

1. Supprimer les passkeys de ce compte (même base que ci-dessus) :

   ```bash
   sudo -u postgres psql -d closyria -c "DELETE FROM passkey WHERE user_id = (SELECT id FROM \"user\" WHERE email = lower('adresse@exemple.fr'));"
   ```

2. **Aussitôt**, refaire les étapes 1, 3, 4 et 5 ci-dessus (connexion par code sur `/connexion`, puis
   `/admin/passkey-required`) : tant que le compte n'en a aucune, l'accès à la boîte e-mail suffit pour en enregistrer
   une.

## Sauvegardes de la base

Plan et décisions : `docs/plans/2026-11-06-sauvegardes-prod.md`.

| Quand | Quoi |
|---|---|
| Chaque nuit, 03:30 UTC | `closyria-backup@<env>` : `pg_dump`, chiffré avec `age`, envoyé dans le bucket `closyria-backups` (OVH Strasbourg) sous `<env>/closyria-<env>-<AAAAMMJJTHHMMSSZ>.dump.age`. |
| Chaque matin, 05:00 UTC | `closyria-backup-check@<env>` : la dernière copie est téléchargée, déchiffrée, restaurée dans la base jetable `closyria_restore_check_<env>`, comparée à la vraie base (mêmes tables, mêmes migrations, au moins 90 % des lignes de `user`, `items`, `products`, pour celles que la vraie base a déjà), puis effacée. Échoue aussi si la dernière copie a plus de 6 h (une nuit manquée est donc signalée dès le matin ; lancée à la main l’après-midi, la vérification échoue pour cette raison). |
| Avant chaque `closyria-deploy prod` | Une sauvegarde ; si elle échoue, rien n'est déployé. |
| En cas d'échec | `closyria-backup-alert@…` envoie un e-mail (Brevo) à `BACKUP_ALERT_TO`. |

Les copies sont verrouillées 30 jours (Object Lock, mode « compliance ») : personne ne peut les effacer ni les
remplacer avant, même avec les clés du serveur. Elles expirent seules après 31 jours.

Limite constatée chez OVH (2026-11-06) : malgré la politique sans `s3:DeleteObject`, un effacement simple est
accepté et pose une étiquette « supprimé » (*delete marker*) sur la copie. La copie elle-même reste intacte et ne
peut pas être détruite (essai de destruction par version : `AccessDenied`). Une copie ainsi cachée fait échouer la
vérification du matin (alerte). Pour la faire réapparaître : `list-object-versions`, puis `delete-object` avec le
`--version-id` de l'étiquette.

### `/etc/closyria/backup.env` (root:root 600)

| Variable | Valeur |
|---|---|
| `BACKUP_STORE` | `s3://closyria-backups` |
| `S3_ENDPOINT` | `https://s3.sbg.io.cloud.ovh.net` (remplace celui du fichier de l'environnement, lu avant) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Utilisateur S3 `closyria-backups` (écrire, lire, lister ; pas effacer) |
| `AWS_DEFAULT_REGION` | `sbg` |
| `BACKUP_AGE_RECIPIENT` | Clé publique `age1…` (affichée par `age-keygen`) |
| `BREVO_API_KEY` | La même clé Brevo que l'appli |
| `MAIL_FROM` | `Closyria <bonjour@closyria.com>` |
| `BACKUP_ALERT_TO` | L'adresse qui reçoit les alertes |

La clé privée est dans `/etc/closyria/backup.key` (root:root 600) ; seul le service de vérification la reçoit
(`LoadCredential=`). **Une copie de son contenu est gardée dans le gestionnaire de mots de passe** : sans elle, si le
serveur est perdu, les sauvegardes sont illisibles.

### Installer

```bash
sudo apt install age
sudo install -m 755 -o root -g root deploy/backup/closyria-backup deploy/backup/closyria-backup-check \
  deploy/backup/closyria-backup-alert /usr/local/bin/
sudo install -m 644 -o root -g root deploy/backup/lib.sh /usr/local/bin/
sudo cp -r deploy/systemd/closyria-backup* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start closyria-backup@dev.service closyria-backup-check@dev.service
sudo journalctl -u closyria-backup-check@dev -n 5 --no-pager   # « ok: dev/closyria-dev-… restored, N tables »
sudo systemctl enable --now closyria-backup@dev.timer closyria-backup-check@dev.timer
```

Même chose avec `prod` une fois la dev validée. `systemctl list-timers 'closyria-backup*'` montre les prochains
passages.

### Restaurer une base (sinistre ou erreur grave)

Exemple pour la prod ; pour la dev, remplacer `prod` par `dev`, la base `closyria` par `closyria_dev`, le compte
`closyria` par `closyria-dev` (entre guillemets dans le SQL : `owner "closyria-dev"`) et le port 3001 par 3101. L'ancienne base est **renommée**, jamais effacée tout de suite.

```bash
# 1. Choisir la copie (la plus récente, ou celle d'avant l'erreur)
sudo bash -c 'set -a; . /etc/closyria/backup.env; AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required aws --endpoint-url "$S3_ENDPOINT" s3 ls s3://closyria-backups/prod/'
# 2. La télécharger et la déchiffrer
sudo bash -c 'set -a; . /etc/closyria/backup.env; AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required aws --endpoint-url "$S3_ENDPOINT" s3 cp \
  s3://closyria-backups/prod/closyria-prod-AAAAMMJJTHHMMSSZ.dump.age /root/restore.dump.age'
sudo age --decrypt --identity /etc/closyria/backup.key --output /root/restore.dump /root/restore.dump.age
# 3. Arrêter l'appli, mettre l'ancienne base de côté, recréer la base
sudo systemctl stop closyria-prod.target
sudo -u postgres psql -c 'alter database closyria rename to closyria_old'
sudo -u postgres psql -c 'create database closyria owner closyria'
# 4. Restaurer avec le compte de l'appli (les tables lui appartiennent), puis redémarrer
sudo install -m 600 -o closyria /root/restore.dump /tmp/restore.dump
sudo -u closyria pg_restore --exit-on-error --no-owner --dbname=closyria /tmp/restore.dump
sudo systemctl start closyria-prod.target
curl -s http://127.0.0.1:3001/api/health
# 5. Vérifier l'appli ; le lendemain seulement, effacer l'ancienne base et les fichiers
sudo -u postgres psql -c 'drop database closyria_old'
sudo rm -f /root/restore.dump /root/restore.dump.age /tmp/restore.dump
```
