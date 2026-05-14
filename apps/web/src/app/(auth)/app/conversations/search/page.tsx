// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U13 RSC entry for /app/conversations/search.
//
// Renders the Client component which reads `?q=<query>` via useSearchParams
// and POSTs to /api/conversations/search (Plan 01 verified: HTTP method is
// POST, not GET).
//
// No server prefetch — the search is intentionally client-driven so the URL
// query param is the single source of truth and back/forward navigation
// works naturally.
import { ConversationsSearchClient } from "@/components/screens/conversations/ConversationsSearchClient";

export default function ConversationsSearchPage(): React.JSX.Element {
  return <ConversationsSearchClient />;
}
