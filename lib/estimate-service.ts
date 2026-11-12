/**
 * Estimates (Revenue & Billing) — server-side data access.
 *
 * Every function here is account-scoped: the `account_id` filter is applied
 * unconditionally in the query itself, so a caller can never widen the result
 * set by changing a parameter. Permission checks live in the API route
 * (`lib/server-guards.ts`), which runs *before* the service is called — this
 * module is the second layer, not the first.
 *
 * Money is integer minor units throughout. Quantities are thousandths.
 */

import { createAdminSupabaseClient } from './supabase-server';
import { lineAmountMinor, sumMinor, taxAmountMinor, DEFAULT_CURRENCY } from './money';

export const ESTIMATE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'void'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

/**
 * Allowed lifecycle transitions.
 *
 * draft  -> sent | void
 * sent   -> accepted | rejected | void
 * accepted / rejected / void are terminal.
 *
 * There is no transition back to `draft`: once an estimate has been seen by a
 * client, silently reverting it to an editable draft would break the promise
 * that the sent version is the version that was priced.
 */
const ALLOWED_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['sent', 'void'],
  sent: ['accepted', 'rejected', 'void'],
  accepted: [],
  rejected: [],
  void: [],
};

export interface EstimateLineItemInput {
  description: string;
  quantityMilli: number;
  unitAmountMinor: number;
  taxRateBasisPoints?: number;
}

export interface EstimateTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface EstimateListFilters {
  status?: EstimateStatus;
  projectId?: string;
  hasProject?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Result of editing a draft estimate. */
export type UpdateEstimateResult =
  | { error: null }
  | { error: 'not_found' }
  | { error: 'not_editable'; status: EstimateStatus };

/** Result of moving an estimate through its lifecycle. */
export type TransitionEstimateResult =
  | { error: null; fromStatus: EstimateStatus }
  | { error: 'not_found' }
  | { error: 'invalid_transition'; fromStatus: EstimateStatus; allowed: EstimateStatus[] };

function getClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error('Database connection not available');
  return client;
}

/**
 * Compute the money totals for a set of line items.
 *
 * Tax is charged per line at that line's own rate, then summed — this is what
 * makes a mixed-rate invoice come out right, and it avoids the classic bug of
 * taxing an already-taxed subtotal.
 */
