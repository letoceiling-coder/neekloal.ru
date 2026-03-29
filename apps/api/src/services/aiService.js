"use strict";

/**
 * Ollama /api/generate с подсчётом токенов (prompt_eval_count / eval_count).
 * @param {string} model
 * @param {string} prompt
 * @returns {Promise<{ text: string; promptTokens: number; completionTokens: number; totalTokens: number }>}
 */
async function generateTextWithUsage(model, prompt) {
  const base = process.env.OLLAMA_URL;
  if (!base) {
    throw new Error("OLLAMA_URL is not set");
  }
  const url = `${base.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const text = data.response != null ? String(data.response) : "";
  const promptTokens = Number(data.prompt_eval_count) || 0;
  const completionTokens = Number(data.eval_count) || 0;
  const totalTokens = promptTokens + completionTokens;
  return { text, promptTokens, completionTokens, totalTokens };
}

/**
 * Единая точка вызова Ollama generate (как в agentV2 / chat).
 * @param {string} model
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function generateText(model, prompt) {
  const { text } = await generateTextWithUsage(model, prompt);
  return text;
}

module.exports = { generateText, generateTextWithUsage };
