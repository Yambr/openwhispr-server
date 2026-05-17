// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 49 / Plan 49-01 / L8 — vitest unit coverage for the staleness tool.
import { describe, expect, it } from "vitest";

import {
  extractRedScenarios,
  findStale,
  parseRoadmapClosures,
  type RedScenario,
  renderReport,
  run,
} from "./check-expected-red-staleness";

describe("extractRedScenarios", () => {
  it("extracts @expected-red scenarios with their @after-phase tag", () => {
    const body = [
      "Feature: F",
      "",
      "  @cjm-1.1 @expected-red @after-phase-19.1",
      "  Scenario: deferred happy path",
      "    Given x",
      "",
      "  @cjm-1.2",
      "  Scenario: regular happy",
      "    Given y",
    ].join("\n");
    const out = extractRedScenarios(body, "/abs/a.feature");
    expect(out).toHaveLength(1);
    expect(out[0].phaseId).toBe("19.1");
    expect(out[0].scenarioTitle).toBe("deferred happy path");
  });

  it("ignores @expected-red without @after-phase-N", () => {
    const body = `  @cjm-1.1 @expected-red\n  Scenario: bare red\n`;
    expect(extractRedScenarios(body, "/x.feature")).toEqual([]);
  });

  it("accepts the suffixed form @after-phase-51-WIRE-11-PUT", () => {
    const body = [
      "  @cjm-9.1 @expected-red @after-phase-51-WIRE-11-PUT",
      "  Scenario: deferred",
    ].join("\n");
    const out = extractRedScenarios(body, "/x.feature");
    expect(out[0].phaseId).toBe("51-WIRE-11-PUT");
  });
});

describe("parseRoadmapClosures", () => {
  it("recognises `Phase N: … CLOSED YYYY-MM-DD` headings", () => {
    const txt = [
      "- [x] **Phase 21: lockers** — CLOSED 2026-05-16",
      "- [ ] **Phase 22: smoke** — pending",
      "### Phase 23: matrix — CLOSED 2026-05-17",
    ].join("\n");
    const out = parseRoadmapClosures(txt);
    expect(out.get("21")).toBe("2026-05-16");
    expect(out.get("23")).toBe("2026-05-17");
    expect(out.get("22")).toBeUndefined();
  });

  it("first-match-wins when a phase is mentioned multiple times", () => {
    const txt = [
      "- [x] **Phase 1: foo** — CLOSED 2026-05-01",
      "### Phase 1: same phase, later mention — CLOSED 2026-05-10",
    ].join("\n");
    expect(parseRoadmapClosures(txt).get("1")).toBe("2026-05-01");
  });
});

describe("findStale", () => {
  const scenarios: RedScenario[] = [
    {
      file: "a.feature",
      line: 1,
      scenarioTitle: "deferred",
      phaseTag: "@after-phase-19.1",
      phaseId: "19.1",
    },
    {
      file: "b.feature",
      line: 1,
      scenarioTitle: "still pending",
      phaseTag: "@after-phase-22",
      phaseId: "22",
    },
    {
      file: "c.feature",
      line: 1,
      scenarioTitle: "suffixed",
      phaseTag: "@after-phase-51-WIRE-11-PUT",
      phaseId: "51-WIRE-11-PUT",
    },
  ];

  it("flags a scenario whose phase closed ≥ stale-days ago", () => {
    const closures = new Map([["19.1", "2026-05-01"]]);
    const out = findStale(scenarios, closures, new Date("2026-05-16T00:00:00Z"), 7);
    expect(out).toHaveLength(1);
    expect(out[0].phaseId).toBe("19.1");
    expect(out[0].daysStale).toBe(15);
  });

  it("does not flag a scenario whose phase has not closed", () => {
    const closures = new Map<string, string>();
    expect(findStale(scenarios, closures, new Date("2026-06-01T00:00:00Z"), 7)).toEqual([]);
  });

  it("matches numeric prefix for suffixed phase ids (51-WIRE-11-PUT → '51')", () => {
    const closures = new Map([["51", "2026-04-01"]]);
    const out = findStale(scenarios, closures, new Date("2026-05-01T00:00:00Z"), 7);
    expect(out.some((s) => s.phaseId === "51-WIRE-11-PUT")).toBe(true);
  });

  it("respects the stale-days threshold", () => {
    const closures = new Map([["19.1", "2026-05-10"]]);
    const out = findStale(scenarios, closures, new Date("2026-05-13T00:00:00Z"), 7);
    expect(out).toEqual([]);
  });
});

describe("renderReport", () => {
  it("produces an 'all clear' body when no stale scenarios", () => {
    const md = renderReport([], new Date("2026-05-16T00:00:00Z"));
    expect(md).toMatch(/None/);
  });

  it("produces a table when stale scenarios exist", () => {
    const md = renderReport(
      [
        {
          file: "/abs/a.feature",
          line: 7,
          scenarioTitle: "stale one",
          phaseTag: "@after-phase-19.1",
          phaseId: "19.1",
          closedAt: "2026-05-01",
          daysStale: 15,
        },
      ],
      new Date("2026-05-16T00:00:00Z"),
    );
    expect(md).toMatch(/Stale @expected-red/);
    expect(md).toMatch(/stale one/);
    expect(md).toMatch(/@after-phase-19\.1/);
    expect(md).toMatch(/15/);
  });
});

describe("run (in-process)", () => {
  it("exits 0 when the ROADMAP cannot be read (graceful)", async () => {
    let err = "";
    const code = await run({
      argv: ["--roadmap", "no-such.md", "--features", "no-such-dir"],
      cwd: "/tmp",
      now: new Date(),
      stdout: () => {},
      stderr: (s) => {
        err += s;
      },
    });
    expect(code).toBe(2);
    expect(err).toMatch(/cannot read ROADMAP/);
  });
});
