export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ATTACHMENT_ACCEPT_PARTS = [
  "image/*",
  "text/*",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".heic",
  ".heif",
  ".bmp",
  ".tif",
  ".tiff",
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".pages",
  ".ppt",
  ".pptx",
  ".odp",
  ".key",
  ".xls",
  ".xlsx",
  ".csv",
  ".tsv",
  ".ods",
  ".numbers",
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".kts",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".ini",
  ".conf",
  ".cfg",
  ".env",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".lock",
  ".log",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".rar",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.apple.pages",
  "application/vnd.apple.keynote",
  "application/vnd.apple.numbers",
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
];

const ALLOWED_ATTACHMENT_PREFIXES = ["image/", "text/"];

const ALLOWED_ATTACHMENT_EXACT = new Set(
  ATTACHMENT_ACCEPT_PARTS.filter((part) => !part.endsWith("/*") && !part.startsWith(".")),
);

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(
  ATTACHMENT_ACCEPT_PARTS.filter((part) => part.startsWith(".")).map((part) =>
    part.slice(1),
  ),
);

const ALLOWED_EXTENSIONLESS_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "notice",
]);

export const CHAT_ATTACHMENT_ACCEPT = ATTACHMENT_ACCEPT_PARTS.join(",");

export function isAllowedAttachment(file: File): boolean {
  if (file.size > MAX_ATTACHMENT_BYTES) return false;
  const extension = fileExtension(file.name);
  if (extension && ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) return true;
  if (ALLOWED_EXTENSIONLESS_FILENAMES.has(file.name.trim().toLowerCase())) return true;

  const mime = normalizedMime(file.type);
  if (!mime) return false;
  return (
    ALLOWED_ATTACHMENT_PREFIXES.some((prefix) => mime.startsWith(prefix)) ||
    ALLOWED_ATTACHMENT_EXACT.has(mime)
  );
}

function normalizedMime(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  if (index < 0 || index === normalized.length - 1) return "";
  return normalized.slice(index + 1);
}
