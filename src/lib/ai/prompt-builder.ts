// Build the system + user prompts for text and image generation.
//
// PROMPT_VERSION is stamped onto every generated post so future model drift
// is forensically diffable. Bump it whenever the prompt changes.

import type {
  BuildPromptContext,
  GeneratedCaption,
  SceneOutline,
} from "./types";
import { imageCountForPlan } from "./aspect-resolver";

export const PROMPT_VERSION = process.env.OPENAI_PROMPT_VERSION || "2026-05-13.v1";

const HALLUCINATION_RULES = `
Hard rules — violating any of these fails the generation:

- Do not invent numbers, statistics, or percentages of any kind. No "73% of founders", no "3 out of 4 businesses", no "average revenue $X".
- Do not invent customer names, testimonials, reviews, or quotes.
- Do not invent dates, named events, named studies, or named conferences.
- Do not write phrases like "studies show", "research proves", "according to", "experts agree", "data shows", "X% of Y".
- Do not invent specific dollar amounts or revenue figures.
- Do not make claims about identifiable real people unless their name appears in the input.
- Do not include real-looking company logos or brand wordmarks in image briefs unless the operator explicitly named the brand in their style prompt.
- If the operator did not provide a stat, quote, customer name, or date, write the caption without one. Talk about the idea, not fabricated proof.
`.trim();

function brandSummary(ctx: BuildPromptContext): string {
  const b = ctx.brand?.data;
  if (!b) return "No brand playbook loaded — use a polished, personal luxury-travel voice.";
  const lines: string[] = [];
  if (b.tagline) lines.push(`Tagline: ${b.tagline}`);
  if (b.brandVoice) lines.push(`Brand voice: ${b.brandVoice}`);
  if (b.contentPillars?.length) lines.push(`Content pillars: ${b.contentPillars.join(", ")}`);
  if (b.doFocus?.length) lines.push(`Focus on: ${b.doFocus.join(", ")}`);
  if (b.doAvoid?.length) lines.push(`Avoid: ${b.doAvoid.join(", ")}`);
  const coreTags = b.hashtagCore?.length ? b.hashtagCore.join(" ") : "";
  if (coreTags) lines.push(`Core hashtags (always include a few): ${coreTags}`);
  const hooks = b.hooks?.length ? b.hooks.slice(0, 5).join(" | ") : "";
  if (hooks) lines.push(`Hook patterns we like: ${hooks}`);
  const ctas = b.ctas?.length ? b.ctas.slice(0, 5).join(" | ") : "";
  if (ctas) lines.push(`CTA patterns we like: ${ctas}`);
  return lines.join("\n");
}

function recentPostSummary(ctx: BuildPromptContext): string {
  if (!ctx.recentPosts.length) return "(no recent posts in this workspace yet)";
  return ctx.recentPosts
    .slice(0, 10)
    .map((p, i) => {
      const hook = (p.hook || "").trim();
      const title = (p.title || "").trim();
      return `${i + 1}. ${title}${hook ? ` — hook: "${hook.slice(0, 120)}"` : ""}`;
    })
    .join("\n");
}

export function buildTextSystem(ctx: BuildPromptContext): string {
  const role = ctx.reviseFromPost ? "revise an existing draft" : "create a new draft";
  const imageCount = imageCountForPlan(
    (ctx.plan.format || "single") as never,
    (ctx.plan.media_type || "image") as never,
    ctx.plan.slides_count ?? null,
  );

  return [
    `You are the in-house social-media copywriter for The Reach, a high-touch luxury travel planning brand. Your job right now is to ${role} for one row of the operator's content plan.`,
    "",
    "Brand context:",
    brandSummary(ctx),
    "",
    "Recent posts in this workspace (avoid repeating these exact hooks or angles):",
    recentPostSummary(ctx),
    "",
    HALLUCINATION_RULES,
    "",
    "Output strictly conforms to the JSON schema you are given. Notes on specific fields:",
    "- title: a short internal name (under 80 chars), not a hashtag-y headline.",
    "- hook: the first line a reader sees in feed. Punchy. Not a question stack.",
    "- caption: the body copy. Tone matches the brand voice. No emoji unless the operator's style prompt asks for them.",
    "- cta: one clear next step. Match the operator's notes/CTA hint if provided.",
    "- hashtags: 4–10 entries, no # prefix in the items — the renderer adds them. Mix core brand tags with topical tags. No banned words.",
    `- scene_outline: exactly ${imageCount} entries. Each entry describes ONE image. The 'shot' is what the picture shows; 'on_screen_text' is the literal text to render in the picture (empty string if no text). Indexes start at 1.`,
    "- visual_brief: 2–4 sentences describing the overall visual treatment, palette, lighting, and what to avoid (e.g. no people, no real logos).",
    "- approval_notes: 1–2 sentences telling the human reviewer the *intent* of the post and what to check.",
    "- quality_score: your honest self-assessment 1–10.",
    "- source_notes: empty array unless the operator's input explicitly cited a source/URL — in which case echo it back as a string.",
  ].join("\n");
}

