#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# Quick 260528-kqv — pre-push test-evidence gate, SCRIPT form.
#
# Why a script, not a `pre-push.commands` entry: lefthook 2.1.8 skips
# every pre-push COMMAND whose `run` has no file template when the push
# file-diff is empty ("(skip) no matching push files",
# build_command.go:72-80, #57). The gate validates COMMITS via the
# pre-push stdin protocol, not files, so it MUST run on every push —
# including a push whose file-diff is empty (the dormant condition
# where the local branch is in sync with its upstream). lefthook's
# SCRIPT build path (build_script.go) never applies the push-files
# skip, so this runs unconditionally. `use_stdin: true` (set in
# lefthook.yml) forwards the Git pre-push stdin protocol
# (<local_ref> <local_sha> <remote_ref> <remote_sha>) to the validator
# unchanged. This script is the sole pre-push stdin consumer.
#
# LOCKER-06: the validator is invoked in argv form with no
# `*_URL/*_KEY/*_PASSWORD/*_SECRET/*_TOKEN` interpolation.
set -euo pipefail
exec pnpm exec tsx tools/lint-pre-push-test-evidence.ts
