export type ScanStatus = "breached" | "not_found" | "invalid_input" | "api_error" | "service_error" | "rate_limited" | "timeout" | "network_error" | "in_progress";
export type ScanResult = {
  status: ScanStatus;
  message: string;
  breach_count: number;
  breaches: string[];
  source: string;
  checked_at: string;
  cached: boolean;
  history_saved?: boolean;
  history_requested?: boolean;
  history_id?: string;
};
export type ScanHistory = {
  id: string;
  scan_type: "email" | "password";
  status: ScanStatus;
  breach_count: number;
  checked_at: string;
  created_at: string;
  cached: number;
};
export type PasswordHistoryInput = {
  id: string;
  status: "found" | "not_found";
  count: number;
  checked_at: string;
};
