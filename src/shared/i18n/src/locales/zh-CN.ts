import { zhCNShared } from "./zh-CN/shared";
import { zhCNDesktopDashboard } from "./zh-CN/desktop-dashboard";
import { zhCNLaunch } from "./zh-CN/launch";
import { zhCNOnboarding } from "./zh-CN/onboarding";
import { zhCNDesktopPages } from "./zh-CN/desktop-pages";
import { zhCNWebDashboard } from "./zh-CN/web-dashboard";
import { zhCNPairing } from "./zh-CN/pairing";

export const zhCN: Record<string, string> = {
  ...zhCNShared,
  ...zhCNDesktopDashboard,
  ...zhCNLaunch,
  ...zhCNOnboarding,
  ...zhCNDesktopPages,
  ...zhCNWebDashboard,
  ...zhCNPairing,
};
