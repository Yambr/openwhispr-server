# SPDX-License-Identifier: FSL-1.1-ALv2
# R31 — bundled LiteLLM image carrying the OpenAI-Beta-header patch.
#
# WHY A CUSTOM IMAGE
# ==================
# OpenAI's Realtime GA `/v1/realtime` surface rejects the Beta-API
# `OpenAI-Beta: realtime=v1` header with
# `invalid_request_error.beta_api_shape_disabled`. LiteLLM 1.83.14's
# `OpenAIRealtime._get_additional_headers()` hardcodes that header on its
# own OpenAI WebSocket leg with no config knob (debug session
# r31-realtime-ga-beta-shape, DEFECT 2). This image applies a minimal,
# line-anchored patch dropping the header — see
# `compose/litellm/r31-drop-openai-beta-header.patch` for the full
# rationale and the re-apply procedure on LiteLLM bumps.
#
# Only the `litellm` realtime backend (REALTIME_BACKEND=litellm, default)
# needs this. The `direct` backend bypasses LiteLLM and never sees the
# header.
#
# BUILD
# =====
#   docker compose build litellm
# (docker-compose.yml `litellm` service sets `build: ./compose/litellm`.)
#
# The base tag MUST stay in lockstep with the tag previously pinned as the
# bare `image:` in docker-compose.yml. On a LiteLLM bump: re-pin here,
# rebuild, and the post-patch grep assertion below FAILS the build if the
# anchored source line moved — forcing the patch to be re-derived.

FROM ghcr.io/berriai/litellm:main-v1.83.14-stable

# The OpenAI realtime WS handler. Path verified against LiteLLM 1.83.14.
ARG REALTIME_HANDLER=/app/litellm/llms/openai/realtime/handler.py

# R31 / DEFECT 2 — drop the hardcoded `OpenAI-Beta: realtime=v1` line from
# `_get_additional_headers`. The `sed` is anchored on the exact literal so
# it cannot match anything else; the grep assertions bracket it so the
# build fails LOUDLY if either (a) the line was already absent (LiteLLM
# fixed it upstream — retire this patch) or (b) the patch left it behind.
RUN set -eux; \
    grep -q '"OpenAI-Beta": "realtime=v1"' "${REALTIME_HANDLER}" \
      || { echo "R31-PATCH-FATAL: OpenAI-Beta line not found in ${REALTIME_HANDLER} — LiteLLM may have changed; re-derive compose/litellm/r31-drop-openai-beta-header.patch"; exit 1; }; \
    sed -i '/"OpenAI-Beta": "realtime=v1",/d' "${REALTIME_HANDLER}"; \
    if grep -q '"OpenAI-Beta": "realtime=v1"' "${REALTIME_HANDLER}"; then \
      echo "R31-PATCH-FATAL: OpenAI-Beta line still present after sed"; exit 1; \
    fi; \
    echo "R31-PATCH-OK: OpenAI-Beta header dropped from ${REALTIME_HANDLER}"; \
    # CRITICAL — the LiteLLM base image ships PRE-COMPILED `.pyc` bytecode.
    # CPython uses HASH-based, `UNCHECKED` `.pyc` invalidation for those
    # files: it NEVER re-checks the source and always trusts the stale
    # bytecode. Our `sed` edits the `.py` source, but without dropping the
    # cached `.pyc` the runtime keeps loading the OLD (un-patched)
    # `_get_additional_headers` that still sends `OpenAI-Beta`. Delete every
    # `__pycache__` tree so CPython recompiles each module from the patched
    # source on first import. (Verified: r31-realtime-ga-shape debug session
    # — the patch silently no-op'd until the stale handler.pyc was removed.)
    find /app/litellm -name '__pycache__' -type d -prune -exec rm -rf {} + ; \
    echo "R31-PATCH-OK: dropped stale __pycache__ bytecode so the patched source is loaded"
