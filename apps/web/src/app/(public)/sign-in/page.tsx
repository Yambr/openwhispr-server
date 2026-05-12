/**
 * Sign-in stub.
 *
 * This stub exists only so the Plan 01 validation step can probe the
 * stricter CSP variant against `/sign-in`. Plan 07 (U1) overwrites this
 * file with the real react-hook-form + zod sign-in surface.
 */
export default function SignInStubPage(): React.JSX.Element {
  return (
    <main>
      <h1>Sign in</h1>
      <p>Plan 07 will replace this stub with the real sign-in form.</p>
    </main>
  );
}
