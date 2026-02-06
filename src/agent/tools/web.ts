import { Tool } from "./base.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36";

/** Strip HTML tags and decode entities. */
function stripTags(text: string): string {
  let result = text;
  result = result.replace(/<script[\s\S]*?<\/script>/gi, "");
  result = result.replace(/<style[\s\S]*?<\/style>/gi, "");
  result = result.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  result = result
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return result.trim();
}

/** Normalize whitespace. */
function normalize(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Validate URL. */
function validateUrl(url: string): { valid: boolean; error: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        error: `Only http/https allowed, got '${parsed.protocol}'`,
      };
    }
    if (!parsed.hostname) {
      return { valid: false, error: "Missing domain" };
    }
    return { valid: true, error: "" };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

/** Convert HTML to basic markdown. */
function htmlToMarkdown(html: string): string {
  let text = html;
  // Links
  text = text.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, url, inner) => `[${stripTags(inner)}](${url})`,
  );
  // Headings
  text = text.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level, inner) => `\n${"#".repeat(Number(level))} ${stripTags(inner)}\n`,
  );
  // List items
  text = text.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_m, inner) => `\n- ${stripTags(inner)}`,
  );
  // Block elements
  text = text.replace(/<\/(p|div|section|article)>/gi, "\n\n");
  text = text.replace(/<(br|hr)\s*\/?>/gi, "\n");
  return normalize(stripTags(text));
}

/** Search the web using Brave Search API. */
export class WebSearchTool extends Tool {
  readonly name = "web_search";
  readonly description = "Search the web. Returns titles, URLs, and snippets.";
  readonly parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: {
        type: "integer",
        description: "Results (1-10)",
        minimum: 1,
        maximum: 10,
      },
    },
    required: ["query"],
  };

  private apiKey: string;
  private maxResults: number;

  constructor(params?: { apiKey?: string; maxResults?: number }) {
    super();
    this.apiKey = params?.apiKey ?? process.env.BRAVE_API_KEY ?? "";
    this.maxResults = params?.maxResults ?? 5;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query);
    const count = Math.min(
      Math.max(args.count ? Number(args.count) : this.maxResults, 1),
      10,
    );

    if (!this.apiKey) {
      return "Error: BRAVE_API_KEY not configured";
    }

    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));

      const resp = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": this.apiKey,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        return `Error: Search API returned ${resp.status}`;
      }

      const data = (await resp.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };
      const results = data.web?.results ?? [];

      if (results.length === 0) {
        return `No results for: ${query}`;
      }

      const lines = [`Results for: ${query}\n`];
      for (let i = 0; i < Math.min(results.length, count); i++) {
        const item = results[i];
        lines.push(`${i + 1}. ${item.title ?? ""}\n   ${item.url ?? ""}`);
        if (item.description) {
          lines.push(`   ${item.description}`);
        }
      }
      return lines.join("\n");
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : err}`;
    }
  }
}

/** Fetch and extract content from a URL. */
export class WebFetchTool extends Tool {
  readonly name = "web_fetch";
  readonly description =
    "Fetch URL and extract readable content (HTML -> markdown/text).";
  readonly parameters = {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      extractMode: {
        type: "string",
        enum: ["markdown", "text"],
        description: "Extract mode",
      },
      maxChars: { type: "integer", minimum: 100 },
    },
    required: ["url"],
  };

  private defaultMaxChars: number;

  constructor(params?: { maxChars?: number }) {
    super();
    this.defaultMaxChars = params?.maxChars ?? 50000;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url);
    const extractMode = String(args.extractMode ?? "markdown");
    const maxChars = args.maxChars
      ? Number(args.maxChars)
      : this.defaultMaxChars;

    const { valid, error: validationError } = validateUrl(url);
    if (!valid) {
      return JSON.stringify({
        error: `URL validation failed: ${validationError}`,
        url,
      });
    }

    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        return JSON.stringify({
          error: `HTTP ${resp.status}`,
          url,
        });
      }

      const contentType = resp.headers.get("content-type") ?? "";
      const body = await resp.text();
      let text: string;
      let extractor: string;

      if (contentType.includes("application/json")) {
        try {
          text = JSON.stringify(JSON.parse(body), null, 2);
        } catch {
          text = body;
        }
        extractor = "json";
      } else if (
        contentType.includes("text/html") ||
        body.slice(0, 256).toLowerCase().startsWith("<!doctype") ||
        body.slice(0, 256).toLowerCase().startsWith("<html")
      ) {
        // Extract readable content from HTML
        text =
          extractMode === "markdown"
            ? htmlToMarkdown(body)
            : stripTags(body);
        extractor = "html";
      } else {
        text = body;
        extractor = "raw";
      }

      const truncated = text.length > maxChars;
      if (truncated) {
        text = text.slice(0, maxChars);
      }

      return JSON.stringify({
        url,
        finalUrl: resp.url,
        status: resp.status,
        extractor,
        truncated,
        length: text.length,
        text,
      });
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        url,
      });
    }
  }
}
