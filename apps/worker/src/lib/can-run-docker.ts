// SPDX-License-Identifier: Apache-2.0
// Phase 03 / Plan 08 back-fill (Stage B) — Docker socket detection helper.
//
// Used as a `describe.skipIf(!canRunDocker())` gate by the testcontainer
// suite. The probe checks (in order):
//   1. DOCKER_HOST env (CI sets this; macOS devs can export it manually).
//   2. /var/run/docker.sock (Linux + Docker Desktop on Linux).
//   3. $HOME/.docker/run/docker.sock (Docker Desktop on macOS — the
//      previous probe missed this and silently skipped the suite,
//      collapsing worker coverage from 94% → 52%).
//
// All filesystem + env access is injectable so the unit tests can pin
// each branch deterministically.

import nodeFs from "node:fs";

interface FsLike {
  existsSync(path: string): boolean;
}

interface CanRunDockerOpts {
  env?: Record<string, string | undefined>;
  fs?: FsLike;
}

export function canRunDocker(opts: CanRunDockerOpts = {}): boolean {
  const env = opts.env ?? process.env;
  const fs = opts.fs ?? (nodeFs as FsLike);
  if (env["DOCKER_HOST"]) return true;
  try {
    if (fs.existsSync("/var/run/docker.sock")) return true;
    const home = env["HOME"];
    if (home && fs.existsSync(`${home}/.docker/run/docker.sock`)) return true;
    return false;
  } catch {
    return false;
  }
}

export default canRunDocker;