export function buildTextUser(ctx: BuildPromptContext): string {
  const p = ctx.plan;
  const lines: string[] = [];
  if (ctx.reviseFromPost && ctx.reviewerNotes) {
    lines.push("REVISION MODE — keep the topic, fix the issues the reviewer flagged.");
    lines.push("Original draft:");
    lines.push(`- title: ${ctx.reviseFromPost.title}`);
    lines.push(`- hook: ${ctx.reviseFromPost.hook || "(none)"}`);
    lines.push(`- caption: ${ctx.reviseFromPost.caption || "(none)"}`);
    lines.push(`- cta: ${ctx.reviseFromPost.cta || "(none)"}`);
    lines.push(`- hashtags: ${(ctx.reviseFromPost.hashtags || []).join(", ") || "(none)"}`);
    lines.push("");
    lines.push("Reviewer notes (address every point):");
    lines.push(ctx.reviewerNotes);
    lines.push("");
  } else {
    lines.push("NEW DRAFT MODE.");
  }
  lines.push("Operator inputs for this row:");
  lines.push(`- scheduled date: ${p.scheduled_date || "(unset)"}`);
  lines.push(`- platforms: ${(p.platforms || []).join(", ") || "(unset)"}`);
  lines.push(`- media type: ${p.media_type || "image"}`);
  lines.push(`- format: ${p.format || "single"}`);
  lines.push(`- aspect ratio (resolved): ${ctx.resolved.ratio} (${ctx.resolved.width}×${ctx.resolved.height})`);
  if (p.slides_count) lines.push(`- slides count: ${p.slides_count}`);
  if (p.feel) lines.push(`- feel: ${p.feel}`);
  if (p.visual_style) lines.push(`- visual style: ${p.visual_style}`);
  if (p.style_prompt) lines.push(`- style prompt: ${p.style_prompt}`);
  if (p.topic) lines.push(`- topic: ${p.topic}`);
  if (p.notes) lines.push(`- notes/constraints: ${p.notes}`);
  lines.push("");
  lines.push("Return the JSON object now.");
  return lines.join("\n");
}

export function buildImagePrompts(
  ctx: BuildPromptContext,
  outline: SceneOutline[],
): string[] {
  const p = ctx.plan;
  const visualBriefRoot = ctx.reviseFromPost?.visual_brief || "";
  const sharedSuffix = [
    p.style_prompt ? `Style: ${p.style_prompt}.` : "",
    p.visual_style ? `Visual treatment: ${p.visual_style}.` : "",
    `Aspect ratio target: ${ctx.resolved.ratio} (${ctx.resolved.width}×${ctx.resolved.height}). Compose subjects safely inside this frame; expect a center crop.`,
    "Do not render any recognizable real person's face. Do not render a real brand logo or wordmark.",
  ]
    .filter(Boolean)
    .join(" ");

  return outline.map((scene) => {
    const text = scene.on_screen_text && scene.on_screen_text.trim().length > 0
      ? ` Include the on-image text exactly: "${scene.on_screen_text.replace(/"/g, '\\"')}".`
      : " No text overlay.";
    const briefPrefix = visualBriefRoot
      ? `Overall visual brief: ${visualBriefRoot}. `
      : "";
    return `${briefPrefix}Scene ${scene.index}: ${scene.shot}.${text} ${sharedSuffix}`.trim();
  });
}

/**
 * JSON Schema for the text generation. Keep strict.
 */
export function generatedCaptionSchema(imageCount: number): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "hook",
      "caption",
      "cta",
      "hashtags",
      "approval_notes",
      "quality_score",
      "visual_brief",
      "scene_outline",
      "source_notes",
    ],
    properties: {
      title: { type: "string", maxLength: 120 },
      hook: { type: "string", maxLength: 280 },
      caption: { type: "string" },
      cta: { type: "string" },
      hashtags: {
        type: "array",
        items: { type: "string", maxLength: 60 },
        minItems: 0,
        maxItems: 15,
      },
      approval_notes: { type: "string" },
      quality_score: { type: "integer", minimum: 1, maximum: 10 },
      visual_brief: { type: "string" },
      scene_outline: {
        type: "array",
        minItems: imageCount,
        maxItems: imageCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "shot", "on_screen_text", "voiceover"],
          properties: {
            index: { type: "integer", minimum: 1, maximum: 20 },
            shot: { type: "string" },
            on_screen_text: { type: "string" },
            voiceover: { type: "string" },
          },
        },
      },
      source_notes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

/** Normalize a parsed generation result and reject obvious schema slop. */
export function normalizeGeneration(raw: GeneratedCaption): GeneratedCaption {
  return {
    ...raw,
    hashtags: (raw.hashtags || []).map((h) => h.replace(/^#+/, "").trim()).filter(Boolean),
    source_notes: raw.source_notes || [],
    scene_outline: (raw.scene_outline || []).map((s, idx) => ({
      index: s.index || idx + 1,
      shot: s.shot || "",
      on_screen_text: s.on_screen_text || "",
      voiceover: s.voiceover || "",
    })),
  };
}
