# Sauvegardes automatiques de la prod — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chaque nuit, une copie chiffrée de la base prod part sur OVH, gardée 30 jours et impossible à effacer avant ;
elle est restaurée automatiquement chaque matin pour prouver qu'elle sert, et toute panne envoie un e-mail.

**Architecture:** deux scripts bash (`closyria-backup`, `closyria-backup-check`) lancés par des minuteries systemd,
par environnement (`@dev`, `@prod`). `pg_dump` → chiffrement `age` (clé publique sur le serveur) → bucket OVH dédié,
dans une autre région que le serveur, avec verrou d'objet (Object Lock, mode « compliance », 30 jours). La
vérification télécharge la dernière copie, la déchiffre, la restaure dans une base jetable et la compare à la base
vivante. `closyria-deploy prod` fait une sauvegarde avant toute migration.

**Tech Stack:** bash, PostgreSQL 18 (`pg_dump`/`pg_restore`), `age` 1.2 (Debian), AWS CLI (`/usr/bin/aws`) vers OVH
Object Storage, systemd (services `oneshot` + minuteries), Brevo (API HTTP) pour les alertes, Vitest pour les tests.

**Spec:** `docs/specs/2026-11-05-chantier-2a-garder.md` §9 (« copie chiffrée de la base chaque nuit sur OVH, gardée
30 jours, essai de restauration ») ; conception `docs/specs/2026-11-01-v1-conception.md` §9 (« sauvegardes déjà
chiffrées ») et §10 (« suppression réelle (sauvegardes expirées sous 30 jours) »).

## Décisions (à valider par la fondatrice avant l'exécution)

| # | Décision | Recommandation | Pourquoi / ce que ça coûte |
|---|---|---|---|
| S1 | Où | Bucket **`closyria-backups`**, OVH Object Storage, région **Strasbourg (`sbg`)**, autre site que le serveur et les photos (Gravelines). Préfixes `prod/` et `dev/`. | Un incendie ou une panne d'un site (OVH SBG 2021) n'emporte pas la base et sa copie. Quelques centimes par mois. |
| S2 | Effacement impossible | Verrou d'objet en mode **compliance, 30 jours** (activé à la création du bucket, avec le versionnage) + règle d'expiration à **31 jours**. Utilisateur S3 dédié : écrire, lire, lister, **pas effacer**. | Même avec les clés du serveur volées, personne (ni nous) ne peut effacer ou remplacer une copie de moins de 30 jours. Après 31 jours elle disparaît seule (RGPD, §10). |
| S3 | Chiffrement | `age`. Clé publique dans la config du serveur (sert à chiffrer). Clé privée : un fichier root du serveur (pour la vérification de chaque matin) **et** une copie dans ton gestionnaire de mots de passe. | Les copies chez OVH sont illisibles sans la clé. Sans la copie hors du serveur, perdre le serveur = perdre toutes les sauvegardes. |
| S4 | Fréquence | Chaque nuit à **03:30 UTC**, et **avant chaque déploiement prod** (le déploiement s'arrête si la sauvegarde échoue). | On perd au pire une journée. Plus fin (journaux continus, « PITR ») : plus tard si le volume le justifie. |
| S5 | Essai de restauration | **Chaque matin à 05:00 UTC**, automatique : dernière copie téléchargée, déchiffrée, restaurée dans une base jetable, comparée, effacée. Une restauration complète de la dev est aussi faite une fois à la main (tâche 4). | Une sauvegarde jamais restaurée ne prouve rien. Détecte aussi une nuit sans sauvegarde (copie trop vieille). |
| S6 | Alertes | Un **e-mail** (Brevo) à ton adresse à chaque échec de sauvegarde ou de vérification. Rien quand tout va bien. | Sans alerte, une sauvegarde cassée passe inaperçue des semaines. |
| S7 | Photos | **Pas dans ce chantier.** Elles sont déjà chez OVH (stockage redondant). Le risque restant (effacement par erreur) est noté pour plus tard. | Les copier avec effacement sous 30 jours demande un mécanisme à part ; la base est la donnée la plus précieuse. |
| S8 | Dev | Mêmes scripts installés **d'abord en dev** (une nuit d'essai), puis en prod. | On essaie tout sans risque avant de toucher la prod. |

## Global Constraints

