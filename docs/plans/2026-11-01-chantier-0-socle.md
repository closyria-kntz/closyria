# Chantier 0 — Socle V1 : plan d'implémentation

> **Pour les agents :** sous-skill requis : `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans`, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**But :** poser tout ce dont les chantiers 1 à 6 ont besoin : tokens de design et thèmes, traductions, comptes
(anonyme puis sans mot de passe), droits, photos sur OVH, mesure d'audience, coque de l'admin, en-têtes de sécurité
et HSTS, tests contre une vraie base et tests de bout en bout.

**Architecture :** de nouveaux paquets à rôle unique (`design-tokens`, `i18n`, `auth`, `entitlements`, `storage`,
`testing`) branchés sur l'API Hono et le web Next existants. L'API reste la seule porte d'accès aux données. Le web
ne contient aucune valeur de style en dur : tout passe par des variables CSS générées depuis `design-tokens`.

**Stack :** Node 26, pnpm 12, TypeScript 7, Hono 4.13, Next 16.4, Tailwind 4.3, Drizzle 0.45, PostgreSQL 18,
better-auth 1.7 (+ `@better-auth/passkey`), next-intl 4.14, sharp 0.35, `@aws-sdk/client-s3`, Vitest 5,
Playwright 1.64 + `@axe-core/playwright`, cmdk.

**Spec :** `docs/specs/2026-11-01-v1-conception.md` (sections 5, 6, 8, 9, 10, 11, 12).

## Contraintes globales

- Code en anglais, interface et documentation en français (`CLAUDE.md`).
- Toute donnée qui traverse une frontière est validée avec Zod ; les schémas partagés vivent dans `packages/shared`.
- **Aucune valeur de style en dur** dans `apps/web` : ni couleur, ni taille, ni durée, ni ombre hors tokens (tâche 3).
- Montants en centimes, dates en UTC (spec §6).
- Code e-mail : **6 chiffres, valable 10 minutes, 5 essais** (spec §9).
- Aucune donnée personnelle dans les journaux ; aucune adresse IP stockée par la mesure d'audience (spec §9, D12).
- Photos ré-encodées, **toutes métadonnées supprimées, dont le GPS** (spec §9).
- L'admin exige le rôle `admin` **et** une session ouverte par passkey ; chaque action admin est journalisée (spec §8).
- Aucun accès Internet dans les tests (spec §11).
- Rien n'entre dans `main` sans CI au vert.

## Points de vigilance (non couverts par la spec, testés dans la tâche indiquée)

1. **Deux onglets ouverts en même temps à la première visite** → une seule session anonyme, pas deux (tâche 6).
2. **Une anonyme se connecte avec un e-mail qui a déjà un compte** → ses données rejoignent ce compte, sans erreur
   ni perte (tâche 6).
3. **Photo HEIC d'iPhone, fichier non image ou de 40 Mo** → refus clair (« Format non pris en charge » / « Photo trop
   lourde, 20 Mo maximum »), jamais d'erreur 500 (tâche 10).
4. **Admin sur un appareil sans passkey** → message clair qui explique comment enregistrer une passkey, pas de
   boucle de redirection (tâche 12).
5. **Une préférence « réduire les animations » du système** → les thèmes respectent `prefers-reduced-motion`
   (tâche 2). C'est indispensable pour les futurs thèmes saisonniers animés.

---

### Tâche 1 : Base PostgreSQL de test

**Fichiers :**
- Créer : `packages/testing/package.json`, `packages/testing/src/postgres.ts`, `packages/testing/src/index.ts`
- Créer : `packages/testing/src/postgres.test.ts`
- Modifier : `.github/workflows/ci.yml` (service `postgres:18`, variable `TEST_DATABASE_URL`), `turbo.json` (`test` dépend de `^build`, variable globale `TEST_DATABASE_URL`)

