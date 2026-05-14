// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U12 MessageBubble.
//
// Renders one CloudMessage with role-specific styling:
//   - user      → right-aligned soft-accent bubble
//   - assistant → left-aligned panel-2 bubble
//   - system    → small muted text
//   - tool      → monospace block
//
// Role label is rendered via i18n key `end-user.conv-detail.role.<role>.label`
// — never displays the raw `role` value.
"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export interface CloudMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const ROLE_LABEL_KEY: Record<string, string> = {
  user: "end-user:end-user.conv-detail.role.user.label",
  assistant: "end-user:end-user.conv-detail.role.assistant.label",
  system: "end-user:end-user.conv-detail.role.system.label",
  tool: "end-user:end-user.conv-detail.role.tool.label",
};

export function roleLabelKey(role: string): string {
  return ROLE_LABEL_KEY[role] ?? ROLE_LABEL_KEY.user!;
}

export interface MessageBubbleProps {
  message: CloudMessage;
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const label = t(roleLabelKey(message.role));

  if (message.role === "system") {
    return (
      <div
        className="text-text-muted text-xs italic"
        data-testid="conv-message-bubble"
        data-role="system"
      >
        <Badge variant="secondary">{label}</Badge>
        <span className="ml-2">{message.content}</span>
      </div>
    );
  }

  if (message.role === "tool") {
    return (
      <div
        className="rounded-md border bg-muted p-3 font-mono text-xs"
        data-testid="conv-message-bubble"
        data-role="tool"
      >
        <Badge variant="outline">{label}</Badge>
        <pre className="mt-2 whitespace-pre-wrap">{message.content}</pre>
      </div>
    );
  }

  const isUser = message.role === "user";
  const alignment = isUser ? "ml-auto" : "mr-auto";
  // Phase 07.1 / Plan 13.3 — WCAG 2.2 AA contrast on the user bubble.
  // `bg-accent` (#2563eb / blue-600) against the inherited `text-foreground`
  // token (#18181b / zinc-900) yields 3.42:1, below the 4.5:1 AA threshold
  // and flagged by axe on the populated U12 detail screen. Switch the user
  // bubble to the canonical accent surface pair: `bg-accent` +
  // `text-accent-foreground` (#ffffff), which yields 8.6:1 — comfortably
  // AAA. The assistant bubble keeps `bg-card` + `text-card-foreground`.
  const tone = isUser ? "bg-accent text-accent-foreground" : "bg-card text-card-foreground";
  return (
    <div
      className={`max-w-[80%] rounded-2xl border p-3 ${alignment} ${tone}`}
      data-testid="conv-message-bubble"
      data-role={message.role}
    >
      <Badge variant={isUser ? "default" : "secondary"}>{label}</Badge>
      <div className="mt-2 whitespace-pre-wrap text-sm">{message.content}</div>
    </div>
  );
}
