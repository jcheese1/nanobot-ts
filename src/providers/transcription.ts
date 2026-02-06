import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

/**
 * Voice transcription provider using Groq's Whisper API.
 * Groq offers extremely fast transcription with a generous free tier.
 */
export class GroqTranscriptionProvider {
  private apiKey: string;
  private apiUrl = "https://api.groq.com/openai/v1/audio/transcriptions";

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.GROQ_API_KEY ?? "";
  }

  async transcribe(filePath: string): Promise<string> {
    if (!this.apiKey) {
      console.warn("Groq API key not configured for transcription");
      return "";
    }

    if (!existsSync(filePath)) {
      console.error(`Audio file not found: ${filePath}`);
      return "";
    }

    try {
      const fileData = readFileSync(filePath);
      const blob = new Blob([fileData]);
      const form = new FormData();
      form.append("file", blob, basename(filePath));
      form.append("model", "whisper-large-v3");

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      const data = (await response.json()) as { text?: string };
      return data.text ?? "";
    } catch (err) {
      console.error("Groq transcription error:", err);
      return "";
    }
  }
}
