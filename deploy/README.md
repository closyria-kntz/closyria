# Déploiement

1. **Construire** (compte développeur, sans privilège) : `deploy/build.sh origin/dev` → affiche l'identifiant de version.
2. **Déployer** : `sudo closyria-deploy dev <id>` (sans mot de passe pour la dev) ou `sudo closyria-deploy prod <id>` (mot de passe requis).
3. **Revenir en arrière** : `sudo closyria-deploy <env> rollback`. Les migrations de base ne sont pas annulées.
4. **Lister** : `sudo closyria-deploy <env> list`.

Le script applique les migrations, bascule le lien `current`, redémarre `closyria-<env>.target` et vérifie
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

Exemple de `/etc/closyria/prod.env` (systemd ne comprend pas les commentaires en fin de ligne : un `# …` après une
valeur ferait partie de la valeur ; `BETTER_AUTH_SECRET` se génère avec `openssl rand -base64 48`) :

```bash
APP_ENV=prod
DATABASE_URL=postgresql:///closyria?host=/var/run/postgresql
BETTER_AUTH_SECRET=…
BETTER_AUTH_URL=https://closyria.com
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
| Chaque matin, 05:00 UTC | `closyria-backup-check@<env>` : la dernière copie est téléchargée, déchiffrée, restaurée dans la base jetable `closyria_restore_check_<env>`, comparée à la vraie base (mêmes tables, mêmes migrations, au moins 90 % des lignes de `user`, `items`, `products`), puis effacée. Échoue aussi si la dernière copie a plus de 6 h (une nuit manquée est donc signalée dès le matin ; lancée à la main l’après-midi, la vérification échoue pour cette raison). |
| Avant chaque `closyria-deploy prod` | Une sauvegarde ; si elle échoue, rien n'est déployé. |
| En cas d'échec | `closyria-backup-alert@…` envoie un e-mail (Brevo) à `BACKUP_ALERT_TO`. |

Les copies sont verrouillées 30 jours (Object Lock, mode « compliance ») : personne ne peut les effacer ni les
remplacer avant, même avec les clés du serveur. Elles expirent seules après 31 jours.

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
sudo bash -c 'set -a; . /etc/closyria/backup.env; aws --endpoint-url "$S3_ENDPOINT" s3 ls s3://closyria-backups/prod/'
# 2. La télécharger et la déchiffrer
sudo bash -c 'set -a; . /etc/closyria/backup.env; aws --endpoint-url "$S3_ENDPOINT" s3 cp \
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
