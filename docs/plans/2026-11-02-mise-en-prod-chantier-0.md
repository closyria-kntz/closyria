# Mise en prod du chantier 0 — liste de contrôle

> Date : 2026-11-02 · Déploie : la fondatrice (mot de passe sudo) · Prépare et vérifie : Claude.
> Prod actuelle : `20261101-130051-cc56d58b3e04` (phase 0). Dev validée : `20261102-220707-895c5771c5b6`.

## Avant (sans impact sur la prod)

- [x] Tests, analyse et types au vert en local (`pnpm test` : 12/12) ; parcours navigateur 18/18
- [x] Revue de branche finale et revue du dernier correctif : rien de bloquant
- [x] Dev déployée et validée : connexion par code (Brevo), rôle admin, passkey, envoi de photo vers OVH
- [x] CI GitHub au vert sur `dev` (onglet Actions)
- [x] Fusion de `dev` dans `main` (avance rapide) et envoi de `main`
- [x] Bucket OVH `closyria-prod` (Gravelines, privé) + utilisateur S3 limité à ce bucket
- [x] Base `closyria` appartient à `closyria`
- [x] Sauvegarde de la base prod juste avant (`pg_dump`)
- [x] Variables ajoutées à `/etc/closyria/prod.env` : nouvelle clé de session (différente de la dev), URL
      `https://closyria.com`, Brevo, les cinq `S3_*` du bucket prod
- [x] Services prod réinstallés (`TZ=UTC`), `daemon-reload`
- [x] HSTS dans les blocs `closyria.com` et redirection (`www`, `.fr`) du Caddyfile, validé, rechargé
- [x] Artefact construit depuis `origin/main` (script de la branche à jour)

## Mise en ligne

- [x] `sudo closyria-deploy prod <id>` : migrations 0000 à 0006, bascule, contrôle de santé (retour automatique sinon)
- [x] Contrôles : `/api/health` en `prod` avec la bonne version, accueil 200, `/connexion` 200, `/admin` 404,
      en-tête HSTS sur `closyria.com` et `www.closyria.com`
- [ ] Journal sans erreur pendant 15 min (`sudo journalctl -u 'closyria-prod-*' -p warning`)
- [x] Parcours réel : code reçu par e-mail, rôle admin (SQL), passkey, espace admin ouvert
- [ ] Contrôle des passkeys du compte admin (une ligne par appareil)

## Ce qui a coincé (2026-11-05)

- **Clé Brevo absente de `prod.env`** : l'API démarre quand même, mais aucun code n'est envoyé. Avant chaque mise en
  prod, comparer la liste des variables de `prod.env` à celle de `dev.env`, puis redémarrer l'API après tout ajout
  (`sudo systemctl restart closyria-prod-api`).
- **Brevo refuse les envois (HTTP 401)** tant que les adresses IP du serveur ne sont pas autorisées dans Brevo.
- **Construire depuis un dépôt à jour** : `deploy/build.sh` d'une copie restée sur une ancienne branche produit un
  artefact sans `sharp`.

## Retour arrière

- **Quand** : santé en échec, `/connexion` ou envoi de code en erreur, erreurs répétées dans le journal.
- **Comment** : `sudo closyria-deploy prod rollback` (version phase 0). Les migrations ne sont pas annulées : elles
  ne font qu'ajouter des tables et des colonnes, que la phase 0 ignore. Restauration de la sauvegarde seulement en
  cas de données abîmées.

## Après

- [x] Cocher la tâche 15 dans `docs/plans/2026-11-01-chantier-0-socle.md` et le chantier 0 dans la spec V1
- [x] Supprimer l'espace de suivi `.superpowers/sdd/2026-11-01-chantier-0-socle/` (R21) et le worktree `chantier-0`
- [ ] Reste avant le lancement public (registre) : CSP en mode bloquant avec nonces, 429 admin → « réessaie »,
      suppression des photos S3 avec le compte (chantier 6), validation des thèmes (chantier 4)
