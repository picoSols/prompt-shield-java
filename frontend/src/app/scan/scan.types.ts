export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ShieldReason {
  code: string;
  detail: string;
}

export interface ScanResponse {
  scanId: string;
  risk: RiskLevel;
  reasons: ShieldReason[];
  rulesetVersion: string;
  scanner: string;
  latencyMs: number;
}

export interface ScanRequest {
  input: string;
  scanner?: 'rules' | 'llm' | 'hybrid';
}
