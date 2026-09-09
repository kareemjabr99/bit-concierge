import { redact } from './redact.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  /** Injected in tests. Defaults to stdout. */
  write?: (line: string) => void;
}

/**
 * Structured JSON logger. Everything passes through redact() on the way out —
 * that is the whole reason this is hand-rolled rather than a library: there is
 * exactly one write path and it cannot be bypassed by accident.
 */
export const createLogger = (options: LoggerOptions = {}): Logger => {
  const level = options.level ?? 'info';
  const bindings = options.bindings ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (entry: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (RANK[entry] < RANK[level]) return;
    const payload = {
      level: entry,
      time: new Date().toISOString(),
      msg: redact(message),
      ...(redact(bindings) as Record<string, unknown>),
      ...((fields ? redact(fields) : {}) as Record<string, unknown>),
    };
    write(JSON.stringify(payload));
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) =>
      createLogger({
        level,
        bindings: { ...bindings, ...extra },
        ...(options.write ? { write: options.write } : {}),
      }),
  };
};
