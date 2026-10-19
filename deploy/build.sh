#!/bin/bash
# Builds a release artifact from a git ref, from a clean export of that commit.
# Runs as the developer account (no privileges). Prints the release id on the last line.
#   deploy/build.sh [git-ref]   (default: origin/dev)
set -euo pipefail

REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ARTIFACTS=${CLOSYRIA_ARTIFACTS:-$HOME/closyria-artifacts}
REF=${1:-origin/dev}

git -C "$REPO" fetch --quiet origin
SHA=$(git -C "$REPO" rev-parse --verify "$REF^{commit}")
ID="$(date -u +%Y%m%d-%H%M%S)-${SHA:0:12}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/src"
OUT="$WORK/out"
mkdir -p "$SRC" "$OUT"

echo "building $REF ($SHA) as $ID"
git -C "$REPO" archive "$SHA" | tar -x -C "$SRC"

export NEXT_TELEMETRY_DISABLED=1
(cd "$SRC" && pnpm install --frozen-lockfile --reporter=silent && pnpm build)

# web: Next standalone server + static assets (+ public/ when it exists)
cp -a "$SRC/apps/web/.next/standalone" "$OUT/web"
cp -a "$SRC/apps/web/.next/static" "$OUT/web/apps/web/.next/static"
[ -d "$SRC/apps/web/public" ] && cp -a "$SRC/apps/web/public" "$OUT/web/apps/web/public"
# api and worker: self-contained bundles
cp -a "$SRC/apps/api/dist" "$OUT/api"
cp -a "$SRC/apps/worker/dist" "$OUT/worker"
cp -a "$SRC/packages/db/migrations" "$OUT/migrations"
printf 'APP_VERSION=%s\n' "$ID" > "$OUT/release.env"

mkdir -p "$ARTIFACTS"
tar -czf "$ARTIFACTS/$ID.tar.gz.tmp" -C "$OUT" .
mv "$ARTIFACTS/$ID.tar.gz.tmp" "$ARTIFACTS/$ID.tar.gz"
# Keep the 10 most recent artifacts
ls -1t "$ARTIFACTS"/*.tar.gz | tail -n +11 | xargs -r rm -f

echo "artifact: $ARTIFACTS/$ID.tar.gz ($(du -h "$ARTIFACTS/$ID.tar.gz" | cut -f1))"
echo "$ID"
