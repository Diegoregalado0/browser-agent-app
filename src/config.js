import { homedir } from "node:os";
import { join } from "node:path";

export const HOME_DIR = process.env.BROWSER_AGENT_HOME || join(homedir(), ".browser-agent");
export const PROFILE_DIR = join(HOME_DIR, "chrome-profile");
