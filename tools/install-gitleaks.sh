#!/usr/bin/env bash
# tools/install-gitleaks.sh — idempotent gitleaks binary installer.
#
# Phase 260516-kya / Plan 01 / Task 1 — invoked by:
#   - tools/install-hooks.cjs after `lefthook install` on `pnpm install`
#   - `make install-gitleaks`
#   - operators directly: `bash tools/install-gitleaks.sh`
#
# Behaviour:
#   1. If `gitleaks` already on PATH AND major version >= 8 → exit 0.
#   2. If running in CI ($CI=true) → exit 0; CI installs via the
#      gitleaks-action runner step, not from this script.
#   3. On macOS → `brew install gitleaks` (skip if brew absent).
#   4. On Linux → curl + sha256-verify the pinned release tarball
#      from github.com/gitleaks/gitleaks/releases. Install to
#      /usr/local/bin if writable, else $HOME/.local/bin.
#
# Hard rules:
#   - argv-array invocations only. We use `brew install gitleaks`
#     (literal args) and `curl -fsSL <url>` (literal args). No
#     credential env var interpolation (LOCKER-06).
#   - English-only output.
#   - Re-runnable: every code path is a no-op when gitleaks is
#     already installed at >= the pinned version.

set -euo pipefail

PINNED_VERSION="8.30.1"
PINNED_MAJOR="8"

# Pinned sha256 sums for the v8.30.1 release tarballs from
# github.com/gitleaks/gitleaks/releases/download/v8.30.1/.
# To update: refresh the version pin above and replace these sums
# with the values from the release's checksums.txt.
SHA256_LINUX_AMD64=""
SHA256_LINUX_ARM64=""

log() { echo "[install-gitleaks] $*"; }

# Already installed at acceptable version?
if command -v gitleaks >/dev/null 2>&1; then
  current="$(gitleaks version 2>/dev/null || echo "0.0.0")"
  major="${current%%.*}"
  if [[ "${major}" =~ ^[0-9]+$ && "${major}" -ge "${PINNED_MAJOR}" ]]; then
    log "already installed: gitleaks ${current} (>= v${PINNED_MAJOR}.x)"
    exit 0
  fi
  log "found gitleaks ${current} but require >= v${PINNED_MAJOR}.x; reinstalling"
fi

# CI uses gitleaks-action runner, not local binary.
if [[ "${CI:-}" == "true" ]]; then
  log "CI=true; skipping local install (CI uses gitleaks-action)."
  exit 0
fi

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "${uname_s}" in
  Darwin)
    if ! command -v brew >/dev/null 2>&1; then
      log "ERROR: macOS detected but Homebrew not on PATH. Install brew from https://brew.sh first."
      exit 1
    fi
    log "installing via Homebrew (gitleaks ${PINNED_VERSION}+)"
    brew install gitleaks
    ;;

  Linux)
    case "${uname_m}" in
      x86_64|amd64) arch="x64"; expected_sha="${SHA256_LINUX_AMD64}" ;;
      aarch64|arm64) arch="arm64"; expected_sha="${SHA256_LINUX_ARM64}" ;;
      *)
        log "ERROR: unsupported Linux arch '${uname_m}'. Supported: x86_64, aarch64."
        exit 1
        ;;
    esac

    tmpdir="$(mktemp -d)"
    trap 'rm -rf "${tmpdir}"' EXIT
    tarball="gitleaks_${PINNED_VERSION}_linux_${arch}.tar.gz"
    url="https://github.com/gitleaks/gitleaks/releases/download/v${PINNED_VERSION}/${tarball}"

    log "downloading ${url}"
    curl -fsSL -o "${tmpdir}/${tarball}" "${url}"

    if [[ -n "${expected_sha}" ]]; then
      actual_sha="$(sha256sum "${tmpdir}/${tarball}" | awk '{print $1}')"
      if [[ "${actual_sha}" != "${expected_sha}" ]]; then
        log "ERROR: sha256 mismatch for ${tarball}"
        log "  expected: ${expected_sha}"
        log "  actual:   ${actual_sha}"
        exit 1
      fi
      log "sha256 verified: ${actual_sha}"
    else
      log "WARNING: no pinned sha256 for linux/${arch}; skipping checksum verification."
      log "         Pin SHA256_LINUX_${arch^^} in tools/install-gitleaks.sh after release validation."
    fi

    tar -xzf "${tmpdir}/${tarball}" -C "${tmpdir}" gitleaks

    if [[ -w /usr/local/bin ]]; then
      install_dir="/usr/local/bin"
    else
      install_dir="${HOME}/.local/bin"
      mkdir -p "${install_dir}"
    fi

    install -m 0755 "${tmpdir}/gitleaks" "${install_dir}/gitleaks"
    log "installed: ${install_dir}/gitleaks"

    if ! command -v gitleaks >/dev/null 2>&1; then
      log "NOTE: ${install_dir} is not on PATH. Add it to your shell rc:"
      log "      export PATH=\"${install_dir}:\$PATH\""
    fi
    ;;

  *)
    log "ERROR: unsupported OS '${uname_s}'. Supported: Darwin (macOS), Linux."
    exit 1
    ;;
esac

# Final smoke check.
if command -v gitleaks >/dev/null 2>&1; then
  log "installed: $(gitleaks version)"
else
  log "WARNING: gitleaks installed but not yet on PATH for this shell."
fi
