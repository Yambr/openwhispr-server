#!/usr/bin/env bash
# scripts/verify-images.sh — Phase 01.1 image-pin verifier (D-05).
#
# For each `image:` line in $COMPOSE_FILE (default: docker-compose.yml),
# query the upstream registry via `docker buildx imagetools inspect`.
# Print one line per image:
#   - `OK <image>` to stdout for verified images
#   - `MISSING <image>` to stderr when the registry has no such manifest
#   - `FUTURE-DATED <image> (tag date YYYY-MM-DD > today YYYY-MM-DD)` to stderr
#     for RELEASE.YYYY-MM-DD tags whose date portion is in the future
#     (cheap local check, no network round-trip)
#   - `INVALID-IMAGE <image>` to stderr when the image string fails the
#     safety regex `^[a-zA-Z0-9._/:@-]+$` (T-01.1-01: shell-meta guard
#     applied BEFORE invoking docker buildx)
#
# Exit code: number of failed images (MISSING + FUTURE-DATED + INVALID-IMAGE);
#            0 means every image verified clean.
#
# Why `docker buildx imagetools inspect` over `docker manifest inspect`:
#   - GA stable, not gated behind DOCKER_CLI_EXPERIMENTAL
#   - Daemon-optional for registry-only inspect (operator-friendly)
#   - Native multi-arch / OCI manifest support
# CONTEXT.md D-05 grants Claude's Discretion to choose either; we choose buildx.
#
# Bash 3.2 compatible (macOS system bash). NO `declare -A`, NO `mapfile`.
# Uses `set -uo pipefail` (NOT `set -e`) so the loop can accumulate per-image
# failures into fail_count without aborting on the first non-zero exit.

set -uo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
TODAY="$(date -u +%Y-%m-%d)"

if ! command -v docker >/dev/null 2>&1; then
  echo "verify-images: docker CLI not found in PATH" >&2
  exit 127
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "verify-images: $COMPOSE_FILE not found" >&2
  exit 2
fi

# Extract `image:` values from the compose file. Handles optional quoting.
# Skips commented `# image:` lines via the leading-whitespace regex.
extract_images() {
  grep -E '^[[:space:]]*image:[[:space:]]+' "$COMPOSE_FILE" \
    | sed -E 's/^[[:space:]]*image:[[:space:]]+["'"'"']?([^"'"'"' ]+)["'"'"']?[[:space:]]*$/\1/' \
    | grep -v '^#' || true
}

fail_count=0
while IFS= read -r image; do
  [[ -z "$image" ]] && continue

  # T-01.1-01 — Input safety guard. Reject any image string containing
  # shell metacharacters BEFORE handing it to `docker buildx`. Although
  # execve does not invoke a shell, defence-in-depth is warranted because
  # a crafted compose entry could later be expanded by a less careful
  # caller (e.g. piped through `eval` or `sh -c`).
  if ! [[ "$image" =~ ^[a-zA-Z0-9._/:@-]+$ ]]; then
    echo "INVALID-IMAGE $image" >&2
    fail_count=$((fail_count + 1))
    continue
  fi

  # Cheap local check: future-dated RELEASE.YYYY-MM-DD... tags. Lexicographic
  # comparison on ISO-8601 dates is equivalent to chronological order.
  if [[ "$image" =~ RELEASE\.([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    tag_date="${BASH_REMATCH[1]}"
    if [[ "$tag_date" > "$TODAY" ]]; then
      echo "FUTURE-DATED $image (tag date $tag_date > today $TODAY)" >&2
      fail_count=$((fail_count + 1))
      continue
    fi
  fi

  # Network check: registry round-trip via buildx imagetools.
  if docker buildx imagetools inspect "$image" >/dev/null 2>&1; then
    echo "OK $image"
  else
    echo "MISSING $image" >&2
    fail_count=$((fail_count + 1))
  fi
done < <(extract_images)

exit "$fail_count"
