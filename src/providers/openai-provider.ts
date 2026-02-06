import OpenAI from "openai";
import type {
  LLMProvider,
  LLMResponse,
  ToolCallRequest,
  ToolDefinition,
  ChatMessage,
} from "./base.js";

/**
 * LLM provider using the OpenAI SDK.
 *
 * Works with OpenAI, OpenRouter, Anthropic (via proxy), and any
 * OpenAI-compatible API by setting apiBase.
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(params: {
    apiKey: string;
    apiBase?: string | null;
    defaultModel?: string;
  }) {
    this.client = new OpenAI({
      apiKey: params.apiKey,
      baseURL: params.apiBase ?? undefined,
    });
    this.defaultModel = params.defaultModel ?? "anthropic/claude-sonnet-4-20250514";
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async chat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    model?: string;
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const model = params.model ?? this.defaultModel;

    const requestParams: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: params.messages as OpenAI.ChatCompletionMessageParam[],
      max_tokens: params.maxTokens ?? 8192,
    };

    if (params.tools && params.tools.length > 0) {
      requestParams.tools =
        params.tools as OpenAI.ChatCompletionTool[];
    }

    const response = await this.client.chat.completions.create(requestParams);

    const choice = response.choices[0];
    if (!choice) {
      return {
        content: null,
        toolCalls: [],
        hasToolCalls: false,
      };
    }

    const message = choice.message;
    const toolCalls: ToolCallRequest[] = [];

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // If JSON parse fails, wrap raw string
          args = { _raw: tc.function.arguments };
        }

        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    return {
      content: message.content ?? null,
      toolCalls,
      hasToolCalls: toolCalls.length > 0,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}
