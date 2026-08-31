import { HAEntityState } from "../models/entity.js";

export interface IHARestClient {
  checkApi(): Promise<{ message: string }>;
  getStates(): Promise<HAEntityState[]>;
  callService(domain: string, service: string, serviceData?: Record<string, any>): Promise<any>;
}

export interface IHAWsClient {
  connect(): Promise<void>;
  disconnect(): void | Promise<void>;
  getLovelaceConfig(urlPath?: string | null): Promise<Record<string, any>>;
  saveLovelaceConfig(config: Record<string, any>, urlPath?: string | null): Promise<any>;
  fetchStates(): Promise<HAEntityState[]>;
}
