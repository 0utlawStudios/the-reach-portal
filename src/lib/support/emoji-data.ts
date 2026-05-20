// Curated emoji set for the support composer's Quick picker. Plain Unicode
// strings rendered in the system font — no image assets, ~80 of the most
// commonly used emojis in a sensible visual order.

export const QUICK_EMOJIS: readonly string[] = [
  // Smileys & emotion
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "🙃",
  "😉", "😊", "😇", "🥰", "😍", "😘", "😋", "😛", "😜", "🤪",
  "🤔", "🤨", "🧐", "🤓", "😎", "🥳", "🙄", "😏", "😒", "😔",
  "😟", "🙁", "😣", "😩", "🥺", "😢", "😭", "😤", "😠", "😡",
  "🤯", "😳", "😱", "🤗",
  // Gestures & people
  "👍", "👎", "👌", "✌️", "🤞", "🤙", "🤝", "👏", "🙌", "🙏",
  "💪", "👋", "🫶", "🫡", "👀", "🧠",
  // Hearts & symbols
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "💯", "🔥",
  "⭐", "✨", "🎉", "🎊", "✅", "❌", "⚠️", "❓", "❗", "💡",
];

/**
 * Compute the recents list after an emoji is picked: most-recent first,
 * de-duplicated, capped. Pure — unit-tested.
 */
export function nextRecents(prev: readonly string[], emoji: string, max = 16): string[] {
  return [emoji, ...prev.filter((e) => e !== emoji)].slice(0, max);
}
