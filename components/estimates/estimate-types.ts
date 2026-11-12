/**
 * Client-side shapes for the Estimates feature.
 *
 * The API returns rows straight out of Postgres, so the field names are
 * snake_case. Money is always an integer number of minor units; quantities are
 * always an integer number of thousandths.
 */

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'void';

export const ESTIMATE_STATUSES: EstimateStatus[] = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'void',
];

/**
 * The lifecycle, mirrored from the server (`lib/estimate-service.ts`).
 *
 * The UI uses this to decide which actions to offer. The server remains the
 * authority — a transition the client offers is still validated there.
 */
export const ALLOWED_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['sent', 'void'],
  sent: ['accepted', 'rejected', 'void'],
  accepted: [],
  rejected: [],
  void: [],
};

export function getAllowedTransitions(status: EstimateStatus): EstimateStatus[] {
  return ALLOWED_TRANSITIONS[status] ?? [];
}

export interface EstimateSummary {
  id: string;
  account_id: string;
  project_id: string | null;
  reference: string;
  title: string;
  status: EstimateStatus;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  notes: string | null;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  projects: { id: string; name: string } | null;
}

export interface EstimateLineItem {
  id: string;
  estimate_id: string;
  position: number;
  description: string;
  quantity_milli: number;
  unit_amount_minor: number;
  amount_minor: number;
  tax_rate_basis_points: number;
}

export interface EstimateStatusHistoryEntry {
  id: string;
  estimate_id: string;
  from_status: EstimateStatus | null;
  to_status: EstimateStatus;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface EstimateDetail extends EstimateSummary {
  line_items: EstimateLineItem[];
  status_history: EstimateStatusHistoryEntry[];
}

export interface EstimateListResponse {
  success: boolean;
  estimates: EstimateSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ProjectOption {
  id: string;
  name: string;
}

/** The wire format the API expects for a line item. */
export interface ParsedLineItem {
  description: string;
  quantityMilli: number;
  unitAmountMinor: number;
  taxRateBasisPoints: number;
}