- Ne rien toucher de qorvon (comptes, bases, rôles PostgreSQL) ; les commandes ne visent que les bases `closyria` et `closyria_dev`.
- Jamais de secret dans le dépôt ni dans le chat : clés S3, clé privée `age`, clé Brevo et adresse d'alerte vont dans `/etc/closyria/backup.env` et `/etc/closyria/backup.key` (root:root 600), écrits par la fondatrice.
- Toutes les commandes sudo sont lancées par la fondatrice ; Claude écrit les scripts et les tests, et lance seulement les tests locaux.
- Nom des copies : `<env>/closyria-<env>-<AAAAMMJJTHHMMSSZ>.dump.age` (UTC), format `pg_dump -Fc`.
- Les scripts : `set -euo pipefail`, aucun mot de passe ni clé dans leurs sorties ou dans le journal.
- Les scripts acceptent `BACKUP_STORE` = `s3://<bucket>` (serveur) ou un chemin de dossier local (tests) ; aucune autre différence de chemin entre tests et serveur.

## Review Focus

1. Un `pg_dump` qui échoue au milieu du tube ne doit jamais laisser une copie tronquée considérée comme bonne (`pipefail`, vérification de taille non nulle, et la vérification du matin la rejette).
2. Une nuit sans sauvegarde (minuterie arrêtée, serveur éteint) doit déclencher une alerte : la vérification refuse une copie de plus de **26 h**.
3. La vérification ne doit jamais toucher la base vivante en écriture ni laisser la base jetable derrière elle, même si elle échoue (`trap` qui supprime la base et le fichier déchiffré).
4. La clé privée ne doit jamais être lisible par les comptes de l'appli (`closyria`, `closyria-dev`) : elle passe par `LoadCredential=` au seul service de vérification.
5. Un déploiement prod dont la sauvegarde échoue ne doit appliquer aucune migration.

---

### Task 1: Scripts de sauvegarde, de vérification et d'alerte

**Files:**
- Create: `deploy/backup/closyria-backup`, `deploy/backup/closyria-backup-check`, `deploy/backup/closyria-backup-alert`, `deploy/backup/lib.sh`
- Test: `scripts/backup.test.ts`

**Interfaces:**
- Produces:
  - `closyria-backup <dev|prod>` : lit `DATABASE_URL`, `BACKUP_STORE`, `BACKUP_AGE_RECIPIENT` ; écrit `<env>/closyria-<env>-<horodatage>.dump.age` et imprime son nom ; sortie ≠ 0 si quoi que ce soit échoue.
  - `closyria-backup-check <dev|prod>` : lit `DATABASE_URL` (base vivante, lecture seule), `BACKUP_STORE`, `BACKUP_AGE_IDENTITY` (chemin de la clé privée), `BACKUP_MAX_AGE_HOURS` (défaut 26), `BACKUP_SCRATCH_DB` (défaut `closyria_restore_check`), `BACKUP_ADMIN_URL` (connexion à la base `postgres` pour créer/supprimer la base jetable) ; imprime `ok: <copie> restored, <n> tables` ou échoue avec la raison.
  - `closyria-backup-alert <nom d'unité>` : lit `BREVO_API_KEY`, `BACKUP_ALERT_TO`, `MAIL_FROM` ; envoie « Closyria : <unité> a échoué » avec les 30 dernières lignes de `journalctl -u <unité>` ; sans `BREVO_API_KEY` (tests) écrit le message sur la sortie.
  - `lib.sh` : `store_put <clé>` (stdin → magasin), `store_get <clé>` (magasin → stdout), `store_latest <préfixe>` (nom de la plus récente, vide si aucune), `store_age_hours <clé>`. S3 via `aws s3 cp`/`aws s3api list-objects-v2` avec `--endpoint-url "$S3_ENDPOINT"` ; dossier local via `cp`/`ls`.

