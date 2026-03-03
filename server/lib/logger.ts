function fmt(level: string, message: string, fields?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    message,
    ...fields,
    timestamp: new Date().toISOString(),
  });
}

export const logger = {
  info(message: string, fields?: Record<string, unknown>) {
    process.stdout.write(fmt("info", message, fields) + "\n");
  },
  warn(message: string, fields?: Record<string, unknown>) {
    process.stderr.write(fmt("warn", message, fields) + "\n");
  },
  error(message: string, fields?: Record<string, unknown>) {
    process.stderr.write(fmt("error", message, fields) + "\n");
  },
};
