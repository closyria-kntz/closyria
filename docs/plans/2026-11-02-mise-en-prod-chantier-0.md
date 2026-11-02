# Mise en prod du chantier 0 — liste de contrôle

> Date : 2026-11-02 · Déploie : la fondatrice (mot de passe sudo) · Prépare et vérifie : Claude.
> Prod actuelle : `20261101-130051-cc56d58b3e04` (phase 0). Dev validée : `20261102-220707-895c5771c5b6`.

## Avant (sans impact sur la prod)

- [x] Tests, analyse et types au vert en local (`pnpm test` : 12/12) ; parcours navigateur 18/18
- [x] Revue de branche finale et revue du dernier correctif : rien de bloquant
- [x] Dev déployée et validée : connexion par code (Brevo), rôle admin, passkey, envoi de photo vers OVH
- [ ] CI GitHub au vert sur `dev` (onglet Actions)
- [ ] Fusion de `dev` dans `main` (avance rapide) et envoi de `main`
- [ ] Bucket OVH `closyria-prod` (Gravelines, privé) + utilisateur S3 limité à ce bucket
- [ ] Base `closyria` appartient à `closyria`
- [ ] Sauvegarde de la base prod juste avant (`pg_dump`)
- [ ] Variables ajoutées à `/etc/closyria/prod.env` : nouvelle clé de session (différente de la dev), URL
      `https://closyria.com`, Brevo, les cinq `S3_*` du bucket prod
- [ ] Services prod réinstallés (`TZ=UTC`), `daemon-reload`
- [ ] HSTS dans les blocs `closyria.com` et redirection (`www`, `.fr`) du Caddyfile, validé, rechargé
- [ ] Artefact construit depuis `origin/main` (script de la branche à jour)

## Mise en ligne

- [ ] `sudo closyria-deploy prod <id>` : migrations 0000 à 0006, bascule, contrôle de santé (retour automatique sinon)
- [ ] Contrôles : `/api/health` en `prod` avec la bonne version, accueil 200, `/connexion` 200, `/admin` 404,
      en-tête HSTS sur `closyria.com` et `www.closyria.com`, journal sans erreur pendant 15 min
- [ ] Parcours réel : code reçu par e-mail, rôle admin (SQL), passkey, espace admin ouvert
- [ ] Contrôle des passkeys du compte admin (une ligne par appareil)

## Retour arrière

- **Quand** : santé en échec, `/connexion` ou envoi de code en erreur, erreurs répétées dans le journal.
- **Comment** : `sudo closyria-deploy prod rollback` (version phase 0). Les migrations ne sont pas annulées : elles
  ne font qu'ajouter des tables et des colonnes, que la phase 0 ignore. Restauration de la sauvegarde seulement en
  cas de données abîmées.

## Après

- [ ] Cocher la tâche 15 dans `docs/plans/2026-11-01-chantier-0-socle.md` et le chantier 0 dans la spec V1
- [ ] Supprimer l'espace de suivi `.superpowers/sdd/2026-11-01-chantier-0-socle/` (R21) et le worktree `chantier-0`
- [ ] Reste avant le lancement public (registre) : CSP en mode bloquant avec nonces, 429 admin → « réessaie »,
      suppression des photos S3 avec le compte (chantier 6), validation des thèmes (chantier 4)
