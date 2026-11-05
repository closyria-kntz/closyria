# Mise en service du chantier 1 (capture de boutiques) — liste de contrôle

> Date : 2026-11-05 · Fait par : la fondatrice (sudo) · Dev : Claude peut lancer `sudo closyria-deploy dev <id>`,
> la prod est réservée à la fondatrice (mot de passe).
> Spec : `docs/specs/2026-11-05-chantier-1-capture-boutiques.md` (§8 et §10). Procédure d'installation :
> `deploy/README.md`, section « Barrière réseau du worker ».

## Avant (sans impact)

- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` au vert ; CI GitHub au vert sur la branche
- [ ] Les cinq variables `S3_*` sont dans `/etc/closyria/dev.env` et `/etc/closyria/prod.env` (le worker lit le même
      fichier que l'API ; toutes ensemble, sinon refus de démarrer)
- [ ] `/etc/resolv.conf` pointe toujours vers `127.0.0.53` (`grep nameserver /etc/resolv.conf`) : c'est la seule
      adresse locale autorisée par la barrière ; sinon le worker ne résout plus aucun nom
- [ ] Artefact construit depuis une copie à jour : `deploy/build.sh origin/<branche>` → noter l'identifiant ; `sharp`
      est bien dans l'artefact du worker (le script le vérifie)
- [ ] Prod seulement : sauvegarde de la base (`pg_dump`) juste avant

## Dev

1. [ ] Copier les unités et recharger systemd :
   ```bash
   sudo cp deploy/systemd/closyria-dev-worker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
2. [ ] Déployer : `sudo closyria-deploy dev <id>` (migrations 0007 à 0010 appliquées avant le redémarrage ; au
   démarrage, le worker crée les 18 boutiques de départ). Le contrôle de santé du déploiement ne couvre que l'API et
   le web, **pas le worker** : un échec du worker n'entraîne aucun retour automatique (voir l'étape suivante)
   - [ ] `systemctl is-active closyria-dev-worker` affiche `active`
   - [ ] `sudo journalctl -u closyria-dev-worker -n 50 --no-pager | grep 'started'` montre la ligne de démarrage,
     de la forme `worker <version> (dev) started`
   - Un worker qui redémarre en boucle (échec de l'amorçage des boutiques, variables `S3_*`, DNS derrière la
     barrière) doit mener à `sudo closyria-deploy dev rollback`, à lancer à la main.
3. [ ] Lire la barrière dans le journal du worker dev :
   ```bash
   sudo journalctl -u closyria-dev-worker -n 50 --no-pager | grep 'network barrier'
   ```
   Attendu : `network barrier: active`. Si `network barrier: ABSENT` : l'unité n'a pas été recopiée ou
   `daemon-reload` a été oublié ; ne pas passer à la suite.
4. [ ] Journal sans erreur ni avertissement inattendu : `sudo journalctl -u 'closyria-dev-*' -p warning -n 50`.
   À chercher en particulier : `seed: domain … is already attached to another shop (starting shop …)` (un domaine
   de départ est déjà rattaché à une boutique créée avant). Action : dans l'admin, fusionner la boutique en
   attente dans la boutique de départ.
5. [ ] Sur https://dev.closyria.com, coller un lien d'article d'une des boutiques de départ : la fiche se remplit
   (nom, prix, photos)
6. [ ] Admin (connexion par passkey) : la santé des boutiques est visible
7. [ ] Le lendemain : la surveillance de 04:00 UTC est passée pour les 8 boutiques publiées (dernière surveillance
   à jour dans l'admin, pas de boutique « en panne »)

## Prod (seulement quand toute la dev est validée)

Mêmes étapes, avec les noms de prod :

1. [ ] Comparer les variables de `/etc/closyria/prod.env` à celles de `dev.env` (piège déjà rencontré), `S3_*` compris
2. [ ] `/etc/resolv.conf` toujours vers `127.0.0.53`
3. [ ] `sudo cp deploy/systemd/closyria-prod-worker.service /etc/systemd/system/` puis `sudo systemctl daemon-reload`
4. [ ] `sudo closyria-deploy prod <id>` (migrations 0007 à 0010, boutiques de départ, bascule, contrôle de santé de
   l'API et du web seulement : **le worker n'est pas couvert**, aucun retour automatique pour lui)
   - [ ] `systemctl is-active closyria-prod-worker` affiche `active`
   - [ ] `sudo journalctl -u closyria-prod-worker -n 50 --no-pager | grep 'started'` montre la ligne de démarrage,
     de la forme `worker <version> (prod) started`
   - Un worker qui redémarre en boucle (échec de l'amorçage des boutiques, variables `S3_*`, DNS derrière la
     barrière) doit mener à `sudo closyria-deploy prod rollback`, à lancer à la main.
5. [ ] `sudo journalctl -u closyria-prod-worker -n 50 --no-pager | grep 'network barrier'` → `network barrier: active`
6. [ ] Coller un lien Shopify sur https://closyria.com et voir la fiche
7. [ ] Admin : santé visible
8. [ ] Le lendemain : surveillance de 04:00 UTC passée pour les 8 boutiques
9. [ ] Journal sans erreur pendant 15 min : `sudo journalctl -u 'closyria-prod-*' -p warning`, avec l'avertissement
   `seed: domain … is already attached to another shop (starting shop …)` en particulier : fusionner la boutique
   en attente dans la boutique de départ dans l'admin

## Retour arrière

- **Quand** : santé en échec (API ou web), worker qui ne démarre pas ou redémarre en boucle, `network barrier: ABSENT` après recopie de l'unité, captures toutes en erreur
  (typiquement : DNS bloqué par la barrière), erreurs répétées dans le journal.
- **Comment** : `sudo closyria-deploy <env> rollback`. Les migrations ne sont pas annulées (elles n'ajoutent que
  des tables et des colonnes). Si c'est la barrière seule qui gêne, ne pas la retirer à la légère : corriger d'abord
  la cause (`/etc/resolv.conf`), car elle protège le serveur des adresses privées.
