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

## Donner le rôle admin

Le rôle ne se donne jamais par l'application : ni l'inscription ni la modification du profil ne peuvent le changer.
La fondatrice le donne **une seule fois**, à son propre compte, en tant que `postgres` sur le serveur.

1. Se connecter d'abord une fois au site (code e-mail ou Google/Apple), pour que le compte existe.
2. Lancer la commande dans la bonne base, en remplaçant l'adresse :

   ```bash
   # Prod (base closyria)
   sudo -u postgres psql -d closyria -c "UPDATE \"user\" SET role = 'admin' WHERE email = 'adresse@exemple.fr';"
   # Dev (base closyria_dev)
   sudo -u postgres psql -d closyria_dev -c "UPDATE \"user\" SET role = 'admin' WHERE email = 'adresse@exemple.fr';"
   ```

   La réponse doit être `UPDATE 1`. `UPDATE 0` veut dire qu'aucun compte n'a cette adresse (vérifier la
   casse et l'étape 1). La base refuse toute autre valeur que `user` ou `admin`.
3. **Enregistrer ensuite une passkey** depuis le compte : l'espace admin exige le rôle `admin` **et** une session
   ouverte par passkey. Une session ouverte par code e-mail, Google ou Apple n'y donne pas accès, même avec le rôle.

Pour retirer le rôle : même commande avec `role = 'user'`.
