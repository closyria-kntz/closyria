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
