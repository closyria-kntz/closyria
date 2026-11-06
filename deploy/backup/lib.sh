# Shared by the backup scripts. BACKUP_STORE is « s3://<bucket> » (OVH, through the AWS CLI and S3_ENDPOINT) or a
# local folder (tests). Keys look like « prod/closyria-prod-20261107T033000Z.dump.age ».
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

need() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || die "$name is not set"
  done
}

env_arg() {
  case "${1:-}" in
    dev | prod) echo "$1" ;;
    *) die "usage: $(basename "$0") <dev|prod>" ;;
  esac
}

is_s3() { [[ "$BACKUP_STORE" == s3://* ]]; }
bucket() { echo "${BACKUP_STORE#s3://}"; }
# aws-cli 2.23+ adds CRC checksums by default, which OVH refuses (as in packages/storage/src/s3.ts).
aws_() {
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws --endpoint-url "$S3_ENDPOINT" "$@"
}

# store_put <key> <file>: uploads in one request, with its MD5 (required by buckets with Object Lock).
store_put() {
  local key=$1 file=$2
  if is_s3; then
    aws_ s3api put-object --bucket "$(bucket)" --key "$key" --body "$file" \
      --content-md5 "$(openssl dgst -md5 -binary "$file" | base64)" >/dev/null
  else
    mkdir -p "$BACKUP_STORE/$(dirname "$key")"
    cp "$file" "$BACKUP_STORE/$key.part"
    mv "$BACKUP_STORE/$key.part" "$BACKUP_STORE/$key"
  fi
}

# store_get <key> <file>
store_get() {
  local key=$1 file=$2
  if is_s3; then
    aws_ s3api get-object --bucket "$(bucket)" --key "$key" "$file" >/dev/null
  else
    cp "$BACKUP_STORE/$key" "$file"
  fi
}

# store_size <key>: size in bytes.
store_size() {
  if is_s3; then
    aws_ s3api head-object --bucket "$(bucket)" --key "$1" --query ContentLength --output text
  else
    stat -c %s "$BACKUP_STORE/$1"
  fi
}

# store_latest <env>: « <key> <epoch seconds> » of the newest copy of that environment, nothing if none.
store_latest() {
  local env=$1
  if is_s3; then
    local found
    found=$(aws_ s3api list-objects-v2 --bucket "$(bucket)" --prefix "$env/closyria-$env-" \
      --query 'sort_by(Contents || `[]`, &LastModified)[-1].[Key, LastModified]' --output text)
    [ -n "$found" ] && [ "$found" != "None" ] || return 0
    echo "${found%%[[:space:]]*} $(date -d "${found##*[[:space:]]}" +%s)"
  else
    local dir="$BACKUP_STORE/$env" newest
    [ -d "$dir" ] || return 0
    newest=$(find "$dir" -maxdepth 1 -name "closyria-$env-*.dump.age" -printf '%T@ %f\n' | sort -n | tail -n 1)
    [ -n "$newest" ] || return 0
    echo "$env/${newest#* } ${newest%%.*}"
  fi
}
