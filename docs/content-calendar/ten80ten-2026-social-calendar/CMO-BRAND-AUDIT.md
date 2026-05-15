# CMO Brand Audit

Verdict: the first generated calendar was not client-ready. It was strategically useful, but the visual system used placeholder navy/teal colors, several hooks repeated too often, and the captions leaned educational before they built enough commercial confidence.

This rebuild aligns the production system to `Ten80Ten_Full_Brand_Guidelines_A4.pdf` and treats every post as a buyer-confidence asset, not just a content slot.

## Brand Corrections Applied

- Replaced placeholder navy/teal with the official system: Core Charcoal `#1B1713`, Hourglass Orange `#FF6426`, Delegation Gold `#C9BC72`, Protected Silver `#B8B7B2`, Warm Cream `#F7F2E8`, and Soft Graphite `#2C2925`.
- Rewrote image prompts around the PDF's visual language: light editorial base, controlled charcoal contrast, orange as the action cue, gold dividers, silver protected-core details, diagonal hourglass-transfer accents, rounded cards, and simple arrows.
- Added logo-safe space to every image prompt. The supplied Ten80Ten hourglass mark should be placed after generation; prompts do not ask the model to recreate the wordmark.
- Reframed captions around the brand message pattern: problem -> relief -> trust signal -> clear CTA.
- Added managed-fit trust signals across captions: screening, onboarding, login management, time tracking, e-timesheets, monitoring, and the 6-month Perfect Hire Guarantee where commercially relevant.
- Replaced soft CTAs with message/click behavior: Message PLAYBOOK, Message INBOX, Message ROLE, Message COVERAGE, and Start Hiring.

## CMO Judgment

Are these stronger for client acquisition now? Yes, materially. The posts now sell the feeling Ten80Ten needs to own: calm operating relief with proof that the handoff is managed, not risky.

The best-performing concepts should be Pillar B founder-reality posts and Pillar D ROI posts. They name the buyer's pain in plain language, then connect it to time back, managed support, and a low-friction next step.

The visual prompts are also more ownable now. A founder scrolling past cream, charcoal, orange, gold, and silver posts with diagonal transfer cues should start to recognize Ten80Ten before seeing the logo.

## Production Guardrails

- Do not let GPT-Image-2 generate the Ten80Ten wordmark. Add the supplied logo or standalone hourglass mark in post-production.
- Keep orange sparse. It should guide the eye to the action, not fill the background.
- Keep photography professional and optimistic. Founder pain can be real, but the final frame should imply relief and control.
- Do not crop out the logo-safe space when resizing to 9:16.
- For carousels, use the same cream base, charcoal type, orange action arrow, gold divider, and silver core triangle across every slide.

## QC Snapshot

- Total posts: 396
- Unique hooks: 396
- Unique LinkedIn openers: 396
- Image prompts: 80-180 words, official colors only, hourglass orange present in every prompt.
- Captions: LinkedIn 800-1,500 chars, Instagram 90-200 words, Facebook 50-120 words, TikTok 100-150 chars.
