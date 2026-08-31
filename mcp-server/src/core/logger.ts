/**
 * Safe logger routing diagnostic messages strictly to stderr to preserve stdio MCP transport integrity.
 */

export class Logger {
  constructor(private readonly context: string = "App") {}

  info(message: string, ...args: any[]): void {
    console.error(`[INFO] [${this.context}] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.error(`[WARN] [${this.context}] ${message}`, ...args);
  }

  error(message: string, error?: any): void {
    console.error(`[ERROR] [${this.context}] ${message}`, error ?? "");
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] [${this.context}] ${message}`, ...args);
    }
  }
}

export const defaultLogger = new Logger("HA-AI");