**Interfaces :**
- Produit : `startTestDatabase(): Promise<{ url: string; stop(): Promise<void> }>`. Si `TEST_DATABASE_URL` est défini (CI), crée une base jetable `test_<aléatoire>` dans ce serveur. Sinon, lance un cluster éphémère avec `initdb`/`pg_ctl` de `/usr/lib/postgresql/18/bin` dans un dossier temporaire, sur un socket Unix, sans sudo.
- Produit : `migrateTestDatabase(url: string): Promise<void>` qui applique `packages/db/migrations` via `runMigrations`.

- [ ] **Étape 1 : test qui échoue** — `postgres.test.ts` : `startTestDatabase()` renvoie une URL, `select 1` y répond `1`, `stop()` rend l'URL injoignable.
- [ ] **Étape 2 :** `pnpm --filter @closyria/testing test` → ÉCHEC (module absent).
- [ ] **Étape 3 :** implémenter `startTestDatabase` et `migrateTestDatabase`.
- [ ] **Étape 4 :** le test passe en local (cluster éphémère) et en CI (service).
- [ ] **Étape 5 :** commit `test: add disposable PostgreSQL for integration tests`.

### Tâche 2 : Tokens de design et mécanisme de thèmes

**Fichiers :**
- Créer : `packages/design-tokens/src/{primitives.ts,semantic.ts,theme.ts,css.ts,index.ts}`, `packages/design-tokens/src/css.test.ts`, `packages/design-tokens/scripts/build-css.ts`
- Modifier : `apps/web/src/app/globals.css` (importe le CSS généré, remet à zéro le thème Tailwind par défaut), `apps/web/package.json` (étape `prebuild`/`predev` qui génère le CSS)

**Interfaces :**
- Produit : trois niveaux de tokens. **Primitifs** (palette brute, échelle d'espacement, rayons, typographies, durées, courbes d'animation, ombres). **Sémantiques**, les seuls utilisés par l'interface (`surface`, `surface-raised`, `ink`, `ink-muted`, `accent`, `accent-ink`, `danger`, `success`, `focus-ring`, `space-*`, `radius-*`, `text-*`, `motion-*`…). **Composants** quand un composant en a besoin (`button-*`, `card-*`).
- Produit : `themeSchema` (Zod) = `{ id, name, base: "light" | "dark", tokens: Partial<SemanticTokens>, decorations?: DecorationSet }`. `DecorationSet` est **réservé** pour les thèmes saisonniers du chantier 4 (illustrations, animations, images d'en-tête, textes d'accroche). Il est défini et validé dès maintenant, mais sans rendu.
- Produit : `renderThemeCss(theme: Theme): string`. Il produit les variables CSS sous `[data-theme="<id>"]`, plus un bloc `@media (prefers-reduced-motion: reduce)` qui met toutes les durées `motion-*` à `0ms`.
- Produit : thèmes `atelier-light` et `atelier-dark`, aux **valeurs provisoires** reprises de l'ancienne charte « Atelier ». Les valeurs définitives viennent de la tâche 4.
- Tailwind : `@theme { --*: initial; … }`, si bien que seules les classes issues de nos tokens existent (`bg-surface`, `text-ink`, `p-space-4`…).

- [ ] **Étape 1 : tests qui échouent** — `renderThemeCss(atelierLight)` contient `--color-surface:` et ne contient aucune clé primitive ; un thème avec une clé inconnue est refusé par `themeSchema` ; la sortie contient `prefers-reduced-motion` avec `--motion-duration-base: 0ms`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter les tokens, le schéma et `renderThemeCss` ; générer `apps/web/src/styles/tokens.css`.
- [ ] **Étape 4 :** tests au vert ; `pnpm --filter @closyria/web build` passe ; la page d'accueil n'utilise plus que des classes issues des tokens.
- [ ] **Étape 5 :** commit `feat(design): token layers and theme mechanism`.

### Tâche 3 : Garde « aucune valeur en dur »

