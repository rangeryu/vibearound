"use client";

import { Bot, Loader2 } from "lucide-react";
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
  replayLoading?: boolean;
  replayTitle?: string;
}

function ChatActivityList({ activities, hasContent }: { activities: ChatActivity[]; hasContent: boolean }) {
  const { t } = useI18n();
  const visibleActivities =
    activities.length > 8 ? activities.slice(Math.max(activities.length - 6, 0)) : activities;
  const hiddenCount = activities.length - visibleActivities.length;

  return (
    <div
      className={`space-y-2 text-xs text-muted-foreground ${hasContent ? "mb-3 border-b border-border/50 pb-3" : ""}`}
    >
      {hiddenCount > 0 && (
        <div className="font-mono text-[11px] text-muted-foreground/50">
          {t("{{count}} earlier activity events", { count: hiddenCount })}
        </div>
      )}
      {visibleActivities.map((activity) => (
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

export function ChatMessageList({
  messages,
  streaming,
  agentLabel,
  replayLoading = false,
  replayTitle,
}: ChatMessageListProps) {
  const { t } = useI18n();

  return (
    <Conversation className="flex-1">
      <ConversationContent className="px-4 py-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          {replayLoading && (
            <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="min-w-0 truncate">
                {replayTitle
                  ? t("Loading {{title}}…", { title: replayTitle })
                  : t("Loading chat history…")}
              </span>
            </div>
          )}
          {messages.length === 0 && !replayLoading ? (
            <ConversationEmptyState
              title={t("Chat with {{agent}}", { agent: agentLabel })}
              description={t("Send a message to start.")}
              className="min-h-[50vh]"
              icon={
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-7 w-7 text-muted-foreground" />
                </div>
              }
            />
          ) : (
            messages.map((msg, i) => (
              <Message key={i} from={msg.role}>
                <MessageContent
                  className={
                    msg.role === "user"
                      ? "max-w-[85%] rounded-lg bg-muted px-4 py-3 text-foreground sm:max-w-[34rem]"
                      : msg.mode === "standalone"
                        ? "w-full px-0 py-1 text-muted-foreground"
                        : "w-full px-0 py-1 text-foreground"
                  }
                >
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm leading-7">{msg.content}</p>
                  ) : msg.mode === "standalone" ? (
                    <p className="whitespace-pre-wrap text-sm leading-8">{msg.content}</p>
                  ) : (
                    <>
                      {streaming &&
                        i === messages.length - 1 &&
                        !msg.content &&
                        !msg.progress &&
                        !msg.activities?.length && (
                          <span className="font-mono text-xs text-primary/80 animate-pulse">
                            {t("AI is working…")}
                          </span>
                        )}
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
                        <span className="font-mono text-xs text-muted-foreground/60 animate-pulse">
                          {msg.progress}
                        </span>
                      )}
                    </>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </div>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