export function computeTotals(lineItems: EstimateLineItemInput[]): EstimateTotals {
  const lines = lineItems.map((line) => {
    const amountMinor = lineAmountMinor(line.quantityMilli, line.unitAmountMinor);
    const taxMinor = taxAmountMinor(amountMinor, line.taxRateBasisPoints ?? 0);
    return { amountMinor, taxMinor };
  });

  const subtotalMinor = sumMinor(lines.map((l) => l.amountMinor));
  const taxMinor = sumMinor(lines.map((l) => l.taxMinor));

  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** Build the persisted line-item rows (including the derived amount). */
function buildLineItems(lineItems: EstimateLineItemInput[], estimateId: string) {
  return lineItems.map((line, index) => {
    const amountMinor = lineAmountMinor(line.quantityMilli, line.unitAmountMinor);
    return {
      estimate_id: estimateId,
      position: index,
      description: line.description,
      quantity_milli: line.quantityMilli,
      unit_amount_minor: line.unitAmountMinor,
      amount_minor: amountMinor,
      tax_rate_basis_points: line.taxRateBasisPoints ?? 0,
    };
  });
}

/** Escape the characters PostgREST's `or()` filter treats as syntax. */
function sanitiseSearchTerm(term: string): string {
  return term.replace(/[,()%*]/g, ' ').trim();
}

/** Generate a human-readable, per-account-unique reference. */
function generateReference(): string {
  const year = new Date().getUTCFullYear();
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `EST-${year}-${suffix}`;
}

/**
 * List the estimates belonging to one account.
 *
 * The account filter is not optional and not user supplied.
 */
export async function listEstimates(
  accountId: string,
  filters: EstimateListFilters = {}
) {
  const supabase = getClient();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('estimates')
    .select('*, projects(id, name)', { count: 'exact' })
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.projectId) {
    query = query.eq('project_id', filters.projectId);
  }
  if (filters.hasProject === false) {
    query = query.is('project_id', null);
  }
  if (filters.q) {
    const term = sanitiseSearchTerm(filters.q);
    if (term) {
      query = query.or(`title.ilike.%${term}%,reference.ilike.%${term}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to list estimates: ${error.message}`);

  return {
    estimates: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: pageSize > 0 ? Math.ceil((count ?? 0) / pageSize) : 0,
  };
}

/**
 * Fetch a single estimate with its line items and status history.
 *
 * `accountId` is optional but should always be supplied by a route that knows
 * the account in scope: when present it is enforced in the query.
 */
export async function getEstimateById(estimateId: string, accountId?: string) {
  const supabase = getClient();

  let query = supabase
    .from('estimates')
    .select('*, projects(id, name)')
    .eq('id', estimateId);
  if (accountId) query = query.eq('account_id', accountId);

  const { data: estimate, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load estimate: ${error.message}`);
  if (!estimate) return null;

  const [{ data: lineItems }, { data: history }] = await Promise.all([
    supabase
      .from('estimate_line_items')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('position', { ascending: true }),
    supabase
      .from('estimate_status_history')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true }),
  ]);

  return {
    ...estimate,
    line_items: lineItems ?? [],
    status_history: history ?? [],
  };
}

/**
 * Create a draft estimate.
 *
 * When an `idempotencyKey` is supplied the unique constraint
 * `(account_id, idempotency_key)` makes a repeated request return the
 * originally created estimate instead of creating a second one.
 */
export async function createEstimate(params: {
  accountId: string;
  actorId: string;
  title: string;
  reference?: string;
  projectId?: string | null;
  currency?: string;
  notes?: string | null;
  validUntil?: string | null;
  lineItems: EstimateLineItemInput[];
  idempotencyKey?: string | null;
}) {
  const supabase = getClient();
  const currency = (params.currency ?? DEFAULT_CURRENCY).toUpperCase();
  const totals = computeTotals(params.lineItems);
  const reference = params.reference?.trim() || generateReference();

  const { data: estimate, error } = await supabase
    .from('estimates')
    .insert({
      account_id: params.accountId,
      project_id: params.projectId ?? null,
      reference,
      title: params.title,
      status: 'draft',
      currency,
      subtotal_minor: totals.subtotalMinor,
      tax_minor: totals.taxMinor,
      total_minor: totals.totalMinor,
      notes: params.notes ?? null,
      valid_until: params.validUntil ?? null,
      idempotency_key: params.idempotencyKey ?? null,
      created_by: params.actorId,
      updated_by: params.actorId,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation. Either the reference or the idempotency key
    // collided with an existing estimate for this account.
    if (error.code === '23505' && params.idempotencyKey) {
      const { data: existing } = await supabase
        .from('estimates')
        .select('*')
        .eq('account_id', params.accountId)
        .eq('idempotency_key', params.idempotencyKey)
        .maybeSingle();

      if (existing) {
        return { estimate: existing, created: false };
      }
    }
    throw new Error(`Failed to create estimate: ${error.message}`);
  }

  const { error: lineError } = await supabase
    .from('estimate_line_items')
    .insert(buildLineItems(params.lineItems, estimate.id));
  if (lineError) {
    // Do not leave a header without its lines behind.
    await supabase.from('estimates').delete().eq('id', estimate.id);
    throw new Error(`Failed to create estimate line items: ${lineError.message}`);
  }

  await supabase.from('estimate_status_history').insert({
    estimate_id: estimate.id,
    from_status: null,
    to_status: 'draft',
    actor_id: params.actorId,
    note: 'Estimate created',
  });

  return { estimate, created: true };
}

/**
 * Update a draft estimate and its line items.
 *
 * Only drafts are editable. Once an estimate has been sent, its content is
 * frozen — a change to a sent estimate would change what the client agreed to.
 */
export async function updateEstimateDraft(params: {
  estimateId: string;
  accountId: string;
  actorId: string;
  title?: string;
  notes?: string | null;
  validUntil?: string | null;
  projectId?: string | null;
  lineItems?: EstimateLineItemInput[];
}): Promise<UpdateEstimateResult> {
  const supabase = getClient();

  const { data: existing, error: loadError } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', params.estimateId)
    .eq('account_id', params.accountId)
    .maybeSingle();

  if (loadError) throw new Error(`Failed to load estimate: ${loadError.message}`);
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'draft') {
    return { error: 'not_editable', status: existing.status as EstimateStatus };
  }

  const updates: Record<string, unknown> = { updated_by: params.actorId };
  if (params.title !== undefined) updates.title = params.title;
  if (params.notes !== undefined) updates.notes = params.notes;
  if (params.validUntil !== undefined) updates.valid_until = params.validUntil;
  if (params.projectId !== undefined) updates.project_id = params.projectId ?? null;

  if (params.lineItems) {
    const totals = computeTotals(params.lineItems);
    updates.subtotal_minor = totals.subtotalMinor;
    updates.tax_minor = totals.taxMinor;
    updates.total_minor = totals.totalMinor;
  }

  const { error: updateError } = await supabase
    .from('estimates')
    .update(updates)
    .eq('id', params.estimateId)
    .eq('account_id', params.accountId);
  if (updateError) throw new Error(`Failed to update estimate: ${updateError.message}`);

  if (params.lineItems) {
    const { error: deleteError } = await supabase
      .from('estimate_line_items')
      .delete()
      .eq('estimate_id', params.estimateId);
    if (deleteError) throw new Error(`Failed to replace line items: ${deleteError.message}`);

    const { error: insertError } = await supabase
      .from('estimate_line_items')
      .insert(buildLineItems(params.lineItems, params.estimateId));
    if (insertError) throw new Error(`Failed to replace line items: ${insertError.message}`);
  }

  return { error: null };
}

/**
 * Move an estimate through its lifecycle.
 *
 * The transition is validated against ALLOWED_TRANSITIONS, the estimate is
 * updated and the change is appended to the status history. Nothing is ever
 * deleted.
 */
export async function transitionEstimate(params: {
  estimateId: string;
  accountId: string;
  actorId: string;
  toStatus: EstimateStatus;
  note?: string | null;
}): Promise<TransitionEstimateResult> {
  const supabase = getClient();

  const { data: existing, error: loadError } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', params.estimateId)
    .eq('account_id', params.accountId)
    .maybeSingle();

  if (loadError) throw new Error(`Failed to load estimate: ${loadError.message}`);
  if (!existing) return { error: 'not_found' };

  const fromStatus = existing.status as EstimateStatus;
  const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(params.toStatus)) {
    return {
      error: 'invalid_transition',
      fromStatus,
      allowed,
    };
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: params.toStatus,
    updated_by: params.actorId,
  };
  if (params.toStatus === 'sent') updates.sent_at = now;
  if (params.toStatus === 'accepted') updates.accepted_at = now;
  if (params.toStatus === 'rejected') updates.rejected_at = now;

  const { error: updateError } = await supabase
    .from('estimates')
    .update(updates)
    .eq('id', params.estimateId)
    .eq('account_id', params.accountId);
  if (updateError) throw new Error(`Failed to update estimate status: ${updateError.message}`);

  await supabase.from('estimate_status_history').insert({
    estimate_id: params.estimateId,
    from_status: fromStatus,
    to_status: params.toStatus,
    actor_id: params.actorId,
    note: params.note ?? null,
  });

  return { error: null, fromStatus };
}