- [ ] **Step 1: Write the failing tests** (`scripts/backup.test.ts`, base jetable `startTestDatabase()` + `migrateTestDatabase()` de `@closyria/testing`, clé générée par `age-keygen` dans un dossier temporaire, `BACKUP_STORE` = dossier temporaire) :
  - `sauvegarde puis vérification : la copie est chiffrée et se restaure` — après `closyria-backup dev`, un seul fichier `dev/closyria-dev-*.dump.age` ; ses premiers octets sont `age-encryption.org/v1` ; il ne contient pas le texte d'une ligne insérée avant (table `"user"`, e-mail `secret-de-test@example.com`) ; `closyria-backup-check dev` sort 0 et imprime `ok:` ; la base jetable n'existe plus après.
  - `une copie de plus de 26 h est refusée` — fichier daté de 27 h (`touch -d`) : sortie ≠ 0, message contenant `older than 26 h`.
  - `aucune copie : la vérification échoue` — sortie ≠ 0, message `no backup`.
  - `pg_dump en échec : pas de copie` — `DATABASE_URL` vers une base inexistante : sortie ≠ 0 et aucun fichier dans le magasin.
  - `une copie tronquée est refusée et la base jetable est supprimée` — copie coupée à la moitié : vérification ≠ 0, base jetable absente.
  - `une table manquante dans la copie est signalée` — table créée dans la base vivante après la sauvegarde : vérification ≠ 0, message nommant la table.
  - `l'alerte sans Brevo écrit le message` — `closyria-backup-alert closyria-backup@dev.service` sans clé : sortie 0, texte contenant `closyria-backup@dev.service`.
- [ ] **Step 2:** `pnpm --filter @closyria/scripts test` → les 7 tests échouent (scripts absents).
- [ ] **Step 3: Implement** les quatre fichiers. Comparaison de la vérification : liste des tables de `public`, `drizzle` et `pgboss` identique entre copie et base vivante ; nombre de lignes de `drizzle.__drizzle_migrations` identique ; pour `"user"`, `items`, `products` : nombre restauré ≥ 90 % du nombre vivant. `pg_restore --exit-on-error --no-owner --no-acl`. `trap` qui supprime la base jetable et le fichier déchiffré (dans `$(mktemp -d)`) dans tous les cas.
- [ ] **Step 4:** les 7 tests passent ; `bash -n` sur les quatre scripts ; `pnpm lint`.
- [ ] **Step 5: Commit** `feat(deploy): scripts de sauvegarde chiffrée et de vérification par restauration`.

### Task 2: Unités systemd, sauvegarde avant déploiement prod, documentation

**Files:**
- Create: `deploy/systemd/closyria-backup@.service`, `closyria-backup@.timer`, `closyria-backup-check@.service`, `closyria-backup-check@.timer`, `closyria-backup-alert@.service`
- Modify: `deploy/closyria-deploy` (avant « migrating »), `deploy/README.md` (section « Sauvegardes » : installation, restauration en cas de sinistre), `docs/plans/2026-11-05-mise-en-service-chantier-1.md` (prérequis)

**Interfaces:**
- Consumes: les scripts de la tâche 1, installés dans `/usr/local/bin/` (root:root 755).
- Produces: `systemctl start closyria-backup@prod.service` (synchrone) utilisé par `closyria-deploy`.

- [ ] **Step 1: Write the units.**
  - `closyria-backup@.service` : `Type=oneshot`, l'utilisateur dépend de l'environnement, donc il est fixé par deux fichiers complémentaires `deploy/systemd/closyria-backup@prod.service.d/user.conf` (`User=closyria`) et `closyria-backup@dev.service.d/user.conf` (`User=closyria-dev`), `EnvironmentFile=/etc/closyria/%i.env` puis `/etc/closyria/backup.env`, `Environment=HOME=/tmp`, `PrivateTmp=yes`, `ProtectSystem=strict`, `NoNewPrivileges=yes`, `OnFailure=closyria-backup-alert@%n.service`, `ExecStart=/usr/local/bin/closyria-backup %i`.
  - `closyria-backup@.timer` : `OnCalendar=*-*-* 03:30:00 UTC`, `Persistent=true`, `RandomizedDelaySec=5min`.
  - `closyria-backup-check@.service` : `Type=oneshot`, `User=postgres`, mêmes `EnvironmentFile`, `LoadCredential=age-identity:/etc/closyria/backup.key`, `Environment=BACKUP_AGE_IDENTITY=%d/age-identity`, `Environment=BACKUP_ADMIN_URL=postgresql:///postgres?host=/var/run/postgresql`, `OnFailure=` comme ci-dessus.
  - `closyria-backup-check@.timer` : `OnCalendar=*-*-* 05:00:00 UTC`, `Persistent=true`.
  - `closyria-backup-alert@.service` : `Type=oneshot`, `EnvironmentFile=/etc/closyria/backup.env`, `ExecStart=/usr/local/bin/closyria-backup-alert %i`.
