"use client";

/**
 * Lazily resolves (creating on first use) a paired campfire group chat and
 * renders it via CampfireThread once opened. Shared by the calendar, circle,
 * and event "Discuss" entry points — each just supplies its own resolver.
 */

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampfireThread } from "@/components/ui/campfire-thread";

interface LazyDiscussThreadProps {
  isAuthenticated: boolean;
  /** Resolves (creating on first use) the paired conversation's id. */
  resolveConversationId: () => Promise<string>;
  title?: string;
  emptyLabel?: string;
  className?: string;
}

export function LazyDiscussThread({
  isAuthenticated,
  resolveConversationId,
  title = "Discuss",
  emptyLabel = "No messages yet. Start the conversation.",
  className = "mt-8",
}: LazyDiscussThreadProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isAuthenticated) return null;

  if (!conversationId) {
    return (
      <div className={className}>
        <Button
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                const id = await resolveConversationId();
                setConversationId(id);
              } catch (e) {
                // e.g. "RSVP to this event to join its chat." — the chats
                // are for members only (#164).
                setError(
                  e instanceof Error ? e.message : "This chat couldn't open.",
                );
              }
            })
          }
          className="gap-1.5 rounded-full text-sm"
        >
          <MessageCircle className="w-4 h-4" aria-hidden />
          {isPending ? "Opening…" : title}
        </Button>
        {error && (
          <p role="status" className="mt-2 text-sm text-text-secondary">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <CampfireThread
      conversationId={conversationId}
      title={title}
      emptyLabel={emptyLabel}
    />
  );
}
