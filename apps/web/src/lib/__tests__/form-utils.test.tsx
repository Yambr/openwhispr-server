// Phase 07.1 / Plan 06 — form-utils unit tests (RED before GREEN).
//
// `useZodForm()` composes react-hook-form's `useForm` with the zod resolver
// from `@hookform/resolvers/zod`. The wrapper exists so screen-level forms
// (Plan 07 sign-in, Plan 11 search, etc.) get type inference + validation
// in one line.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useZodForm } from "../form-utils";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

describe("useZodForm (Phase 07.1 / Plan 06)", () => {
  it("returns a react-hook-form object with handleSubmit + register", () => {
    const { result } = renderHook(() => useZodForm({ schema }));
    expect(typeof result.current.handleSubmit).toBe("function");
    expect(typeof result.current.register).toBe("function");
  });

  it("rejects invalid input via zod resolver", async () => {
    const { result } = renderHook(() => useZodForm({ schema }));
    await act(async () => {
      result.current.setValue("email", "not-an-email");
      result.current.setValue("password", "short");
      await result.current.trigger();
    });
    expect(result.current.formState.errors.email).toBeDefined();
    expect(result.current.formState.errors.password).toBeDefined();
  });

  it("accepts valid input", async () => {
    const { result } = renderHook(() => useZodForm({ schema }));
    await act(async () => {
      result.current.setValue("email", "user@example.com");
      result.current.setValue("password", "longenough");
      await result.current.trigger();
    });
    expect(result.current.formState.errors.email).toBeUndefined();
    expect(result.current.formState.errors.password).toBeUndefined();
  });

  it("forwards defaultValues to react-hook-form", () => {
    const { result } = renderHook(() =>
      useZodForm({
        schema,
        defaultValues: { email: "seed@example.com", password: "seedpassword" },
      }),
    );
    expect(result.current.getValues("email")).toBe("seed@example.com");
  });
});
