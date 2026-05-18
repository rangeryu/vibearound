import { useCallback, useState } from "react";
import { uploadChatFile } from "@/api/sessions";
import { MAX_ATTACHMENT_BYTES, isAllowedAttachment } from "./attachmentTypes";
import type { ChatAttachment } from "./chatTypes";

type Translate = (
  key: string,
  vars?: Record<string, string | number | null | undefined>,
) => string;

export function useChatAttachments(t: Translate) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [attachmentsUploadingCount, setAttachmentsUploadingCount] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setAttachmentError(undefined);
  }, []);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const accepted = files.filter(isAllowedAttachment);
    const rejected = files.filter((file) => !isAllowedAttachment(file));
    if (rejected.length > 0) {
      setAttachmentError(describeRejections(rejected, t));
    }
    if (accepted.length === 0) {
      return;
    }
    setAttachmentsUploading(true);
    setAttachmentsUploadingCount(accepted.length);
    if (rejected.length === 0) {
      setAttachmentError(undefined);
    }
    try {
      const results = await Promise.allSettled(
        accepted.map((file) => uploadChatFile(file)),
      );
      const uploaded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (uploaded.length > 0) {
        setAttachments((prev) => [
          ...prev,
          ...uploaded.map((file) => ({
            id: file.id,
            name: file.name,
            mimeType: file.mime_type,
            size: file.size,
            uri: file.uri,
          })),
        ]);
      }
      if (failed.length > 0) {
        failed.forEach((result) => {
          if (result.status === "rejected") {
            console.warn("[useChatAttachments] failed to upload attachment:", result.reason);
          }
        });
        setAttachmentError(
          t("{{count}} files failed to upload.", { count: failed.length }),
        );
      }
    } catch (error) {
      console.warn("[useChatAttachments] failed to upload attachment:", error);
      setAttachmentError(
        error instanceof Error ? error.message : t("Failed to upload attachment"),
      );
    } finally {
      setAttachmentsUploading(false);
      setAttachmentsUploadingCount(0);
    }
  }, [t]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    setAttachmentError(undefined);
  }, []);

  return {
    attachments,
    attachmentsUploading,
    attachmentsUploadingCount,
    attachmentError,
    clearAttachments,
    handleFilesSelected,
    handleRemoveAttachment,
  };
}

function describeRejections(files: File[], t: Translate): string {
  const [first, ...rest] = files;
  if (!first) return "";
  const message = describeRejection(first, t);
  if (rest.length === 0) return message;
  return t("{{message}} {{count}} more files were skipped.", {
    message,
    count: rest.length,
  });
}

function describeRejection(file: File, t: Translate): string {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return t("{{name}} exceeds the {{limit}} MB upload limit.", {
      name: file.name,
      limit: MAX_ATTACHMENT_BYTES / (1024 * 1024),
    });
  }
  return t("{{name}} file type is not allowed.", { name: file.name });
}
