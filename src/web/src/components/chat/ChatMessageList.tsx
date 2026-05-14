"use client";

import { useI18n } from "@va/i18n";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./Conversation";
import { Message, MessageContent } from "./Message";
import { MessageResponse } from "./MessageResponse";
import type { ChatActivity, ChatMessage } from "./chatTypes";

interface ChatMessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  agentLabel: string;
}

function ChatActivityList({ activities, hasContent }: { activities: ChatActivity[]; hasContent: boolean }) {
  const { t } = useI18n();

  return (
    <div
      className={`space-y-2 text-xs text-muted-foreground ${hasContent ? "mb-3 border-b border-border/50 pb-3" : ""}`}
    >
      {activities.map((activity) => (
        <div key={activity.id} className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 font-mono">
            <span className="shrink-0 uppercase text-muted-foreground/70">
              {activity.kind === "thinking" ? t("Thinking") : t("Tool")}
            </span>
            <span className="truncate text-foreground/75">{activity.label}</span>
            {activity.status && (
              <span className="shrink-0 text-muted-foreground/60">{activity.status}</span>
            )}
          </div>
          {activity.detail && (
            <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground/80">
              {activity.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ChatMessageList({ messages, streaming, agentLabel }: ChatMessageListProps) {
  const { t } = useI18n();

  return (
    <Conversation className="flex-1">
      <ConversationContent>
        {messages.length === 0 ? (
          <ConversationEmptyState
            title={t("Chat with {{agent}}", { agent: agentLabel })}
            description={t("Send a message to start.")}
          />
        ) : (
          messages.map((msg, i) => (
            <Message key={i} from={msg.role}>
              <MessageContent
                className={
                  msg.role === "user"
                    ? "rounded-lg bg-primary/15 px-4 py-3 text-foreground"
                    : msg.mode === "standalone"
                      ? "rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-muted-foreground"
                      : "rounded-lg bg-muted/50 px-4 py-3 text-foreground"
                }
              >
                {msg.role === "user" ? (
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                ) : msg.mode === "standalone" ? (
                  <p className="whitespace-pre-wrap text-sm leading-7">{msg.content}</p>
                ) : (
                  <>
                    {msg.activities?.length ? (
                      <ChatActivityList
                        activities={msg.activities}
                        hasContent={Boolean(msg.content)}
                      />
                    ) : null}
                    {msg.content && (
                      <MessageResponse
                        content={msg.content}
                        isStreaming={streaming && i === messages.length - 1}
                      />
                    )}
                    {msg.progress && (
                      <span className="text-xs text-muted-foreground/60 font-mono animate-pulse">
                        {msg.progress}
                      </span>
                    )}
                  </>
                )}
              </MessageContent>
            </Message>
          ))
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
