#!/usr/bin/env bash
# Dry run of the pending migrations on a throwaway COPY of the prod database. Never touches prod itself.
# Usage (compte avec sudo) : sudo bash deploy/dry-run-prod-migrations.sh <release-id>
# The release artifact must exist in /home/mystery/closyria-artifacts/<release-id>.tar.gz (deploy/build.sh).
set -euo pipefail

ID="${1:?release id}"
ART="/home/mystery/closyria-artifacts/$ID.tar.gz"
COPY=closyria_dryrun
SOCK="host=/var/run/postgresql"
[ -f "$ART" ] || { echo "artifact not found: $ART" >&2; exit 1; }

TMP=$(mktemp -d /tmp/closyria-dryrun.XXXXXX)
cleanup() {
  sudo -u postgres dropdb --if-exists "$COPY" || true
  rm -rf "$TMP"
}
trap cleanup EXIT

tar -xzf "$ART" -C "$TMP"
chmod -R a+rX "$TMP"

echo "== Prod ownership (CREATE FUNCTION in public needs the closyria role to own the schema or have CREATE on it)"
sudo -u postgres psql -d closyria -Atc "
  select 'database owner: ' || pg_get_userbyid(datdba) from pg_database where datname = 'closyria';
  select 'public schema owner: ' || pg_get_userbyid(nspowner) from pg_namespace where nspname = 'public';
  select 'closyria can create in public: ' || has_schema_privilege('closyria', 'public', 'CREATE');"

echo "== Copying prod into $COPY (read-only on prod)"
sudo -u postgres dropdb --if-exists "$COPY"
sudo -u postgres createdb -O closyria "$COPY"
install -d -o closyria -g closyria -m 700 "$TMP/dump"
sudo -u closyria pg_dump -Fc -d "postgresql:///closyria?$SOCK" -f "$TMP/dump/prod.dump"
# Extensions (pg_stat_statements…) need a superuser and play no part in the migrations: leave them out of the copy.
pg_restore -l "$TMP/dump/prod.dump" | grep -v -E " EXTENSION | COMMENT - EXTENSION " >"$TMP/restore.list"
chmod a+r "$TMP/restore.list"
sudo -u closyria pg_restore --no-owner --exit-on-error -L "$TMP/restore.list" \
  -d "postgresql:///$COPY?$SOCK" "$TMP/dump/prod.dump"

count() {
  sudo -u closyria psql -d "postgresql:///$COPY?$SOCK" -Atc "
    select 'users=' || (select count(*) from \"user\")
      || ' profiles=' || (select count(*) from profiles)
      || ' shops=' || (select count(*) from shops)
      || ' products=' || (select count(*) from products)
      || ' items=' || (select count(*) from items);"
}
echo "== Rows before: $(count)"

echo "== Applying the release's migrations to the copy"
start=$(date +%s)
sudo -u closyria env DATABASE_URL="postgresql:///$COPY?$SOCK" MIGRATIONS_DIR="$TMP/migrations" \
  /usr/bin/node "$TMP/api/migrate.mjs"
echo "== Migrations took $(( $(date +%s) - start )) s"

echo "== Rows after:  $(count)"
echo "== DRY RUN OK (the copy is dropped now; prod was never modified)"
