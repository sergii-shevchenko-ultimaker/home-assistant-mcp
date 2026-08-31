import axios, { type AxiosInstance } from "axios";

export interface HARestClientOptions {
  haUrl: string;
  haToken: string;
  timeout?: number;
}

export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
  context?: {
    id: string;
    parent_id?: string | null;
    user_id?: string | null;
  };
}

export class HARestClient {
  private readonly client: AxiosInstance;
  public readonly haUrl: string;
  public readonly haToken: string;

  constructor(optionsOrUrl: HARestClientOptions | string, haToken?: string) {
    if (typeof optionsOrUrl === "string") {
      this.haUrl = optionsOrUrl.replace(/\/+$/, "");
      this.haToken = haToken || "";
      this.client = axios.create({
        baseURL: this.haUrl,
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${this.haToken}`,
          "Content-Type": "application/json",
        },
      });
    } else {
      this.haUrl = optionsOrUrl.haUrl.replace(/\/+$/, "");
      this.haToken = optionsOrUrl.haToken;
      this.client = axios.create({
        baseURL: this.haUrl,
        timeout: optionsOrUrl.timeout ?? 10000,
        headers: {
          Authorization: `Bearer ${this.haToken}`,
          "Content-Type": "application/json",
        },
      });
    }
  }

  /**
   * Check if Home Assistant REST API is reachable and token is valid.
   */
  async checkApi(): Promise<{ message: string }> {
    try {
      const response = await this.client.get<{ message: string }>("/api/");
      return response.data;
    } catch (error: any) {
      this.handleAxiosError("checkApi", error);
    }
  }

  /**
   * Fetch all current entity states from Home Assistant.
   */
  async getStates(): Promise<HAEntityState[]> {
    try {
      const response = await this.client.get<HAEntityState[]>("/api/states");
      return response.data;
    } catch (error: any) {
      this.handleAxiosError("getStates", error);
    }
  }

  /**
   * Call a service in Home Assistant (e.g. domain='light', service='turn_on').
   */
  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, any>
  ): Promise<any> {
    try {
      const response = await this.client.post<any>(
        `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
        serviceData || {}
      );
      return response.data;
    } catch (error: any) {
      this.handleAxiosError(`callService(${domain}.${service})`, error);
    }
  }

  private handleAxiosError(context: string, error: any): never {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const detail =
        typeof error.response.data === "object"
          ? JSON.stringify(error.response.data)
          : String(error.response.data);
      throw new Error(
        `HA REST API Error on ${context} [HTTP ${status}]: ${detail || error.message}`
      );
    }
    throw new Error(`HA REST API Request Failed on ${context}: ${error.message || String(error)}`);
  }
}
