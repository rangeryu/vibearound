import { invoke } from "@tauri-apps/api/core";

const RELEASE_API_URL =
  "https://api.github.com/repos/jazzenchen/VibeAround/releases/latest";
const RELEASES_URL = "https://github.com/jazzenchen/VibeAround/releases/latest";

export interface UpdateReleaseInfo {
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  name: string;
  htmlUrl: string;
  publishedAt: string | null;
  downloadUrl: string | null;
  assetName: string | null;
}

export type UpdateCheckResult =
  | { state: "updateAvailable"; release: UpdateReleaseInfo }
  | { state: "upToDate" }
  | { state: "unavailable"; error: string };

interface AppInfo {
  version: string;
  os: string;
  arch: string;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

let startupCheck: Promise<UpdateCheckResult> | null = null;

export function checkForUpdate(options: { force?: boolean } = {}) {
  if (!options.force && startupCheck) return startupCheck;

  const check = performUpdateCheck();
  if (!options.force) startupCheck = check;
  return check;
}

async function performUpdateCheck(): Promise<UpdateCheckResult> {
  try {
    const preview = devPreviewUpdate();
    if (preview) return preview;

    const [appInfo, release] = await Promise.all([
      getAppInfo(),
      fetchLatestRelease(),
    ]);

    const latestVersion = versionFromTag(release.tag_name);
    if (!latestVersion) {
      return { state: "unavailable", error: "latest release has no version tag" };
    }

    if (compareVersions(latestVersion, appInfo.version) <= 0) {
      return { state: "upToDate" };
    }

    const assets = Array.isArray(release.assets)
      ? release.assets.filter(isReleaseAsset)
      : [];
    const asset = selectInstallerAsset(assets, appInfo);

    return {
      state: "updateAvailable",
      release: {
        currentVersion: normalizeVersionLabel(appInfo.version),
        latestVersion,
        tagName: String(release.tag_name),
        name:
          typeof release.name === "string" && release.name.trim()
            ? release.name.trim()
            : `VibeAround ${String(release.tag_name)}`,
        htmlUrl:
          typeof release.html_url === "string" && release.html_url
            ? release.html_url
            : RELEASES_URL,
        publishedAt:
          typeof release.published_at === "string" ? release.published_at : null,
        downloadUrl:
          typeof asset?.browser_download_url === "string"
            ? asset.browser_download_url
            : null,
        assetName: typeof asset?.name === "string" ? asset.name : null,
      },
    };
  } catch (error) {
    return {
      state: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function devPreviewUpdate(): UpdateCheckResult | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const enabled =
    params.get("va_update_preview") === "1" ||
    window.localStorage.getItem("vibearound.updatePreview") === "1";
  if (!enabled) return null;

  const currentVersion = normalizeVersionLabel(__APP_VERSION_LABEL__);
  const latestVersion = bumpPatchVersion(currentVersion);
  return {
    state: "updateAvailable",
    release: {
      currentVersion,
      latestVersion,
      tagName: `v${latestVersion}`,
      name: `VibeAround v${latestVersion}`,
      htmlUrl: RELEASES_URL,
      publishedAt: new Date().toISOString(),
      downloadUrl: RELEASES_URL,
      assetName: null,
    },
  };
}

function bumpPatchVersion(value: string): string {
  const parts = parseVersionParts(value);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = (parts[2] ?? 0) + 1;
  return `${major}.${minor}.${patch}`;
}

async function getAppInfo(): Promise<AppInfo> {
  try {
    const info = await invoke<AppInfo>("get_app_info");
    if (info?.version) return info;
  } catch (error) {
    console.warn("[desktop-ui] get_app_info failed:", error);
  }

  return {
    version: __APP_VERSION_LABEL__,
    os: inferOs(),
    arch: "unknown",
  };
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }
    return (await response.json()) as GitHubRelease;
  } finally {
    window.clearTimeout(timeout);
  }
}

function versionFromTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

function normalizeVersionLabel(value: string): string {
  return versionFromTag(value) ?? value;
}

function compareVersions(a: string, b: string): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersionParts(value: string): number[] {
  const version = normalizeVersionLabel(value);
  return version
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function isReleaseAsset(value: unknown): value is GitHubReleaseAsset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.browser_download_url === "string";
}

function selectInstallerAsset(
  assets: GitHubReleaseAsset[],
  appInfo: AppInfo,
): GitHubReleaseAsset | null {
  let best: { asset: GitHubReleaseAsset; score: number } | null = null;
  for (const asset of assets) {
    const score = scoreInstallerAsset(String(asset.name), appInfo);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { asset, score };
  }
  return best?.asset ?? null;
}

function scoreInstallerAsset(name: string, appInfo: AppInfo): number {
  const lower = name.toLowerCase();
  const os = appInfo.os.toLowerCase();
  const arch = appInfo.arch.toLowerCase();

  if (os === "macos" || os === "darwin") {
    if (!lower.endsWith(".dmg") && !lower.endsWith(".pkg")) return 0;
    let score = lower.endsWith(".dmg") ? 70 : 55;
    if (isArmArch(arch)) {
      score += hasArmMarker(lower) ? 30 : hasIntelMarker(lower) ? -25 : 5;
    } else if (isIntelArch(arch)) {
      score += hasIntelMarker(lower) ? 30 : hasArmMarker(lower) ? -25 : 5;
    }
    return score;
  }

  if (os === "windows") {
    if (!/\.(exe|msi|zip)$/.test(lower)) return 0;
    let score = lower.endsWith(".exe") ? 70 : lower.endsWith(".msi") ? 60 : 40;
    if (isArmArch(arch)) {
      score += hasArmMarker(lower) ? 30 : hasIntelMarker(lower) ? -25 : 0;
    } else if (isIntelArch(arch)) {
      score += hasIntelMarker(lower) ? 30 : hasArmMarker(lower) ? -25 : 0;
    }
    if (lower.includes("setup")) score += 8;
    if (lower.includes("portable")) score -= 8;
    return score;
  }

  if (os === "linux") {
    if (!/\.(appimage|deb|rpm|tar\.gz)$/.test(lower)) return 0;
    let score = lower.endsWith(".appimage")
      ? 70
      : lower.endsWith(".deb")
        ? 60
        : lower.endsWith(".rpm")
          ? 50
          : 35;
    if (isArmArch(arch)) {
      score += hasArmMarker(lower) ? 30 : hasIntelMarker(lower) ? -25 : 0;
    } else if (isIntelArch(arch)) {
      score += hasIntelMarker(lower) ? 30 : hasArmMarker(lower) ? -25 : 0;
    }
    return score;
  }

  return 0;
}

function hasArmMarker(value: string): boolean {
  return /arm64|aarch64/.test(value);
}

function hasIntelMarker(value: string): boolean {
  return /x64|x86_64|amd64/.test(value);
}

function isArmArch(value: string): boolean {
  return value === "aarch64" || value === "arm64";
}

function isIntelArch(value: string): boolean {
  return value === "x86_64" || value === "x64" || value === "amd64";
}

function inferOs(): string {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux") || userAgent.includes("linux")) return "linux";
  return "unknown";
}