**Fichiers :**
- Créer : `scripts/check-design-tokens.ts`, `scripts/check-design-tokens.test.ts`
- Modifier : `package.json` racine (`lint` = `biome check . && node scripts/check-design-tokens.ts`)

**Interfaces :**
- Produit : `findHardcodedStyles(source: string, file: string): Violation[]` avec `Violation = { file, line, match, rule }`. Il refuse dans `apps/web/src/**/*.{ts,tsx,css}`, hors fichiers générés :
  - les couleurs littérales : `#rgb`, `#rrggbb`, `rgb(`, `hsl(`, `oklch(` ;
  - les valeurs Tailwind arbitraires : `[…px]`, `[#…]`, `[…ms]` ;
  - les attributs `style={{…}}` qui contiennent un nombre suivi d'une unité.

- [ ] **Étape 1 : tests qui échouent** — `className="bg-[#fff]"` donne 1 violation `arbitrary-value` ; `color: #1e1b15;` dans un `.css` du web donne `literal-color` ; `className="bg-surface p-space-4"` donne 0 ; le fichier généré `tokens.css` est ignoré.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter (expressions régulières par règle, numéros de ligne).
- [ ] **Étape 4 :** tests au vert ; `pnpm lint` passe sur le dépôt.
- [ ] **Étape 5 :** commit `chore(lint): forbid hard-coded style values in web`.

### Tâche 4 : Spec « Direction visuelle » (sans code)

**Livrable :** `docs/specs/2026-11-xx-direction-visuelle.md`, validée par la fondatrice.

- [ ] **Étape 1 :** brainstorming (`superpowers:brainstorming`, avec le compagnon visuel et des maquettes) et `frontend-design` : personnalité, palette, typographies, échelle, rayons, ombres, mouvements, iconographie, ton (`design:ux-copy`), écrans clés de la V1 sur mobile puis ordinateur, mode sombre.
- [ ] **Étape 2 :** spec des **thèmes saisonniers** : ce qu'un thème peut changer (tokens, illustrations, animations, images, textes), règles de lisibilité et de contraste, budget de poids et de performance, désactivation par l'utilisatrice, programmation par dates. Le moteur et l'admin des thèmes sont livrés au **chantier 4**, avec le calendrier.
- [ ] **Étape 3 :** remplacer les valeurs provisoires de la tâche 2 par les valeurs validées ; contrôle des contrastes AA (`design:accessibility-review`).
- [ ] **Étape 4 :** commit `docs: visual direction spec` puis `feat(design): final token values`.

### Tâche 5 : Traductions

**Fichiers :**
- Créer : `packages/i18n/src/{index.ts,locales.ts}`, `packages/i18n/messages/{fr,en,es}.json`, `packages/i18n/src/messages.test.ts`
- Modifier : `apps/web` (next-intl, `src/i18n/request.ts`, `layout.tsx` et `page.tsx` sans texte en dur)

**Interfaces :**
- Produit : `locales = ["fr", "en", "es"] as const`, `enabledLocales = ["fr"]`, `defaultLocale = "fr"`, `loadMessages(locale): Messages`. Une clé absente en `en`/`es` retombe sur `fr`.
- L'URL ne contient pas la langue en V1 : la langue vient du profil ou, à défaut, de `fr`.

- [ ] **Étape 1 : tests qui échouent** — chaque langue de `enabledLocales` possède toutes les clés de `fr.json` ; toutes les clés de `en.json` et `es.json` existent dans `fr.json` (pas de clé orpheline) ; chaque message se compile en ICU sans erreur.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter ; déplacer les textes de `layout.tsx` et `page.tsx` dans `fr.json`.
- [ ] **Étape 4 :** tests au vert, build du web au vert.
- [ ] **Étape 5 :** commit `feat(i18n): message catalogs and next-intl`.

### Tâche 6 : Comptes — anonyme puis code e-mail

