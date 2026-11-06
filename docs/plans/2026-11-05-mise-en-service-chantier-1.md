# Mise en service du chantier 1 (capture de boutiques) — liste de contrôle

> Date : 2026-11-05 · Fait par : la fondatrice (sudo) · Dev : Claude peut lancer `sudo closyria-deploy dev <id>`,
> la prod est réservée à la fondatrice (mot de passe).
> Spec : `docs/specs/2026-11-05-chantier-1-capture-boutiques.md` (§8 et §10). Procédure d'installation :
> `deploy/README.md`, section « Barrière réseau du worker ».

## Avant (sans impact)

- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` au vert ; CI GitHub au vert sur la branche
- [ ] Les cinq variables `S3_*` sont dans `/etc/closyria/dev.env` et `/etc/closyria/prod.env` (le worker lit le même
      fichier que l'API ; toutes ensemble, sinon refus de démarrer)
- [x] `/etc/resolv.conf` pointe toujours vers `127.0.0.53` (`grep nameserver /etc/resolv.conf`) : c'est la seule
      adresse locale autorisée par la barrière ; sinon le worker ne résout plus aucun nom
- [x] Artefact construit depuis une copie à jour : `deploy/build.sh origin/<branche>` → noter l'identifiant ; `sharp`
      est bien dans l'artefact du worker (le script le vérifie)
- [ ] Prod seulement : sauvegarde de la base (`pg_dump`) juste avant

## Dev

1. [x] Copier les unités et recharger systemd :
   ```bash
   sudo cp deploy/systemd/closyria-dev-worker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
2. [x] Déployer : `sudo closyria-deploy dev <id>` (migrations 0007 à 0010 appliquées avant le redémarrage ; au
   démarrage, le worker crée les 18 boutiques de départ). Le contrôle de santé du déploiement ne couvre que l'API et
   le web, **pas le worker** : un échec du worker n'entraîne aucun retour automatique (voir l'étape suivante)
   - [x] `systemctl is-active closyria-dev-worker` affiche `active`
   - [x] `sudo journalctl -u closyria-dev-worker -n 50 --no-pager | grep 'started'` montre la ligne de démarrage,
     de la forme `worker <version> (dev) started`
   - Un worker qui redémarre en boucle (échec de l'amorçage des boutiques, variables `S3_*`, DNS derrière la
     barrière) doit mener à `sudo closyria-deploy dev rollback`, à lancer à la main.
3. [x] Lire la barrière dans le journal du worker dev :
   ```bash
   sudo journalctl -u closyria-dev-worker -n 50 --no-pager | grep 'network barrier'
   ```
   Attendu : `network barrier: active (ETIMEDOUT)`. Si `network barrier: ABSENT (…)` : l'unité n'a pas été recopiée ou
   `daemon-reload` a été oublié ; ne pas passer à la suite.
4. [x] Journal sans erreur ni avertissement inattendu : `sudo journalctl -u 'closyria-dev-*' -p warning -n 50`.
   Puis, à part (Node écrit ses avertissements au niveau « info », que `-p warning` masque) :
   `sudo journalctl -u closyria-dev-worker --no-pager | grep 'seed:'` doit être vide. Sinon,
   `seed: domain … is already attached to another shop (starting shop …)` signale un domaine de départ déjà
   rattaché à une boutique créée avant. Action : dans l'admin, fusionner la boutique en attente dans la boutique
   de départ.
5. [x] Sur https://dev.closyria.com, coller un lien d'article d'une des boutiques de départ : la fiche se remplit
   (nom, prix, photos)
6. [x] Admin (connexion par passkey) : la santé des boutiques est visible
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
5. [ ] `sudo journalctl -u closyria-prod-worker -n 50 --no-pager | grep 'network barrier'` → `network barrier: active (ETIMEDOUT)`
6. [ ] Coller un lien Shopify sur https://closyria.com et voir la fiche
7. [ ] Admin : santé visible
8. [ ] Le lendemain : surveillance de 04:00 UTC passée pour les 8 boutiques
9. [ ] Journal sans erreur pendant 15 min : `sudo journalctl -u 'closyria-prod-*' -p warning`. Puis
   `sudo journalctl -u closyria-prod-worker --no-pager | grep 'seed:'` doit être vide ; sinon
   (`seed: domain … is already attached to another shop (starting shop …)`), fusionner la boutique en attente dans
   la boutique de départ dans l'admin

## Chantier 2a (« Garder ») : mise en service avec le chantier 1

> Le 2a part en prod **avec** le chantier 1 (spec `docs/specs/2026-11-05-chantier-2a-garder.md`, §9). Les étapes
> ci-dessus restent valables ; cette section ajoute ce qui change. Dev d'abord, prod seulement après les tests de la
> fondatrice.

### Ce qui change

