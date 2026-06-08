// One-way Telegram notification for the Support Center.
//
// Telegram is a NOTIFICATION CHANNEL ONLY. The system pings Aldridge when a
// ticket or chat message arrives; he answers inside the web app's Support
// Inbox. Nothing flows back from Telegram into the system — there is no
// webhook and no inbound handler — so a reply can never be misrouted.
//
// Failures are swallowed: a ticket or message must never fail because
// Telegram is unreachable. Callers run this only after the DB write (and,
// for tickets, the email) have already succeeded.

const TELEGRAM_TIMEOUT_MS = 8000;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID);
}

/** Escape a value for Telegram's HTML parse mode. */
export function tgEscape(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface TelegramPingArgs {
  /** Pre-escaped HTML (use tgEscape on any dynamic content). */
  text: string;
  /** Absolute https URL the "Open in portal" button points to. */
  threadUrl: string;
  buttonLabel?: string;
  chatId?: string;
}

/**
 * Send a one-way notification to the configured admin Telegram chat.
 * Returns true on success, false on any failure (logged, never thrown).
 */
export async function pingTelegram(args: TelegramPingArgs): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = args.chatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    // Not configured. Email remains the backstop notification for tickets.
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const isHttps = /^https:\/\//i.test(args.threadUrl);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: args.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        // Telegram rejects inline-button URLs that are not http(s). Omit the
        // button rather than fail the whole message if the URL looks wrong.
        ...(isHttps
          ? {
              reply_markup: {
                inline_keyboard: [
                  [{ text: args.buttonLabel || "Open in portal", url: args.threadUrl }],
                ],
              },
            }
          : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[support/telegram] sendMessage ${res.status}: ${detail.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[support/telegram] ping failed:", message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
