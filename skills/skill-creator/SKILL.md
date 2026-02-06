---
name: skill-creator
description: Create or update AgentSkills. Use when designing, structuring, or packaging skills with scripts, references, and assets.
---

# Skill Creator

This skill provides guidance for creating effective skills.

## About Skills

Skills are modular, self-contained packages that extend the agent's capabilities by providing
specialized knowledge, workflows, and tools. They transform the agent from a general-purpose
assistant into a specialized one equipped with procedural knowledge.

### What Skills Provide

1. Specialized workflows - Multi-step procedures for specific domains
2. Tool integrations - Instructions for working with specific file formats or APIs
3. Domain expertise - Company-specific knowledge, schemas, business logic
4. Bundled resources - Scripts, references, and assets for complex tasks

## Core Principles

### Concise is Key

The context window is a shared resource. Only add context the agent doesn't already have. Prefer concise examples over verbose explanations.

### Anatomy of a Skill

```
skill-name/
  SKILL.md (required)
    - YAML frontmatter: name, description
    - Markdown instructions
  scripts/      (optional) - Executable code
  references/   (optional) - Documentation for context
  assets/       (optional) - Files used in output
```

#### SKILL.md

- **Frontmatter** (YAML): `name` and `description` fields. Description is the primary triggering mechanism.
- **Body** (Markdown): Instructions loaded after the skill triggers.

### Progressive Disclosure

Skills use three-level loading:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - As needed (unlimited)

## Skill Creation Process

1. Understand the skill with concrete examples
2. Plan reusable contents (scripts, references, assets)
3. Create SKILL.md with proper frontmatter
4. Implement resources and instructions
5. Test and iterate based on real usage

### Naming

- Lowercase, digits, hyphens only
- Under 64 characters
- Prefer short, verb-led phrases
- Namespace by tool when helpful (e.g., `gh-address-comments`)

### Frontmatter Guidelines

- `name`: The skill name
- `description`: What the skill does AND when to use it. Include trigger contexts.
  All "when to use" info goes here since the body only loads after triggering.
