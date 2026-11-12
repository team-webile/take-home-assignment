import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndPermission, handleGuardError } from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import {
  transitionEstimateSchema,
  updateEstimateSchema,
  validateRequestBody,
} from '@/lib/validation-schemas';
import { isValidUUID } from '@/lib/validation-helpers';
import { getEstimateById, transitionEstimate, updateEstimateDraft } from '@/lib/estimate-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounts/[accountId]/estimates/[estimateId]
 *
 * A single estimate with its line items and its full status history.
 * The estimate must belong to the account in the route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; estimateId: string }> }
) {
  const { accountId, estimateId } = await params;

  if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
    return NextResponse.json({ error: 'Invalid account or estimate ID' }, { status: 400 });
  }

  try {
    await requireAuthAndPermission(Permission.VIEW_ESTIMATES, { accountId }, request);

    const estimate = await getEstimateById(estimateId, accountId);
    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, estimate }, { status: 200 });
  } catch (error) {
    return handleGuardError(error);
  }
}

/**
 * PATCH /api/accounts/[accountId]/estimates/[estimateId]
 *
 * Two shapes, two different permissions:
 *
 *   - `{ status, note? }`  moves the estimate through its lifecycle
 *                           (requires MANAGE_ESTIMATE_LIFECYCLE)
 *   - `{ title?, notes?, validUntil?, projectId?, lineItems? }`
 *                           edits a draft estimate
 *                           (requires MANAGE_ESTIMATES)
 *
 * There is no DELETE handler: estimates are never hard deleted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; estimateId: string }> }
) {
  const { accountId, estimateId } = await params;

  if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
    return NextResponse.json({ error: 'Invalid account or estimate ID' }, { status: 400 });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = ((await request.json()) as Record<string, unknown>) ?? {};
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const isTransition = typeof body.status === 'string';

    const userProfile = await requireAuthAndPermission(
      isTransition ? Permission.MANAGE_ESTIMATE_LIFECYCLE : Permission.MANAGE_ESTIMATES,
      { accountId },
      request
    );

    if (isTransition) {
      const validation = validateRequestBody(transitionEstimateSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const result = await transitionEstimate({
        estimateId,
        accountId,
        actorId: userProfile.id,
        toStatus: validation.data.status,
        note: validation.data.note ?? null,
      });

      if (result.error === 'not_found') {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
      }
      if (result.error === 'invalid_transition') {
        return NextResponse.json(
          {
            error: `Cannot move an estimate from "${result.fromStatus}" to "${validation.data.status}"`,
            code: 'INVALID_TRANSITION',
            allowed: result.allowed,
          },
          { status: 409 }
        );
      }

      const estimate = await getEstimateById(estimateId, accountId);
      return NextResponse.json({ success: true, estimate }, { status: 200 });
    }

    const validation = validateRequestBody(updateEstimateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const result = await updateEstimateDraft({
      estimateId,
      accountId,
      actorId: userProfile.id,
      title: validation.data.title,
      notes: validation.data.notes ?? null,
      validUntil: validation.data.validUntil ?? null,
      projectId: validation.data.projectId ?? null,
      lineItems: validation.data.lineItems,
    });

    if (result.error === 'not_found') {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }
    if (result.error === 'not_editable') {
      return NextResponse.json(
        {
          error: `A "${result.status}" estimate can no longer be edited`,
          code: 'NOT_EDITABLE',
        },
        { status: 409 }
      );
    }

    const estimate = await getEstimateById(estimateId, accountId);
    return NextResponse.json({ success: true, estimate }, { status: 200 });
  } catch (error) {
    return handleGuardError(error);
  }
}
