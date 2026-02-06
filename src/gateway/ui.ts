/** Inline HTML for the nanobot control UI. */
export function getControlHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>nanobot</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --surface: #141414; --border: #262626;
    --text: #e5e5e5; --text-muted: #737373; --accent: #3b82f6;
    --accent-hover: #2563eb; --user-bg: #1e3a5f; --bot-bg: #1a1a1a;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg); color: var(--text);
    height: 100vh; display: flex; flex-direction: column;
  }
  header {
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
    background: var(--surface);
  }
  header .logo { font-size: 20px; }
  header h1 { font-size: 15px; font-weight: 600; }
  header .status {
    margin-left: auto; font-size: 12px; color: var(--text-muted);
    display: flex; align-items: center; gap: 6px;
  }
  header .status .dot {
    width: 7px; height: 7px; border-radius: 50%; background: #22c55e;
  }
  #messages {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .msg {
    max-width: 720px; padding: 10px 14px; border-radius: 10px;
    font-size: 14px; line-height: 1.55; white-space: pre-wrap;
    word-wrap: break-word;
  }
  .msg.user {
    align-self: flex-end; background: var(--user-bg);
    border-bottom-right-radius: 3px;
  }
  .msg.bot {
    align-self: flex-start; background: var(--bot-bg);
    border: 1px solid var(--border); border-bottom-left-radius: 3px;
  }
  .msg.bot.thinking {
    color: var(--text-muted); font-style: italic;
  }
  .msg.error {
    align-self: flex-start; background: #2d1111;
    border: 1px solid #5c2020; color: #f87171;
  }
  .msg.tool-call {
    align-self: flex-start; background: #0f1a2e;
    border: 1px solid #1e3a5f; border-radius: 6px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px; color: var(--text-muted); padding: 8px 12px;
  }
  .msg.tool-call .tool-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #3b82f6; margin-bottom: 4px; font-family: inherit;
  }
  .msg.tool-call .tool-name {
    color: #60a5fa; font-weight: 600;
  }
  .msg.tool-call .tool-args {
    color: #525252; margin-top: 2px; font-size: 11px;
    max-height: 80px; overflow: hidden; text-overflow: ellipsis;
  }
  .msg.tool-result {
    align-self: flex-start; background: #0a1a0a;
    border: 1px solid #1a3a1a; border-radius: 6px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px; color: var(--text-muted); padding: 8px 12px;
  }
  .msg.tool-result .tool-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #22c55e; margin-bottom: 4px; font-family: inherit;
  }
  .msg.tool-result .tool-result-name {
    color: #4ade80; font-weight: 600;
  }
  .msg.tool-result .tool-output {
    color: #737373; margin-top: 2px; font-size: 11px;
    max-height: 120px; overflow-y: auto;
  }
  #input-area {
    padding: 12px 16px; border-top: 1px solid var(--border);
    background: var(--surface); display: flex; gap: 8px;
  }
  #input-area textarea {
    flex: 1; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; font-size: 14px; font-family: inherit;
    resize: none; outline: none; min-height: 42px; max-height: 120px;
  }
  #input-area textarea:focus { border-color: var(--accent); }
  #input-area button {
    background: var(--accent); color: #fff; border: none;
    border-radius: 8px; padding: 0 18px; font-size: 14px;
    font-weight: 500; cursor: pointer; white-space: nowrap;
  }
  #input-area button:hover { background: var(--accent-hover); }
  #input-area button:disabled {
    opacity: 0.5; cursor: not-allowed;
  }
</style>
</head>
<body>
  <header>
    <span class="logo">&#x1F408;</span>
    <h1>nanobot</h1>
    <div class="status"><span class="dot"></span> online</div>
  </header>
  <div id="messages"></div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Type a message..." autofocus></textarea>
    <button id="send">Send</button>
  </div>

<script>
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
let busy = false;

function addMessage(text, cls) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function addToolCall(name, args) {
  const div = document.createElement("div");
  div.className = "msg tool-call";
  const label = document.createElement("div");
  label.className = "tool-label";
  label.textContent = "tool call";
  const nameEl = document.createElement("div");
  nameEl.className = "tool-name";
  nameEl.textContent = name;
  div.appendChild(label);
  div.appendChild(nameEl);
  if (args) {
    const argsEl = document.createElement("div");
    argsEl.className = "tool-args";
    try {
      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      argsEl.textContent = JSON.stringify(parsed, null, 2);
    } catch {
      argsEl.textContent = String(args);
    }
    div.appendChild(argsEl);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addToolResult(name, output) {
  const div = document.createElement("div");
  div.className = "msg tool-result";
  const label = document.createElement("div");
  label.className = "tool-label";
  label.textContent = "result";
  div.appendChild(label);
  if (name) {
    const nameEl = document.createElement("div");
    nameEl.className = "tool-result-name";
    nameEl.textContent = name;
    div.appendChild(nameEl);
  }
  if (output) {
    const outEl = document.createElement("div");
    outEl.className = "tool-output";
    outEl.textContent = output.length > 500 ? output.slice(0, 500) + "..." : output;
    div.appendChild(outEl);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;
  busy = true;
  sendBtn.disabled = true;
  inputEl.value = "";
  inputEl.style.height = "auto";

  addMessage(text, "user");
  const thinkingEl = addMessage("Thinking...", "bot thinking");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    thinkingEl.remove();
    // Render tool calls and results from this turn before the final response
    if (data.turn) {
      for (const step of data.turn) {
        if (step.type === "tool_call") {
          addToolCall(step.name, step.arguments);
        } else if (step.type === "tool_result") {
          addToolResult(step.name, step.output);
        }
        // Skip "text" entries — we render the final response below
      }
    }
    addMessage(data.response, "bot");
  } catch (err) {
    thinkingEl.remove();
    addMessage("Error: " + err.message, "error");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", send);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

// Load previous messages on page load
(async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    if (!res.ok) return;
    const data = await res.json();
    for (const msg of data.messages || []) {
      if (msg.role === "user") {
        addMessage(msg.content, "user");
      } else if (msg.role === "assistant") {
        // Render tool calls if present
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            addToolCall(tc.name, tc.arguments);
          }
        }
        // Render text content if present
        if (msg.content) {
          addMessage(msg.content, "bot");
        }
      } else if (msg.role === "tool") {
        addToolResult(msg.tool_name, msg.content);
      }
    }
  } catch (e) {
    // silently ignore — history is optional
  }
})();

// SSE — receive real-time pushed messages (cron results, etc.)
(function connectSSE() {
  const evtSource = new EventSource("/api/events");
  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "message") {
        const cls = data.role === "user" ? "user" : "bot";
        addMessage(data.content, cls);
      } else if (data.type === "tool_call") {
        addToolCall(data.name, data.arguments);
      } else if (data.type === "tool_result") {
        addToolResult(data.name, data.output);
      }
    } catch {
      // ignore malformed events
    }
  };
  evtSource.onerror = () => {
    // EventSource auto-reconnects, nothing to do
  };
})();
</script>
</body>
</html>`;
}
