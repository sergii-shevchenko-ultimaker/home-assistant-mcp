import { WebSocket } from "ws";

export interface HAWsClientOptions {
  haUrl: string;
  haToken: string;
  timeout?: number;
}

export class HAWsClient {
  public readonly haUrl: string;
  public readonly haToken: string;
  public readonly wsUrl: string;
  private readonly defaultTimeout: number;

  private ws: WebSocket | null = null;
  private messageIdSeq = 1;
  private authResolver: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private pendingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private connected = false;

  constructor(optionsOrUrl: HAWsClientOptions | string, haToken?: string) {
    if (typeof optionsOrUrl === "string") {
      this.haUrl = optionsOrUrl.replace(/\/+$/, "");
      this.haToken = haToken || "";
      this.defaultTimeout = 10000;
    } else {
      this.haUrl = optionsOrUrl.haUrl.replace(/\/+$/, "");
      this.haToken = optionsOrUrl.haToken;
      this.defaultTimeout = optionsOrUrl.timeout ?? 10000;
    }

    this.wsUrl = this.computeWsUrl(this.haUrl);
  }

  public get isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private computeWsUrl(url: string): string {
    let base = url;
    if (base.startsWith("http://")) {
      base = "ws://" + base.slice("http://".length);
    } else if (base.startsWith("https://")) {
      base = "wss://" + base.slice("https://".length);
    } else if (!base.startsWith("ws://") && !base.startsWith("wss://")) {
      base = "ws://" + base;
    }
    base = base.replace(/\/+$/, "");
    if (!base.endsWith("/api/websocket")) {
      base = base + "/api/websocket";
    }
    return base;
  }

  /**
   * Connect to Home Assistant WebSocket API and perform authentication handshake.
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.authResolver = { resolve, reject };

      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err: any) {
        this.authResolver = null;
        reject(new Error(`Failed to create WebSocket connection to ${this.wsUrl}: ${err.message}`));
        return;
      }

      this.ws.on("open", () => {
        // Wait for auth_required message from server
      });

      this.ws.on("message", (data: string | Buffer) => {
        this.handleIncomingMessage(data.toString());
      });

      this.ws.on("error", (err: Error) => {
        if (this.authResolver) {
          const auth = this.authResolver;
          this.authResolver = null;
          auth.reject(new Error(`WebSocket connection error: ${err.message}`));
        }
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        this.connected = false;
        if (this.authResolver) {
          const auth = this.authResolver;
          this.authResolver = null;
          auth.reject(
            new Error(
              `WebSocket closed before authentication completed (code: ${code}, reason: ${reason.toString()})`
            )
          );
        }
        this.rejectAllPending(new Error(`WebSocket closed (code ${code})`));
      });
    });
  }

  private handleIncomingMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 1. Auth required -> send auth token
    if (msg.type === "auth_required") {
      this.ws?.send(
        JSON.stringify({
          type: "auth",
          access_token: this.haToken,
        })
      );
      return;
    }

    // 2. Auth OK -> complete connect handshake
    if (msg.type === "auth_ok") {
      this.connected = true;
      if (this.authResolver) {
        const auth = this.authResolver;
        this.authResolver = null;
        auth.resolve();
      }
      return;
    }

    // 3. Auth Invalid -> fail connect handshake
    if (msg.type === "auth_invalid") {
      this.connected = false;
      const errorMsg = msg.message || "Invalid access token";
      if (this.authResolver) {
        const auth = this.authResolver;
        this.authResolver = null;
        auth.reject(new Error(`Home Assistant WebSocket auth_invalid: ${errorMsg}`));
      }
      this.ws?.close();
      return;
    }

    // 4. Command response
    if (msg.type === "result" && typeof msg.id === "number") {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.success) {
          pending.resolve(msg.result);
        } else {
          const errorMsg =
            msg.error?.message || (typeof msg.error === "string" ? msg.error : "Command failed");
          pending.reject(new Error(`HA WS Command Error [${msg.id}]: ${errorMsg}`));
        }
      }
    }
  }

  /**
   * Send a command over WebSocket and await the result.
   */
  async sendMessage<T = any>(
    message: Record<string, any>,
    timeoutMs = this.defaultTimeout
  ): Promise<T> {
    if (!this.isConnected) {
      await this.connect();
    }

    const id = this.messageIdSeq++;
    const payload = { id, ...message };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`HA WS Command [${id}] timed out after ${timeoutMs}ms (type: ${message.type})`)
        );
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.ws!.send(JSON.stringify(payload), (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(new Error(`Failed to send HA WS message [${id}]: ${err.message}`));
          }
        });
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to send HA WS message [${id}]: ${err.message}`));
      }
    });
  }

  /**
   * Fetch Lovelace dashboard configuration.
   */
  async getLovelaceConfig(urlPath?: string | null): Promise<any> {
    const payload: Record<string, any> = { type: "lovelace/config" };
    if (urlPath !== undefined && urlPath !== null) {
      payload.url_path = urlPath;
    }
    return this.sendMessage(payload);
  }

  /**
   * Save Lovelace dashboard configuration.
   */
  async saveLovelaceConfig(config: any, urlPath?: string | null): Promise<any> {
    const payload: Record<string, any> = { type: "lovelace/config/save", config };
    if (urlPath !== undefined && urlPath !== null) {
      payload.url_path = urlPath;
    }
    return this.sendMessage(payload);
  }

  /**
   * Fetch current entity states via WebSocket.
   */
  async fetchStates(): Promise<any[]> {
    return this.sendMessage({ type: "get_states" });
  }

  /**
   * Cleanly disconnect WebSocket.
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.rejectAllPending(new Error("HA WS Client disconnected"));
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve) => {
          socket.once("close", () => resolve());
          socket.close();
        });
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }
}
