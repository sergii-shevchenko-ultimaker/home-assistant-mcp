import WebSocket from "ws";
import { IHAWsClient } from "../../domain/ports/ha-client.port.js";
import { HAEntityState } from "../../domain/models/entity.js";
import { ClientError } from "../../core/errors.js";

export interface HAWsOptions {
  haUrl: string;
  haToken: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class HAWsAdapter implements IHAWsClient {
  private readonly wsUrl: string;
  private readonly haToken: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private ws: WebSocket | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private isAuthenticated = false;

  constructor(options: HAWsOptions | string, haToken?: string) {
    let url: string;
    let token: string;

    if (typeof options === "string") {
      url = options;
      token = haToken ?? "";
      this.connectTimeoutMs = 10000;
      this.requestTimeoutMs = 15000;
    } else {
      url = options.haUrl;
      token = options.haToken;
      this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
      this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    }

    this.haToken = token;
    const cleanUrl = url.replace(/\/+$/, "");
    if (cleanUrl.startsWith("http://")) {
      this.wsUrl = `ws://${cleanUrl.slice("http://".length)}/api/websocket`;
    } else if (cleanUrl.startsWith("https://")) {
      this.wsUrl = `wss://${cleanUrl.slice("https://".length)}/api/websocket`;
    } else if (cleanUrl.startsWith("ws://") || cleanUrl.startsWith("wss://")) {
      this.wsUrl = cleanUrl.endsWith("/api/websocket") ? cleanUrl : `${cleanUrl}/api/websocket`;
    } else {
      this.wsUrl = `ws://${cleanUrl}/api/websocket`;
    }
  }

  get isConnected(): boolean {
    return this.isAuthenticated && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.ws && this.isAuthenticated && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.disconnect();
          reject(new ClientError("HA WebSocket connection timed out"));
        }
      }, this.connectTimeoutMs);

      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err: any) {
        clearTimeout(timeout);
        return reject(new ClientError(`WebSocket initialization failed: ${err.message}`));
      }

      this.ws.on("open", () => {});

      this.ws.on("message", (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString("utf-8"));

          if (msg.type === "auth_required") {
            this.ws?.send(JSON.stringify({ type: "auth", access_token: this.haToken }));
            return;
          }

          if (msg.type === "auth_ok") {
            this.isAuthenticated = true;
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeout);
              resolve();
            }
            return;
          }

          if (msg.type === "auth_invalid") {
            this.isAuthenticated = false;
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeout);
              reject(new ClientError(`HA WebSocket authentication failed: ${msg.message || "Invalid token"}`));
            }
            this.disconnect();
            return;
          }

          if (typeof msg.id === "number" && this.pendingRequests.has(msg.id)) {
            const pending = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            clearTimeout(pending.timer);

            if (msg.success) {
              pending.resolve(msg.result ?? null);
            } else {
              pending.reject(new ClientError(msg.error?.message || `WebSocket command ${msg.id} failed`));
            }
          }
        } catch (err) {
          // Ignore non-json frames
        }
      });

      this.ws.on("error", (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          reject(new ClientError(`HA WebSocket error: ${err.message}`));
        }
      });

      this.ws.on("close", () => {
        this.isAuthenticated = false;
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new ClientError(`WebSocket closed before request ${id} resolved`));
        }
        this.pendingRequests.clear();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.isAuthenticated = false;
  }

  async sendMessage<T = any>(command: Record<string, any>): Promise<T> {
    return this.sendCommand<T>(command);
  }

  private async sendCommand<T = any>(command: Record<string, any>): Promise<T> {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ClientError("WebSocket is not connected");
    }

    const id = this.messageId++;
    const payload = { ...command, id };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new ClientError(`WebSocket command ${id} timed out after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  async getLovelaceConfig(urlPath?: string | null): Promise<Record<string, any>> {
    const cmd: Record<string, any> = { type: "lovelace/config" };
    if (urlPath) {
      cmd.url_path = urlPath;
    }
    return this.sendCommand<Record<string, any>>(cmd);
  }

  async saveLovelaceConfig(config: Record<string, any>, urlPath?: string | null): Promise<null> {
    const cmd: Record<string, any> = { type: "lovelace/config/save", config };
    if (urlPath) {
      cmd.url_path = urlPath;
    }
    return this.sendCommand<null>(cmd);
  }

  async fetchStates(): Promise<HAEntityState[]> {
    return this.sendCommand<HAEntityState[]>({ type: "get_states" });
  }
}

// Backward-compatible alias
export { HAWsAdapter as HAWsClient };