- [ ] **Step 2:** `systemd-analyze verify deploy/systemd/closyria-backup*` sans erreur (hors chemins absents en local).
- [ ] **Step 3:** `closyria-deploy`, cas `prod` seulement, juste avant `echo "migrating …"` : `echo "backing up prod"` puis `systemctl start closyria-backup@prod.service || die "backup failed: nothing deployed (journalctl -u closyria-backup@prod)"`.
- [ ] **Step 4:** README : variables de `backup.env` (`BACKUP_STORE`, `BACKUP_AGE_RECIPIENT`, `S3_ENDPOINT` de Strasbourg, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION=sbg`, `BREVO_API_KEY`, `MAIL_FROM`, `BACKUP_ALERT_TO`), installation, et « Restaurer la prod » pas à pas (arrêter `closyria-prod.target`, base renommée en `closyria_old` plutôt que supprimée, `pg_restore` dans une base `closyria` neuve, redémarrer, vérifier, supprimer `closyria_old` le lendemain).
- [ ] **Step 5: Commit** `feat(deploy): minuteries de sauvegarde et de vérification, sauvegarde avant déploiement prod`.

### Task 3: Installation sur le serveur, en dev d'abord (fondatrice, avec Claude)

**Files:** aucun dans le dépôt (sauf cases cochées de ce plan).

- [ ] **Step 1 (console OVH, fondatrice) :** créer le bucket `closyria-backups` en région Strasbourg **avec verrou d'objet** (ne s'active qu'à la création), rétention par défaut compliance 30 jours ; créer l'utilisateur S3 `closyria-backups` avec une politique limitée au bucket : `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` (pas de `DeleteObject`).
- [ ] **Step 2 (fondatrice) :** règle d'expiration à 31 jours (et versions non courantes à 1 jour) avec `aws s3api put-bucket-lifecycle-configuration` (commande exacte fournie par Claude, clés tapées par toi dans le terminal) ; vérifier avec `get-bucket-lifecycle-configuration` et `get-object-lock-configuration`.
- [ ] **Step 3 (fondatrice, sudo) :** `sudo apt install age` ; `sudo age-keygen -o /etc/closyria/backup.key` (affiche la clé publique) ; `sudo chmod 600` ; **copier le contenu de la clé privée dans ton gestionnaire de mots de passe** ; écrire `/etc/closyria/backup.env` (root:root 600).
- [ ] **Step 4 (fondatrice, sudo) :** copier les scripts dans `/usr/local/bin/` et les unités dans `/etc/systemd/system/`, `daemon-reload`, puis `sudo systemctl start closyria-backup@dev.service` et `sudo systemctl start closyria-backup-check@dev.service` → `ok:` dans `journalctl -u closyria-backup-check@dev`.
- [ ] **Step 5 :** essayer l'effacement : `aws s3 rm` de la copie dev → **refusé**. Essayer l'alerte : `sudo systemctl start closyria-backup-alert@test.service` → e-mail reçu.
- [ ] **Step 6 :** activer les minuteries dev (`systemctl enable --now closyria-backup@dev.timer closyria-backup-check@dev.timer`) ; le lendemain, `systemctl list-timers 'closyria-backup*'` et copie de la nuit présente.

### Task 4: Restauration complète de la dev, puis la prod

- [ ] **Step 1 :** suivre « Restaurer la prod » du README, **sur la dev** : `closyria-dev.target` arrêté, base remplacée par la copie de la nuit, redémarrée ; tes articles de test sont là sur https://dev.closyria.com. Corriger le README si une étape manque.
- [ ] **Step 2 :** activer la prod : `systemctl start closyria-backup@prod.service`, puis `closyria-backup-check@prod.service` → `ok:` ; `enable --now` des deux minuteries prod.
- [ ] **Step 3 :** cocher le prérequis dans `docs/plans/2026-11-05-mise-en-service-chantier-1.md` ; bilan dans ce plan ; commit `docs: sauvegardes de la prod en place`.

## Bilan

(à remplir à la fin)
