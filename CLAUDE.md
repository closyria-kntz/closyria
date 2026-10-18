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

Prévus : `packages/extract` (extraction des fiches produit, phase 1), `apps/extension` (WXT, après la V1 web), `apps/mobile` (Expo, phase 6).

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
