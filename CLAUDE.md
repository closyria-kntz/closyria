# Closyria

SaaS de dressing en ligne et de suivi d'articles (stock par taille, prix, alertes). Web d'abord, mobile (Expo) ensuite.

## Conventions

- **Code en anglais** (identifiants, tables, commentaires). **Interface et documentation en français.**
- TypeScript strict partout. Pas de `any` sans justification.
- Biome pour l'analyse et la mise en forme : `pnpm format` avant de committer.
- Toute donnée qui traverse une frontière (requête HTTP, variable d'environnement, réponse d'un site tiers) est validée avec Zod.
- Les schémas partagés vivent dans `packages/shared` ; le web et l'API ne les dupliquent pas.

## Structure

| Dossier | Rôle |
|---|---|
| `apps/web` | Next.js 16 (App Router), Tailwind 4. Sortie `standalone`. |
| `apps/api` | Hono + `@hono/zod-openapi`, servie sous `/api`. Bundle autonome (tsdown). |
| `apps/worker` | Tâches de fond pg-boss. Bundle autonome (tsdown). |
| `packages/db` | Schéma Drizzle et migrations SQL (`pnpm --filter @closyria/db generate`). |
| `packages/shared` | Schémas Zod et utilitaires communs. |
| `packages/config` | tsconfig partagés. |

Prévus par la conception V1 (`docs/specs/2026-11-01-v1-conception.md`) : `packages/{extract,auth,entitlements,ai,vision,i18n}`.
Après la V1 : `apps/extension` (WXT) et `apps/mobile` (Expo).

## Documents de travail

Plans, specs et décisions vivent dans `docs/` (`docs/specs/` pour les conceptions, `docs/plans/` pour les plans de chantier). On les écrit avant d'implémenter,
on travaille à partir d'eux et on les tient à jour (cases cochées, décisions validées).
Utiliser les skills installés quand ils s'appliquent (superpowers, code-review, frontend-design, engineering, design).

## Commandes

```bash
pnpm install
pnpm dev         # tout en mode développement
pnpm lint        # Biome
pnpm typecheck
pnpm test
pnpm build
```

## Environnements

| | Prod | Dev |
|---|---|---|
| URL | https://closyria.com | https://dev.closyria.com (protégée) |
| Branche | `main` | `dev` |
| Utilisateur système | `closyria` | `closyria-dev` |
| Base | `closyria` | `closyria_dev` |
| Ports (web / api) | 3000 / 3001 | 3100 / 3101 |
| Secrets | `/etc/closyria/prod.env` | `/etc/closyria/dev.env` |

Jamais de secret dans le dépôt. Les apps valident leur configuration au démarrage et refusent de démarrer si elle est invalide.

## Base de données

Connexion par socket Unix et authentification peer : `DATABASE_URL=postgresql:///closyria?host=/var/run/postgresql`.
Les changements de schéma passent par des migrations générées et versionnées, appliquées par le script de déploiement avant le redémarrage.
