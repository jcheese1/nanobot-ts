import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { which } from "../utils/which.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Default builtin skills directory (relative to this file in dist). */
function getBuiltinSkillsDir(): string {
  // In dist: dist/agent/skills.js -> ../../skills
  // In src: src/agent/skills.ts -> ../../skills
  return join(dirname(dirname(__dirname)), "skills");
}

interface SkillInfo {
  name: string;
  path: string;
  source: "workspace" | "builtin";
}

interface SkillMeta {
  description?: string;
  always?: string;
  metadata?: string;
  [key: string]: string | undefined;
}

/**
 * Loader for agent skills.
 * Skills are markdown files (SKILL.md) that teach the agent specific capabilities.
 */
export class SkillsLoader {
  private workspace: string;
  private workspaceSkills: string;
  private builtinSkills: string;

  constructor(workspace: string, builtinSkillsDir?: string) {
    this.workspace = workspace;
    this.workspaceSkills = join(workspace, "skills");
    this.builtinSkills = builtinSkillsDir ?? getBuiltinSkillsDir();
  }

  /** List all available skills. */
  listSkills(filterUnavailable = true): SkillInfo[] {
    const skills: SkillInfo[] = [];

    // Workspace skills (highest priority)
    if (existsSync(this.workspaceSkills)) {
      for (const entry of readdirSync(this.workspaceSkills)) {
        const skillDir = join(this.workspaceSkills, entry);
        const skillFile = join(skillDir, "SKILL.md");
        if (statSync(skillDir).isDirectory() && existsSync(skillFile)) {
          skills.push({ name: entry, path: skillFile, source: "workspace" });
        }
      }
    }

    // Built-in skills
    if (existsSync(this.builtinSkills)) {
      for (const entry of readdirSync(this.builtinSkills)) {
        const skillDir = join(this.builtinSkills, entry);
        const skillFile = join(skillDir, "SKILL.md");
        if (
          statSync(skillDir).isDirectory() &&
          existsSync(skillFile) &&
          !skills.some((s) => s.name === entry)
        ) {
          skills.push({ name: entry, path: skillFile, source: "builtin" });
        }
      }
    }

    if (filterUnavailable) {
      return skills.filter((s) =>
        this.checkRequirements(this.getSkillMeta(s.name)),
      );
    }
    return skills;
  }

  /** Load a skill by name. */
  loadSkill(name: string): string | null {
    const wsSkill = join(this.workspaceSkills, name, "SKILL.md");
    if (existsSync(wsSkill)) {
      return readFileSync(wsSkill, "utf-8");
    }

    const builtinSkill = join(this.builtinSkills, name, "SKILL.md");
    if (existsSync(builtinSkill)) {
      return readFileSync(builtinSkill, "utf-8");
    }

    return null;
  }

  /** Load specific skills for inclusion in agent context. */
  loadSkillsForContext(skillNames: string[]): string {
    const parts: string[] = [];
    for (const name of skillNames) {
      const content = this.loadSkill(name);
      if (content) {
        const stripped = this.stripFrontmatter(content);
        parts.push(`### Skill: ${name}\n\n${stripped}`);
      }
    }
    return parts.join("\n\n---\n\n");
  }

  /** Build a summary of all skills. */
  buildSkillsSummary(): string {
    const allSkills = this.listSkills(false);
    if (allSkills.length === 0) return "";

    const escapeXml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const lines = ["<skills>"];
    for (const s of allSkills) {
      const name = escapeXml(s.name);
      const desc = escapeXml(this.getSkillDescription(s.name));
      const meta = this.getSkillMeta(s.name);
      const available = this.checkRequirements(meta);

      lines.push(`  <skill available="${available}">`);
      lines.push(`    <name>${name}</name>`);
      lines.push(`    <description>${desc}</description>`);
      lines.push(`    <location>${s.path}</location>`);

      if (!available) {
        const missing = this.getMissingRequirements(meta);
        if (missing) {
          lines.push(`    <requires>${escapeXml(missing)}</requires>`);
        }
      }

      lines.push("  </skill>");
    }
    lines.push("</skills>");
    return lines.join("\n");
  }

  /** Get skills marked as always=true. */
  getAlwaysSkills(): string[] {
    const result: string[] = [];
    for (const s of this.listSkills(true)) {
      const meta = this.getSkillMetadata(s.name);
      const skillMeta = this.parseNanobotMetadata(meta?.metadata ?? "");
      if (skillMeta.always || meta?.always) {
        result.push(s.name);
      }
    }
    return result;
  }

  /** Get metadata from a skill's frontmatter. */
  getSkillMetadata(name: string): SkillMeta | null {
    const content = this.loadSkill(name);
    if (!content) return null;

    if (content.startsWith("---")) {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        const metadata: SkillMeta = {};
        for (const line of match[1].split("\n")) {
          const colonIdx = line.indexOf(":");
          if (colonIdx !== -1) {
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
            metadata[key] = value;
          }
        }
        return metadata;
      }
    }
    return null;
  }

  private stripFrontmatter(content: string): string {
    if (content.startsWith("---")) {
      const match = content.match(/^---\n[\s\S]*?\n---\n/);
      if (match) return content.slice(match[0].length).trim();
    }
    return content;
  }

  private parseNanobotMetadata(raw: string): Record<string, unknown> {
    try {
      const data = JSON.parse(raw);
      return typeof data === "object" && data !== null
        ? (data.nanobot ?? {})
        : {};
    } catch {
      return {};
    }
  }

  private checkRequirements(meta: Record<string, unknown>): boolean {
    const requires = (meta.requires ?? {}) as Record<string, string[]>;
    for (const bin of requires.bins ?? []) {
      if (!which(bin)) return false;
    }
    for (const env of requires.env ?? []) {
      if (!process.env[env]) return false;
    }
    return true;
  }

  private getSkillMeta(name: string): Record<string, unknown> {
    const meta = this.getSkillMetadata(name) ?? {};
    return this.parseNanobotMetadata(String(meta.metadata ?? ""));
  }

  private getSkillDescription(name: string): string {
    const meta = this.getSkillMetadata(name);
    return meta?.description ?? name;
  }

  private getMissingRequirements(meta: Record<string, unknown>): string {
    const missing: string[] = [];
    const requires = (meta.requires ?? {}) as Record<string, string[]>;
    for (const bin of requires.bins ?? []) {
      if (!which(bin)) missing.push(`CLI: ${bin}`);
    }
    for (const env of requires.env ?? []) {
      if (!process.env[env]) missing.push(`ENV: ${env}`);
    }
    return missing.join(", ");
  }
}
