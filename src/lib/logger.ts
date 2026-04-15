export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  route?: string;
  correlation_id?: string;
  user_id?: string;
  workspace_id?: string;
  [key: string]: unknown;
};

function emit(level: LogLevel, message: string, fields: LogFields = {}) {
  const line = {
    level,
    message,
    ts: new Date().toISOString(),
    ...fields,
  };
  const out = JSON.stringify(line);

  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

export function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
