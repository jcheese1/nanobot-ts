import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";

/** Simple `which` implementation - find a binary in PATH. */
export function which(name: string): string | null {
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const fullPath = join(dir, name);
    try {
      accessSync(fullPath, constants.X_OK);
      return fullPath;
    } catch {
      // not found in this dir
    }
  }
  return null;
}
