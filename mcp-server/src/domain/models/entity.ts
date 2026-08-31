export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
  context?: Record<string, any>;
}

export interface EntityFilter {
  domain?: string;
  query?: string;
}
