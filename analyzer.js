/**
 * analyzer.js — Optional AI chart commentary (INFORMATIONAL ONLY).
 *
 * This module never places trades. All trading is handled mechanically by the
 * swing-fractal strategy in scanner.js. This just lets users ask cajh to "read"
 * a chart image (e.g. `@cajh analyze that`).
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = "claude-sonnet-4-6";

/** Post a short, plain-language read of a single chart image. No trade is placed. */
export async function analyzeChart(base64, mediaType, channel) {
  try {
    const img = { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system:
        `You are cajh, a concise technical-analysis assistant in a Discord server.\n` +
        `Give a short, plain-language read of the chart: trend, key levels, and notable\n` +
        `structure. This is commentary only — do NOT give buy/sell calls or position sizing.`,
      messages: [{ role: "user", content: [img, { type: "text", text: "Give a short read of this chart." }] }]
    });

    const text = res.content[0]?.text ?? "No response.";
    await channel.send(`🔎 **Chart read**\n\n${text.slice(0, 1900)}`);

  } catch (err) {
    console.error("[ANALYZER] Chart read failed:", err.message);
    await channel.send("⚠️ Couldn't read that chart.");
  }
}
