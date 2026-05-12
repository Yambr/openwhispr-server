// Phase 07.1 / Plan 06 — react-hook-form + zod helper (D-STACK-4).
//
// `useZodForm` is a single-line ergonomic wrapper that combines
// `useForm()` from react-hook-form with the zod resolver from
// `@hookform/resolvers/zod`. Screen-level forms (Plan 07 sign-in, Plan 11
// search etc.) consume this so each form file stays focused on its schema
// + JSX, not on resolver wiring boilerplate.
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import type { ZodType } from "zod";

export interface UseZodFormArgs<TSchema extends ZodType> {
  schema: TSchema;
  defaultValues?: DefaultValues<TSchema["_input"] & FieldValues>;
  mode?: UseFormProps["mode"];
}

export function useZodForm<TSchema extends ZodType>(
  args: UseZodFormArgs<TSchema>,
): UseFormReturn<TSchema["_input"] & FieldValues> {
  type Values = TSchema["_input"] & FieldValues;
  // zodResolver's generic signature is too narrow for our parametric TSchema
  // — cast at the boundary. Runtime behaviour is identical.
  const resolver = zodResolver(
    // biome-ignore lint/suspicious/noExplicitAny: zodResolver generic boundary
    args.schema as any,
  ) as unknown as Resolver<Values>;
  return useForm<Values>({
    resolver,
    ...(args.defaultValues !== undefined ? { defaultValues: args.defaultValues } : {}),
    ...(args.mode !== undefined ? { mode: args.mode } : {}),
  });
}
