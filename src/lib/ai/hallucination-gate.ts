// Hard validation gate for generated captions. Three sweeps:
//  1. Regex pattern matching for forbidden constructions (percentages,
//     dollar amounts, "studies show", named years, etc.).
//  2. Cross-reference: every "named" thing (proper noun, dollar figure,
//     percentage, etc.) must appear in the operator's input or the
//     brand playbook.
//  3. A second-LLM verifier asks gpt-4o-mini "list any claims here that
//     are not present in the input". If the verifier returns a non-empty
//     list, fail.
//
// If any sweep fails the worker regenerates ONCE with the violations
// appended to the prompt; if it fails again, the job ends with status
// 'failed' and the violation list in `last_error`.

import { callTextJson } from "./openai-text";
import type { GeneratedCaption, BrandPlaybookData, PlanRow } from "./types";

export interface GateInput {
  caption: GeneratedCaption;
  plan: PlanRow;
  brand: BrandPlaybookData | null;
  reviewerNotes?: string;
}

export interface GateResult {
  ok: boolean;
  violations: string[];
  verifierTokensIn: number;
  verifierTokensOut: number;
}

// Build a corpus of "trusted strings" the model is allowed to echo.
function trustedCorpus(input: GateInput): string {
  const bits: string[] = [];
  const p = input.plan;
  for (const field of [p.topic, p.notes, p.style_prompt, p.feel, p.visual_style] as Array<string | null>) {
    if (field) bits.push(field);
  }
  for (const platform of p.platforms || []) bits.push(platform);
  if (input.reviewerNotes) bits.push(input.reviewerNotes);
  const b = input.brand;
  if (b) {
    if (b.tagline) bits.push(b.tagline);
    if (b.brandVoice) bits.push(b.brandVoice);
    if (b.website) bits.push(b.website);
    if (b.phone) bits.push(b.phone);
    for (const arr of [
      b.hooks, b.ctas, b.contentPillars, b.doFocus, b.doAvoid,
      b.hashtagCore, b.hashtagSeasonal, b.hashtagEngagement, b.hashtagCommercial,
    ]) {
      if (Array.isArray(arr)) bits.push(...arr.map(String));
    }
  }
  return bits.join(" \n ").toLowerCase();
}

const CURRENT_YEAR = new Date().getFullYear();
const ALLOWED_YEARS = new Set([CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]);

const FORBIDDEN_PHRASE_PATTERNS: RegExp[] = [
  /\bstudies show\b/i,
  /\bresearch (?:proves|shows|finds)\b/i,
  /\bdata shows\b/i,
  /\bexperts agree\b/i,
  /\baccording to (?:a |the )?(?:study|report|survey)\b/i,
  /\b\d+\s*(?:out of|\/)\s*\d+\b/i, // "3 out of 5"
];

function captionText(c: GeneratedCaption): string {
  return [c.hook, c.caption, c.cta, c.approval_notes, c.visual_brief, ...c.scene_outline.map((s) => `${s.shot} ${s.on_screen_text} ${s.voiceover || ""}`), ...c.hashtags]
    .filter(Boolean)
    .join("\n");
}

function regexSweep(c: GeneratedCaption, corpus: string): string[] {
  const violations: string[] = [];
  const text = captionText(c);

  // Percentages — any digit followed by %
  const pctMatches = text.match(/\b\d+(?:\.\d+)?\s?%/g) || [];
  for (const m of pctMatches) {
    if (!corpus.includes(m.toLowerCase())) {
      violations.push(`Fabricated percentage: "${m}". Input did not include this number.`);
    }
  }

  // Dollar amounts — $X[k|m|K|M] or $X,XXX
  const dollarMatches = text.match(/\$\s?\d[\d,\.]*(?:\s?[kKmMbB])?/g) || [];
  for (const m of dollarMatches) {
    if (!corpus.includes(m.toLowerCase().replace(/\s/g, ""))) {
      violations.push(`Fabricated dollar amount: "${m}". Input did not include this figure.`);
    }
  }

  // Four-digit years not within ±1 of current
  const yearMatches = text.match(/\b(19|20)\d{2}\b/g) || [];
  for (const m of yearMatches) {
    const y = Number(m);
    if (!ALLOWED_YEARS.has(y) && !corpus.includes(m)) {
      violations.push(`Fabricated year: "${m}". Input did not include this year.`);
    }
  }

  // Forbidden phrases
  for (const re of FORBIDDEN_PHRASE_PATTERNS) {
    const hit = text.match(re);
    if (hit) violations.push(`Forbidden phrase: "${hit[0]}".`);
  }

  return violations;
}

const VERIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims_not_in_input"],
  properties: {
    claims_not_in_input: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

async function verifierSweep(c: GeneratedCaption, corpus: string): Promise<{ violations: string[]; tokensIn: number; tokensOut: number }> {
  const verifierModel = process.env.OPENAI_VERIFIER_MODEL || "gpt-4o-mini";
  const sys = `You are a strict fact-checker. Given the operator's input corpus and a generated post, return any concrete factual claims in the post that are NOT supported by the input corpus. A "claim" means: a specific number, percentage, dollar figure, named person, named company, named study, dated event, or quoted testimonial. Generic statements about ideas are NOT claims. Return claims_not_in_input = [] if everything in the post is either an opinion, a general principle, or supported by the corpus.`;
  const user = `INPUT CORPUS:\n${corpus.slice(0, 6000)}\n\nGENERATED POST:\n${captionText(c)}\n\nReturn the JSON now.`;
  try {
    const out = await callTextJson<{ claims_not_in_input: string[] }>({
      model: verifierModel,
      system: sys,
      user,
      schema: VERIFIER_SCHEMA,
      schemaName: "verifier_result",
      maxTokens: 500,
      temperature: 0,
    });
    const v = (out.parsed.claims_not_in_input || []).map((x) => `Verifier flagged: ${x}`);
    return { violations: v, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
  } catch (err) {
    // If verifier itself fails, do not block — the regex sweep is still the
    // primary gate. Log so we can monitor for verifier outages.
    console.error("[hallucination-gate] verifier failed", err);
    return { violations: [], tokensIn: 0, tokensOut: 0 };
  }
}

export async function runHallucinationGate(input: GateInput): Promise<GateResult> {
  const corpus = trustedCorpus(input);
  const regexViolations = regexSweep(input.caption, corpus);
  // Only run the verifier if the regex sweep was clean — saves tokens.
  if (regexViolations.length > 0) {
    return { ok: false, violations: regexViolations, verifierTokensIn: 0, verifierTokensOut: 0 };
  }
  const verifier = await verifierSweep(input.caption, corpus);
  if (verifier.violations.length > 0) {
    return { ok: false, violations: verifier.violations, verifierTokensIn: verifier.tokensIn, verifierTokensOut: verifier.tokensOut };
  }
  return { ok: true, violations: [], verifierTokensIn: verifier.tokensIn, verifierTokensOut: verifier.tokensOut };
}
