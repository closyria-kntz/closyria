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

Secrets : `/etc/closyria/<env>.env` (root:root 600), lus par systemd au démarrage.

Photos : l'API refuse de démarrer hors développement sans les cinq variables du stockage OVH (S3) :
`S3_ENDPOINT` (par exemple `https://s3.gra.io.cloud.ovh.net`), `S3_REGION` (`gra`), `S3_BUCKET` (un bucket par
environnement), `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY`. Les ajouter à `/etc/closyria/<env>.env` **avant** de
déployer cette version. En développement local, sans elles, les photos restent en mémoire jusqu'au redémarrage.

`sharp` (traitement des photos) contient du code natif et ne peut pas être intégré au bundle de l'API : `build.sh`
place dans `api/node_modules` sharp et ses binaires linux-x64 (glibc), aux versions du lockfile, puis vérifie qu'il
se charge. L'artefact doit donc être construit sur une machine linux-x64 glibc, comme le serveur.

## Donner le rôle admin

Le rôle ne se donne jamais par l'application : ni l'inscription ni la modification du profil ne peuvent le changer.
La fondatrice le donne **une seule fois**, à son propre compte, en SQL et en tant que `postgres`.

Les bases sont celles que la fondatrice a créées en tant que `postgres` : `closyria` pour la prod et `closyria_dev`
pour la dev. Elles correspondent à `DATABASE_URL` dans `/etc/closyria/prod.env` et `/etc/closyria/dev.env`.

1. **Se connecter** au site (code e-mail), puis **enregistrer une passkey** depuis le compte, **avant** la promotion.
   Tant qu'un compte admin n'a aucune passkey, n'importe quelle session fraîche peut en enregistrer une première ;
   une fois qu'il en a une, seule une session ouverte par passkey peut en ajouter, en renommer ou en supprimer.
   Faire l'enregistrement avant la promotion évite donc toute fenêtre où l'accès à la boîte e-mail suffirait.
2. **Promouvoir** le compte, dans la bonne base, en remplaçant l'adresse :

   ```bash
   # Prod
   sudo -u postgres psql -d closyria -c "UPDATE \"user\" SET role = 'admin' WHERE email = lower('adresse@exemple.fr');"
   # Dev
   sudo -u postgres psql -d closyria_dev -c "UPDATE \"user\" SET role = 'admin' WHERE email = lower('adresse@exemple.fr');"
   ```

   La réponse doit être `UPDATE 1`. `UPDATE 0` veut dire qu'aucun compte n'a cette adresse : vérifier l'adresse et
   l'étape 1. La base refuse toute autre valeur que `user` ou `admin`.

   Vérifier ensuite que le compte ne porte que ses propres passkeys (une ligne par appareil enregistré) :

   ```bash
   sudo -u postgres psql -d closyria -c "SELECT name, created_at FROM passkey WHERE user_id = (SELECT id FROM \"user\" WHERE email = lower('adresse@exemple.fr'));"
   ```

3. **Se reconnecter avec la passkey** pour entrer dans l'espace admin : il exige le rôle `admin` **et** une session
   ouverte par passkey. Une session ouverte par code e-mail, Google ou Apple n'y donne pas accès, même avec le rôle.

Pour retirer le rôle : même commande avec `role = 'user'`.

### Toutes les passkeys de l'admin sont perdues

Sans passkey, plus de session admin possible, et une session par code e-mail ne peut plus gérer les passkeys
tant qu'il en reste une enregistrée. Pour repartir :

1. Supprimer les passkeys de ce compte (même base que ci-dessus) :

   ```bash
   sudo -u postgres psql -d closyria -c "DELETE FROM passkey WHERE user_id = (SELECT id FROM \"user\" WHERE email = lower('adresse@exemple.fr'));"
   ```

2. **Aussitôt**, se connecter par code e-mail et enregistrer une nouvelle passkey (étape 1 ci-dessus) : tant que le
   compte n'en a aucune, l'accès à la boîte e-mail suffit pour en enregistrer une.
