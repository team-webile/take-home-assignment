import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndPermission, handleGuardError } from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import {
  createEstimateSchema,
  getEstimatesQuerySchema,
  validateQueryParams,
  validateRequestBody,
} from '@/lib/validation-schemas';
import { isValidUUID } from '@/lib/validation-helpers';
import { createEstimate, listEstimates } from '@/lib/estimate-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounts/[accountId]/estimates
 *
 * Server-side list with filtering, search and pagination. The account comes
 * from the route, never from the query string, and the caller must already be
 * able to reach that account.
 *
 * Query parameters: status, projectId, q, page, pageSize
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;

  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
  }

  try {
    await requireAuthAndPermission(Permission.VIEW_ESTIMATES, { accountId }, request);

    const raw: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
      raw[key] = value;
    });

    const validation = validateQueryParams(getEstimatesQuerySchema, raw);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const result = await listEstimates(accountId, {
      ...validation.data,
      // The query string carries the flag as a string; the service works with
      // a real boolean.
      hasProject:
        validation.data.hasProject === undefined
          ? undefined
          : validation.data.hasProject === 'true',
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    console.error('[estimates] GET list failed', error);
    return handleGuardError(error);
  }
}

/**
 * POST /api/accounts/[accountId]/estimates
 *
 * Create a draft estimate.
 *
 * Idempotency: send an `Idempotency-Key` header. A repeated request with the
 * same key for the same account returns the estimate that was created the
 * first time (HTTP 200 with `idempotentReplay: true`) instead of creating a
 * duplicate (HTTP 201).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;

  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
  }

  try {
    const userProfile = await requireAuthAndPermission(
      Permission.MANAGE_ESTIMATES,
      { accountId },
      request
    );

    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const validation = validateRequestBody(createEstimateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { estimate, created } = await createEstimate({
      accountId,
      actorId: userProfile.id,
      title: validation.data.title,
      reference: validation.data.reference,
      projectId: validation.data.projectId ?? null,
      currency: validation.data.currency,
      notes: validation.data.notes ?? null,
      validUntil: validation.data.validUntil ?? null,
      lineItems: validation.data.lineItems,
      idempotencyKey,
    });

    return NextResponse.json(
      { success: true, estimate, idempotentReplay: !created },
      { status: created ? 201 : 200 }
    );
  } catch (error) {
    console.error('[estimates] POST create failed', error);
    return handleGuardError(error);
  }
}
