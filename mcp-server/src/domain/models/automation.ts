export interface AutomationSummary {
  entity_id: string;
  id?: string;
  alias?: string;
  state: string;
  description?: string;
  last_triggered?: string | null;
}

export interface AutomationBlock {
  id?: string;
  alias?: string;
  description?: string;
  trigger?: any[];
  condition?: any[];
  action?: any[];
  mode?: "single" | "restart" | "queued" | "parallel";
  [key: string]: any;
}