**Fichiers :**
- Créer : `packages/auth/src/{server.ts,mailer.ts,client.ts,index.ts}`, `packages/auth/src/auth.integration.test.ts`
- Créer : `packages/db/src/schema/auth.ts` (tables générées par `@better-auth/cli generate`, adaptateur Drizzle) + migration
- Modifier : `apps/api/src/app.ts` (monte `/api/auth/*`), `apps/api/src/env.ts` (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `MAIL_TRANSPORT`, `BREVO_API_KEY` optionnel)

**Interfaces :**
- Produit : `createAuth(deps: { db; mailer: Mailer; baseUrl: string; secret: string }): Auth`. Plugins `anonymous` et `emailOTP` (`otpLength: 6`, `expiresIn: 600`, `allowedAttempts: 5`), limitation de débit de Better Auth stockée en base.
- Produit : `type Mailer = { send(msg: { to: string; subject: string; text: string; html: string }): Promise<void> }`, avec `brevoMailer(apiKey)` (API REST Brevo) et `memoryMailer()` pour les tests et le développement (garde les messages, les écrit dans le journal sans l'adresse).
- Produit : `registerOwnedTable(table, userIdColumn)` et `reassignUserData(fromUserId, toUserId, tx)`, appelés par le crochet `onLinkAccount` du plugin anonyme. Chaque chantier y enregistre ses tables d'utilisatrice.
- Produit : `getSession(headers): Promise<Session | null>` pour l'API.

- [ ] **Étape 1 : tests qui échouent** (vraie base, tâche 1) :
  - une connexion anonyme crée une session ;
  - deux connexions anonymes simultanées avec le même cookie de départ ne créent qu'un seul utilisateur (point de vigilance 1) ;
  - un code envoyé fait 6 chiffres ;
  - un code juste ouvre une session ;
  - au 6e essai faux, même le bon code est refusé ;
  - un code de plus de 10 minutes est refusé ;
  - une ligne d'une table enregistrée appartenant à l'anonyme appartient au compte après connexion par code ;
  - si l'e-mail a déjà un compte, les lignes rejoignent ce compte existant (point de vigilance 2).
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter `createAuth`, les mailers, le registre de tables, le montage dans l'API.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(auth): anonymous sessions and email one-time codes`.

### Tâche 7 : Comptes — Google, Apple, passkey, rôle admin

**Fichiers :**
- Modifier : `packages/auth/src/server.ts`, `apps/api/src/env.ts` (`GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`, optionnels)
- Créer : `packages/auth/src/providers.integration.test.ts`

**Interfaces :**
- Produit : Google et Apple activés **seulement si leurs variables sont présentes**. Ça permet de démarrer avant d'avoir les comptes développeur (prérequis spec §13).
- Produit : plugin `admin` (rôles `user` | `admin`) et plugin `passkey`. Champ additionnel de session `authMethod` (`"anonymous" | "email-otp" | "google" | "apple" | "passkey"`), renseigné par un crochet après chaque connexion.
- Produit : `deploy/README.md`, section « Donner le rôle admin » : une commande SQL documentée que la fondatrice lance une fois.

- [ ] **Étape 1 : tests qui échouent** — sans variables Google, `/api/auth/sign-in/social` avec `google` répond 404 ou 400, pas 500 ; un utilisateur promu `admin` a `role === "admin"` ; une session ouverte par passkey (authentificateur WebAuthn simulé) porte `authMethod === "passkey"`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(auth): social providers, passkeys and admin role`.

### Tâche 8 : Classement des routes et tests d'isolation

**Fichiers :**
- Créer : `apps/api/src/access.ts`, `apps/api/src/access.test.ts`

**Interfaces :**
- Produit : `defineAccess(route, level: "public" | "user" | "admin")` et `accessMiddleware`. Une route `user` sans session répond 401 ; une route `admin` sans rôle admin ou sans passkey répond 403.
- Produit : un test qui parcourt `/api/openapi.json` et **échoue si une route n'a pas de niveau déclaré**. C'est le socle des tests d'isolation de chaque chantier (spec §11 : 100 % des routes).

- [ ] **Étape 1 : tests qui échouent** — une route sans `defineAccess` fait échouer le test de parcours ; `GET /api/health` est `public` ; une route `user` sans cookie répond 401.
- [ ] **Étape 2 → 4 :** implémenter, tests au vert.
- [ ] **Étape 5 :** commit `feat(api): declared access levels for every route`.

### Tâche 9 : Droits et limites

**Fichiers :**
- Créer : `packages/entitlements/src/{index.ts,keys.ts}`, `packages/db/src/schema/entitlements.ts` + migration, `packages/entitlements/src/entitlements.integration.test.ts`

**Interfaces :**
- Produit : tables `plans` (id, nom, visible, version), `plan_entitlements` (plan_id, key, limit | enabled), `user_plans` (user_id, plan_id, début, fin, source : `default` | `stripe` | `gift`), `usage_counters` (user_id, key, période `YYYY-MM`, valeur).
- Produit : `entitlementKeys` = `wardrobe_items`, `active_alerts`, `cutouts_per_month`, `order_emails_per_month`, `ai_calls_per_month` (liste fermée, Zod).
- Produit : `getLimit(userId, key): Promise<number | "unlimited">`, `checkAndConsume(userId, key, amount = 1): Promise<{ allowed: boolean; remaining: number | "unlimited" }>`, atomique (une seule requête `UPDATE … WHERE valeur + amount <= limite`).
- Produit : formule par défaut « Gratuit », créée par la migration avec des **valeurs de départ** (300 pièces, 50 alertes ; les autres à 20 par mois). Ces valeurs se changeront dans l'admin au chantier 6.

- [ ] **Étape 1 : tests qui échouent** — 20 appels de `checkAndConsume(u, "cutouts_per_month")` sont acceptés, le 21e est refusé ; 25 appels simultanés n'en acceptent que 20 ; un nouveau mois remet le compteur à zéro ; une utilisatrice sans formule reçoit « Gratuit ».
- [ ] **Étape 2 → 4 :** implémenter, tests au vert.
- [ ] **Étape 5 :** commit `feat(entitlements): plans, limits and atomic usage counters`.

### Tâche 10 : Photos — stockage OVH et nettoyage

**Fichiers :**
- Créer : `packages/storage/src/{index.ts,s3.ts,memory.ts}`, `packages/storage/src/images.ts`, `packages/storage/src/images.test.ts`
- Créer : `packages/db/src/schema/media.ts` + migration ; route `POST /api/media` (niveau `user`) dans `apps/api/src/routes/media.ts` + `media.integration.test.ts`
- Modifier : `apps/api/src/env.ts` (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)

**Interfaces :**
- Produit : `type ObjectStore = { put(key, body: Buffer, contentType): Promise<void>; get(key): Promise<Buffer>; delete(key): Promise<void> }`, avec `s3Store(config)` et `memoryStore()`.
- Produit : `normalizeImage(input: Buffer): Promise<{ data: Buffer; width; height; contentType: "image/webp" }>` :
  - formats acceptés : JPEG, PNG, WebP et AVIF ;
  - sinon `UnsupportedImageError` ;
  - au-delà de 20 Mo : `ImageTooLargeError` ;
  - réorientation EXIF, puis ré-encodage en WebP, plus grand côté 2 048 px, **aucune métadonnée conservée**.
- Produit : table `media` (id, user_id, clé, type, taille, dimensions, créé le), enregistrée dans `registerOwnedTable`. Clés S3 : `users/<userId>/<uuid>.webp`.

- [ ] **Étape 1 : tests qui échouent** (point de vigilance 3) :
  - un JPEG avec GPS EXIF ressort sans aucune métadonnée (`sharp(out).metadata()` n'a ni `exif` ni `xmp`) ;
  - un fichier HEIC lève `UnsupportedImageError`, et la route répond 415 « Format non pris en charge » ;
  - 21 Mo donnent 413 « Photo trop lourde, 20 Mo maximum » ;
  - un PDF donne 415 ;
  - la route sans session répond 401.
- [ ] **Étape 2 → 4 :** implémenter, tests au vert.
- [ ] **Étape 5 :** commit `feat(media): image normalization and object storage`.

### Tâche 11 : Mesure d'audience

**Fichiers :**
- Créer : `packages/shared/src/events.ts` (`eventSchema`, liste fermée de noms), `packages/db/src/schema/events.ts` + migration, route `POST /api/events` (`public`), `apps/api/src/routes/events.integration.test.ts`, `apps/web/src/lib/track.ts`

**Interfaces :**
- Produit : `eventNames` = `page_view`, `signup_started`, `signup_completed` (enrichie à chaque chantier).
- Produit : `POST /api/events` reçoit au plus 20 événements par lot. Chaque événement contient `{ name, path, occurredAt, props? }`. Le serveur ajoute `user_id` si une session existe, et **ne stocke jamais l'adresse IP ni le user-agent complet** : seulement la famille d'appareil (`mobile` | `desktop` | `tablet`).
- Produit : `track(name, props?)` côté web, envoyé par `navigator.sendBeacon` ; `trackServer(db, event)` côté API et worker.

- [ ] **Étape 1 : tests qui échouent** — un lot de 21 événements répond 400 ; un nom inconnu répond 400 ; la ligne stockée n'a pas de colonne d'IP et `device` vaut `mobile` pour un user-agent d'iPhone.
- [ ] **Étape 2 → 4 :** implémenter, tests au vert.
- [ ] **Étape 5 :** commit `feat(analytics): first-party events without IP`.

### Tâche 12 : Coque de l'admin

**Fichiers :**
- Créer : `packages/db/src/schema/audit.ts` + migration, `apps/api/src/routes/admin/{overview.ts,audit.ts}` + tests, `apps/api/src/admin-audit.ts`
- Créer : `apps/web/src/app/admin/{layout.tsx,page.tsx,command-palette.tsx}`, `apps/web/src/app/admin/passkey-required/page.tsx`

**Interfaces :**
- Produit : table `admin_audit_log` (id, admin_id, action, cible, détails JSON, horodatage) ; `auditMiddleware` enregistre chaque requête admin qui modifie quelque chose (`POST`, `PATCH`, `PUT`, `DELETE`).
- Produit : `GET /api/admin/overview` → `{ users: { total, anonymous, registered }, eventsToday, signupsToday }` ; `GET /api/admin/audit?cursor=` paginé.
- Produit : l'interface admin, avec un menu (tableau de bord, puis une entrée par chantier), une palette ⌘K (cmdk) et le mode sombre. Elle utilise uniquement les tokens.
- Un admin sans session passkey est redirigé vers `/admin/passkey-required`, qui explique comment enregistrer une passkey (point de vigilance 4).

- [ ] **Étape 1 : tests qui échouent** — `GET /api/admin/overview` répond 403 pour une utilisatrice, 403 pour un admin connecté par code, 200 pour un admin connecté par passkey ; un `POST` admin crée une ligne dans `admin_audit_log` ; les chiffres de `overview` correspondent aux données insérées.
- [ ] **Étape 2 → 4 :** implémenter, tests au vert.
- [ ] **Étape 5 :** commit `feat(admin): shell, overview and audit log`.

### Tâche 13 : En-têtes de sécurité et HSTS

**Fichiers :**
- Modifier : `apps/web/next.config.ts` (`headers()`), `deploy/caddy/closyria.com.caddy` et `deploy/caddy/dev.closyria.com.caddy`

**Interfaces :**
- Produit : sur toutes les pages, les en-têtes suivants :
  - `X-Content-Type-Options: nosniff` ;
  - `Referrer-Policy: strict-origin-when-cross-origin` ;
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()` ;
  - `Content-Security-Policy` avec `frame-ancestors 'none'`, d'abord en `Report-Only`, puis appliquée à la fin du chantier si aucun rapport.
- Produit : Caddy ajoute `Strict-Transport-Security "max-age=31536000; includeSubDomains"` (sans `preload`). La fondatrice l'installe avec la commande admin de la tâche 15.

- [ ] **Étape 1 : test qui échoue** — test Playwright (tâche 14) : la réponse de `/` porte les quatre en-têtes.
- [ ] **Étape 2 → 4 :** implémenter, test au vert.
- [ ] **Étape 5 :** commit `feat(security): baseline headers and HSTS`.

### Tâche 14 : Tests de bout en bout et accessibilité

**Fichiers :**
- Créer : `e2e/playwright.config.ts` (projets « iPhone 15 » et « Desktop Chrome »), `e2e/tests/{smoke.spec.ts,auth.spec.ts,admin.spec.ts}`, `e2e/fixtures/`
- Modifier : `.github/workflows/ci.yml` (installation des navigateurs, lancement de l'API et du web sur une base de test, `memoryMailer` exposé par une route **disponible uniquement si `APP_ENV=test`**)

**Interfaces :**
- Produit : les parcours de bout en bout du chantier 0 :
  - accueil affiché, sans violation axe ;
  - première action → session anonyme ;
  - connexion par code e-mail, avec le code lu via la route de test ;
  - `/admin` refusé à une utilisatrice ;
  - les en-têtes de la tâche 13.

- [ ] **Étape 1 :** écrire les tests ; ils échouent.
- [ ] **Étape 2 :** compléter ce qui manque (route de test des e-mails, scripts).
- [ ] **Étape 3 :** au vert en local et en CI.
- [ ] **Étape 4 :** commit `test(e2e): Playwright journeys with axe checks`.

### Tâche 15 : Mise en ligne du chantier 0

**Fichiers :**
- Modifier : `deploy/README.md` (nouvelles variables, rôle admin, HSTS), `apps/worker` si besoin (aucune tâche nouvelle dans ce chantier)

- [ ] **Étape 1 :** préparer les **commandes admin** pour la fondatrice :
  - variables à ajouter à `dev.env` puis `prod.env` (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BREVO_API_KEY`, les cinq `S3_*`, plus Google et Apple quand les comptes existent) ;
  - mise à jour du Caddyfile (HSTS) ;
  - SQL de rôle admin.
- [ ] **Étape 2 :** `deploy/build.sh origin/dev` puis `sudo closyria-deploy dev <id>` ; vérifier la santé, une connexion par code e-mail réelle, l'admin avec passkey, et un envoi de photo dont le GPS a disparu.
- [ ] **Étape 3 :** la fondatrice teste sur dev.closyria.com.
- [ ] **Étape 4 :** revue de code (`code-review`) et `superpowers:verification-before-completion`, fusion de `dev` dans `main`, `deploy-checklist`, puis déploiement prod par la fondatrice.
- [ ] **Étape 5 :** cocher le chantier 0 dans la spec et noter les écarts éventuels.

## Prérequis de la fondatrice pour ce chantier

| Pour | Quoi | Bloquant pour |
|---|---|---|
| Codes e-mail | Clé API Brevo (envoi transactionnel), expéditeur `bonjour@closyria.com` ou similaire | Tâche 15 (les tests utilisent `memoryMailer`) |
| Photos | Deux buckets OVH (prod, dev) à Gravelines + un utilisateur S3 limité à chacun | Tâche 15 |
| Google | Projet Google Cloud, écran de consentement, identifiants OAuth | Rien : activé quand fourni |
| Apple | Compte Apple Developer (99 $/an), Services ID et clé « Sign in with Apple » | Rien : activé quand fourni |
