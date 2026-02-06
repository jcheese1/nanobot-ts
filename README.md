# nanobot

Lightweight AI assistant -- TypeScript port of [HKUDS/nanobot](https://github.com/HKUDS/nanobot).

Zero native dependencies. Runs in Node.js or WebContainer.

## Quickstart

```bash
npm install
npm run build
node dist/cli/index.mjs onboard
```

Add your API key to `~/.nanobot/config.json`, then:

```bash
node dist/cli/index.mjs agent -m "Hello!"
```

## Architecture

```
src/
  agent/          Core agent loop, context builder, memory, skills, subagents
    tools/        Tool implementations (filesystem, shell, web, message, spawn, cron)
  bus/            Async message bus (inbound/outbound queues)
  channels/       Chat platform integrations (Telegram via grammY)
  cli/            Commander-based CLI
  config/         Zod schemas + JSON config loader
  cron/           Timer-based job scheduler
  heartbeat/      Periodic HEARTBEAT.md checker
  providers/      LLM providers (OpenAI SDK -- works with OpenRouter, Anthropic, etc.)
  session/        JSONL conversation persistence
  utils/          Path helpers, binary finder
skills/           Bundled skill definitions (cron, github, summarize, weather, skill-creator)
```

### How it works

1. Messages arrive via the **bus** (from Telegram, CLI, cron, or heartbeat)
2. The **agent loop** builds context (system prompt + history + memory + skills)
3. The **LLM provider** generates a response (with optional tool calls)
4. **Tools** execute (filesystem, shell, web search, etc.) and results feed back to the LLM
5. Final response is routed back through the bus to the originating channel

## CLI Commands

| Command | Description |
|---------|-------------|
| `nanobot onboard` | Initialize config and workspace |
| `nanobot gateway` | Start the full gateway (agent + channels + cron + heartbeat) |
| `nanobot agent -m "..."` | Send a single message to the agent |
| `nanobot agent` | Interactive chat mode |
| `nanobot channels status` | Show channel configuration |
| `nanobot cron list` | List scheduled jobs |
| `nanobot cron add` | Add a scheduled job |
| `nanobot cron remove <id>` | Remove a scheduled job |
| `nanobot status` | Show config and API key status |

## Scripts

```bash
npm run build       # Build with tsdown
npm run dev         # Run CLI via tsx (no build needed)
npm run typecheck   # Type-check with tsc --noEmit
npm run start       # Run built CLI
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `openai` | LLM provider (OpenAI-compatible API) |
| `zod` | Config schema validation |
| `commander` | CLI framework |
| `grammy` | Telegram bot (grammY) |
| `cron-parser` | Cron expression parsing |

## Configuration

Config lives at `~/.nanobot/config.json`. Supports multiple providers:

```json
{
  "providers": {
    "openrouter": { "apiKey": "sk-or-..." },
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "maxTokens": 8192,
      "maxToolIterations": 20
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:ABC..."
    }
  }
}
```

## Programmatic usage

```ts
import { AgentLoop, MessageBus, OpenAIProvider, loadConfig } from "nanobot";

const config = loadConfig();
const bus = new MessageBus();
const provider = new OpenAIProvider({
  apiKey: "sk-...",
  defaultModel: "anthropic/claude-sonnet-4-20250514",
});

const agent = new AgentLoop({
  bus,
  provider,
  workspace: "/path/to/workspace",
});

const response = await agent.processDirect("What time is it?");
```

## Differences from Python nanobot

- WhatsApp and Feishu channels removed (Telegram only)
- `litellm` replaced with OpenAI SDK
- `pydantic` replaced with `zod`
- `typer`/`rich` replaced with `commander`
- `python-telegram-bot` replaced with `grammy`
- No native dependencies -- suitable for WebContainer deployment

## License

MIT
