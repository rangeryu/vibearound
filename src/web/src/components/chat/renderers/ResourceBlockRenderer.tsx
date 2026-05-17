"use client";

import { FileText } from "lucide-react";
import { useI18n } from "@va/i18n";
import { MessageResponse } from "../MessageResponse";
import { fileNameFromUri, proxiedFileUrl } from "./contentUtils";
import type { ContentBlock } from "@agentclientprotocol/sdk";

type ResourceBlock = Extract<ContentBlock, { type: "resource" }>;

function isMarkdownResource(mimeType: string | null | undefined, uri: string) {
  const type = mimeType?.split(";")[0]?.trim().toLowerCase();
  return (
    type === "text/markdown" ||
    type === "text/x-markdown" ||
    type?.endsWith("+markdown") ||
    /\.(md|markdown|mdown|mkd|mkdn)$/i.test(uri.split(/[?#]/)[0] ?? uri)
  );
}

export function ResourceBlockRenderer({ block }: { block: ResourceBlock }) {
  const { t } = useI18n();
  const resource = block.resource;
  const label = fileNameFromUri(resource.uri);

  if ("text" in resource) {
    return (
      <details className="py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 truncate">{label}</span>
          {resource.mimeType && (
            <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
              {resource.mimeType}
            </span>
          )}
        </summary>
        {isMarkdownResource(resource.mimeType, resource.uri) ? (
          <div className="mt-3 max-h-80 overflow-auto rounded bg-background/70 p-3">
            <MessageResponse content={resource.text} />
          </div>
        ) : (
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
            {resource.text}
          </pre>
        )}
      </details>
    );
  }

  return (
    <a
      href={proxiedFileUrl(resource.uri, {
        name: label,
        mimeType: resource.mimeType,
      })}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-center gap-3 py-2 text-sm hover:text-foreground"
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {resource.mimeType ?? t("Binary resource")}
        </div>
      </div>
    </a>
  );
}
