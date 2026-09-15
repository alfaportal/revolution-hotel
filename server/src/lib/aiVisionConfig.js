const { trimEnv } = require("./env");

function getAnthropicVisionConfig() {
  const apiKey = trimEnv("ANTHROPIC_API_KEY");
  return {
    ready: !!apiKey,
    apiKey,
    model:
      trimEnv("ANTHROPIC_VISION_MODEL") ||
      trimEnv("ANTHROPIC_MODEL") ||
      "claude-sonnet-4-6",
    maxTokens: Math.min(
      8192,
      Math.max(512, Number(process.env.AI_SCAN_MAX_TOKENS) || 4096),
    ),
  };
}

module.exports = { getAnthropicVisionConfig };
