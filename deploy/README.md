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
