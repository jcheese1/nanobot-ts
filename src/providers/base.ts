/** Tool call request from the LLM. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Response from an LLM chat call. */
export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  hasToolCalls: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Tool definition for the LLM. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Message in the LLM conversation. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Abstract LLM provider interface. */
export interface LLMProvider {
  /** Send a chat request to the LLM. */
  chat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    model?: string;
    maxTokens?: number;
  }): Promise<LLMResponse>;

  /** Get the default model name. */
  getDefaultModel(): string;
}
