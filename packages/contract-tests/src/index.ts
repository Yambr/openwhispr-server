// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 0 contract-test harness shell — wire-contract test bodies are added in
// Phase 2+ once the API surface starts implementing BACKEND_SPEC.md endpoints.
//
// Phase 40 / Sub-fix 40.c — export the typed error class so consumers can
// `expect(...).rejects.toBeInstanceOf(MalformedUpstreamEnvelopeError)`
// without reaching into a private subpath.
export { MalformedUpstreamEnvelopeError } from "./errors.js";

export function harnessLoaded(): boolean {
  return true;
}
