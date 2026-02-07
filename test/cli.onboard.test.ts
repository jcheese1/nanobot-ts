import { describe, it, expect } from "vitest";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function runOnboard(homeDir: string) {
  const tsxPath = join(process.cwd(), "node_modules", ".bin", "tsx");
  const result = spawnSync(
    tsxPath,
    ["src/cli/index.ts", "onboard"],
    {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
      encoding: "utf-8",
    },
  );
  return result;
}

describe("cli onboard", () => {
  it("creates config and workspace templates", () => {
    const root = join(tmpdir(), `nanobot-onboard-${Date.now()}`);
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });

    const res = runOnboard(home);
    expect(res.status).toBe(0);

    const dataDir = join(home, ".nanobot");
    const configPath = join(dataDir, "config.json");
    const workspace = join(dataDir, "workspace");

    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(workspace, "SOUL.md"))).toBe(true);
    expect(existsSync(join(workspace, "USER.md"))).toBe(true);
    expect(existsSync(join(workspace, "HEARTBEAT.md"))).toBe(true);
    expect(existsSync(join(workspace, "memory", "MEMORY.md"))).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config?.agents?.defaults?.workspace).toBe("~/.nanobot/workspace");

    const agents = readFileSync(join(workspace, "AGENTS.md"), "utf-8");
    expect(agents).toContain("Agent Instructions");

    rmSync(root, { recursive: true, force: true });
  });

  it("does not overwrite existing config", () => {
    const root = join(tmpdir(), `nanobot-onboard-${Date.now()}`);
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });

    const first = runOnboard(home);
    expect(first.status).toBe(0);

    const second = runOnboard(home);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Config already exists");

    rmSync(root, { recursive: true, force: true });
  });
});
