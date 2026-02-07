import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { which } from "../src/utils/which.ts";

describe("utils/which", () => {
  it("returns path for executable in PATH", () => {
    const base = join(tmpdir(), `nanobot-which-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    const bin = join(base, "mybin");
    writeFileSync(bin, "#!/bin/sh\necho ok\n");
    chmodSync(bin, 0o755);

    const oldPath = process.env.PATH;
    process.env.PATH = base;
    try {
      expect(which("mybin")).toBe(bin);
    } finally {
      process.env.PATH = oldPath;
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("returns null for non-executable", () => {
    const base = join(tmpdir(), `nanobot-which-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    const bin = join(base, "mybin");
    writeFileSync(bin, "nope\n");
    chmodSync(bin, 0o644);

    const oldPath = process.env.PATH;
    process.env.PATH = base;
    try {
      expect(which("mybin")).toBeNull();
    } finally {
      process.env.PATH = oldPath;
      rmSync(base, { recursive: true, force: true });
    }
  });
});
