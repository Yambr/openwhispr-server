// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-02-b — Reusable password <input> + eye-toggle building block.
//
// Extracts the visual + behavioral pattern that has lived inline in
// SignInForm.tsx (lines 200-236, Phase 18.1.1 D-23) since shipping. The
// component is namespace-agnostic on purpose — it takes the SHOW/HIDE
// toggle labels as props instead of calling `useTranslation` directly,
// so callers translate their own labels with whichever namespace (and
// whichever resource pack) is in scope. This is how `SignInForm`,
// `SignUpForm`, and `ResetPasswordForm` all share the SAME component
// while keeping their own copy strategy.
//
// FormControl/Radix-Slot contract (CRITICAL):
//   FormControl is a Radix `Slot.Root` that forwards `id` + `aria-describedby`
//   to its SINGLE direct child. If the component's outer wrapper <div> were
//   placed inside <FormControl>, the Slot would forward those attributes to
//   the wrapper <div> — breaking `getByLabelText` (FormLabel's htmlFor would
//   target the wrapper, not the <input>). The original SignInForm inline
//   block worked around this by wrapping the FormControl in <div className="relative">
//   from the OUTSIDE. This component reproduces that pattern: it OWNS the
//   <FormControl> internally so the Slot forwards directly to <Input>, and
//   the wrapper <div className="relative"> + toggle <button> live OUTSIDE
//   the FormControl as absolute siblings. Callers therefore do NOT wrap
//   this component in <FormControl> themselves.
//
// React-19 passes `ref` as a regular prop, so this is a plain function
// component (no forwardRef indirection). The internal <Input> already
// spreads `...props` onto the underlying <input>, so React-Hook-Form's
// `field.ref` lands on the real DOM input via the {...rest} spread.
//
// DOM shape MUST stay byte-equivalent to the SignInForm inline block so
// the Phase 53 visual baselines on /sign-in do not drift:
//   <div className="relative">
//     <FormControl><Input type={... password|text ...} {...rest} /></FormControl>
//     <button type="button" className="absolute top-1/2 right-2 ...">
//       <span className="sr-only">{toggleLabel}</span>
//       <Eye | EyeOff aria-hidden="true" className="size-4" />
//     </button>
//   </div>
"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export interface PasswordInputWithToggleProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visually-hidden label used when the password is currently MASKED
   *  (i.e. clicking the button will reveal it). */
  togglePasswordShowLabel: string;
  /** Visually-hidden label used when the password is currently REVEALED
   *  (i.e. clicking the button will mask it). */
  togglePasswordHideLabel: string;
}

export function PasswordInputWithToggle({
  togglePasswordShowLabel,
  togglePasswordHideLabel,
  ...rest
}: PasswordInputWithToggleProps): React.JSX.Element {
  const [showPassword, setShowPassword] = useState(false);
  const toggleLabel = showPassword ? togglePasswordHideLabel : togglePasswordShowLabel;
  return (
    <div className="relative">
      <FormControl>
        <Input type={showPassword ? "text" : "password"} {...rest} />
      </FormControl>
      {/*
        Toggle button. Accessible name is exposed via a visually-hidden
        <span> rather than aria-label so the button's accessible name
        does not collide with the password input's FormLabel proximity
        binding. Matches the original SignInForm inline pattern exactly.
      */}
      <button
        type="button"
        onClick={() => setShowPassword((v) => !v)}
        className="absolute top-1/2 right-2 grid -translate-y-1/2 size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="sr-only">{toggleLabel}</span>
        {showPassword ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}
