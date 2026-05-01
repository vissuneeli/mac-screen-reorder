#!/usr/bin/env bash
set -euo pipefail

staged_files="$(git diff --cached --name-only --diff-filter=ACM)"

if [ -z "${staged_files}" ]; then
  exit 0
fi

pattern='(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{16,}|-----BEGIN (RSA|EC|OPENSSH|DSA|PRIVATE) KEY-----|(?i)(api[_-]?key|client[_-]?secret|aws_secret_access_key|password|passwd|token)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_./+=:-]{8,}|(?i)(mongodb(\+srv)?://|postgres(ql)?://|mysql://|redis://))'

failed=0

while IFS= read -r file; do
  [ -f "$file" ] || continue
  case "$file" in
    package-lock.json|yarn.lock|pnpm-lock.yaml)
      continue
      ;;
  esac

  if rg -n --pcre2 "$pattern" "$file" >/dev/null 2>&1; then
    echo "Potential secret detected in staged file: $file"
    rg -n --pcre2 "$pattern" "$file" || true
    failed=1
  fi
done <<< "$staged_files"

if [ "$failed" -ne 0 ]; then
  echo ""
  echo "Commit blocked: potential secrets found."
  echo "Remove secrets or add safe placeholders before committing."
  exit 1
fi

exit 0
