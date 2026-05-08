import { describe, expect, it } from "vitest";
import { loadLocale } from "./index.js";

describe("packages/i18n locale loader", () => {
  it("loads the en locale and exposes the phase key", () => {
    const en = loadLocale("en");
    expect(en).toHaveProperty("phase");
    expect(en.phase).toBe("phase-0-placeholder");
  });

  it("loads the ru locale and exposes the phase key", () => {
    const ru = loadLocale("ru");
    expect(ru).toHaveProperty("phase");
    expect(ru.phase).toBe("phase-0-placeholder");
  });
});