- **Migrations 0007 à 0012** appliquées par le déploiement avant le redémarrage. Ce ne sont pas que des ajouts : 0008
  ajoute `captures.url` NOT NULL sans valeur par défaut (sans risque seulement parce que `captures` est vide avant le
  premier déploiement du chantier 1), 0009 retire NOT NULL de `products.name`, `currency` et `price_cents`, 0010
  recrée une contrainte CHECK. Liste : 0007 `catalog` · 0008 `capture_url` · 0009 `product_nullable_fields` · 0010
  `capture_queue_unavailable` (chantier 1) ; 0011 `reference_and_product_fields` (catégories, couleurs, champs de la
  fiche) · 0012 `wardrobe` (articles, profils, listes, étiquettes, événements d'étape).
- **Listes de référence** (catégories, couleurs…) créées par le worker à son démarrage, en plus des boutiques de
  départ. Ligne « info » attendue au premier démarrage : `sudo journalctl -u closyria-<env>-worker --no-pager | grep 'starting reference lists'`
  (`starting reference lists: N added`). Chaque table de référence n'est remplie que si elle est vide. Les filtres
  Type et Couleur restent vides tant que le worker n'a pas démarré une fois (création des listes) ; `/api/reference`
  est mis en cache 1 h, donc ils peuvent mettre jusqu'à une heure à apparaître après le premier démarrage. Les lignes `seed:` sont des avertissements (par exemple
  `seed: parent … is missing, skipped`) et doivent être absentes : `… | grep 'seed:'` vide.
- **Nouvelle file `wardrobe-purge`** : vide la corbeille (articles supprimés depuis plus de 30 jours) chaque nuit à
  03:30 UTC. Le worker la crée et la planifie seul ; ligne de journal `trash purge: N item(s) permanently deleted`
  seulement quand il y a eu des suppressions.

### Dev

> Le chantier 1 est déjà déployé sur dev (0007 à 0010 appliquées, captures présentes) : pour dev, seules 0011 et 0012
> sont nouvelles.

1. [ ] `sudo closyria-deploy dev <id>` : migrations 0011 et 0012 appliquées, worker `active`, `network barrier: active`
2. [ ] Journal du worker dev : `grep 'starting reference lists'` montre la ligne, `grep 'seed:'` est vide ; les filtres Type et Couleur se chargent
3. [ ] Coller un lien d'article, appuyer sur ♡ : l'article est dans « Envies » ; « Annuler » le retire
4. [ ] Changer l'étape (« Reçu » avec un prix payé) : il passe dans « Dressing » ; « Annuler » le remet
5. [ ] Créer une liste, y mettre un article, la partager, ouvrir le lien dans une fenêtre privée : ni notes ni taille
   visibles ; « Arrêter le partage » puis recharger : page « Ce lien ne marche plus »
6. [ ] Créer un second profil, y déplacer deux articles, changer de profil en haut de page
7. [ ] Anonyme avec 3 articles : le bandeau propose un compte ; connexion par code : les articles sont toujours là
8. [ ] Sur iPhone : l'aide « Ajouter Closyria au menu Partager » (Réglages) et le Raccourci fonctionnent
9. [ ] Purge : rien à vérifier à la main (aucun article n'a 30 jours) ; le lendemain, pas d'erreur de `wardrobe-purge`
   dans `sudo journalctl -u closyria-dev-worker --no-pager | grep 'wardrobe-purge'`

### Prod

- [ ] **Prérequis : « Sauvegardes automatiques de la prod »** livrées et la restauration essayée (copie chiffrée de la
  base chaque nuit sur OVH, gardée 30 jours ; spec 2a §9). Sans elles, pas de prod : les articles des utilisatrices
  seront des données à ne pas perdre.
- [ ] Premier déploiement de 0007 à 0012 ensemble : `select count(*) from captures;` en prod → 0, sinon 0008 échoue (`url` NOT NULL sans défaut)
- [ ] Les étapes « Prod » ci-dessus (variables comparées, barrière, déploiement), avec migrations 0007 à 0012
- [ ] `grep 'starting reference lists'` présent au premier démarrage, `grep 'seed:'` vide ; filtres Type et Couleur chargés sur https://closyria.com
- [ ] Parcours ♡, étape, liste partagée (fenêtre privée), profil, comme en dev
- [ ] Le lendemain : pas d'erreur de `wardrobe-purge` dans le journal du worker prod

## Retour arrière

- **Quand** : santé en échec (API ou web), worker qui ne démarre pas ou redémarre en boucle, `network barrier: ABSENT` après recopie de l'unité, captures toutes en erreur
  (typiquement : DNS bloqué par la barrière), erreurs répétées dans le journal.
- **Comment** : `sudo closyria-deploy <env> rollback`. Les migrations ne sont pas annulées : le retour arrière du
  code reste sans danger avec ces changements de schéma en place (colonnes devenues facultatives, nouvelles tables et
  colonnes, contrainte recréée). Si c'est la barrière seule qui gêne, ne pas la retirer à la légère : corriger d'abord
  la cause (`/etc/resolv.conf`), car elle protège le serveur des adresses privées.
- **Danger dès que des utilisatrices gardent des articles** : le code du chantier 1 ne déclare pas les tables du
  dressing (articles, profils, listes) comme données du compte. Une utilisatrice anonyme qui se connecte pendant un
  retour arrière perdrait ses articles, profils et listes (son utilisateur anonyme est supprimé et les lignes
  disparaissent en cascade). Un retour arrière doit donc être **immédiat** (quelques minutes, avant tout usage réel) ;
  sinon, corriger en avant (nouveau déploiement) plutôt que revenir au code du chantier 1.
