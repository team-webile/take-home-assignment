import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndPermission, handleGuardError } from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { isValidUUID } from '@/lib/validation-helpers';

export const dynamic = 'force-dynamic';

type PermissionMap = Record<Permission, boolean>;

/** Every permission the platform knows about, mapped to false by default. */
function emptyPermissionMap(): PermissionMap {
  const map = {} as PermissionMap;
  for (const permission of Object.values(Permission)) {
    map[permission] = false;
  }
  return map;
}

/**
 * Turn the `roles.permissions` JSONB blob into a complete map.
 *
 * The column only stores granted permissions (`{"view_estimates": true}`),
 * so every other permission has to be filled in as `false` explicitly —
 * otherwise the UI cannot tell "not granted" from "not represented".
 */
function normalisePermissions(raw: unknown): PermissionMap {
  const map = emptyPermissionMap();
  if (!raw || typeof raw !== 'object') return map;

  const source = raw as Record<string, unknown>;
  for (const permission of Object.values(Permission)) {
    map[permission] = source[permission] === true;
  }
  return map;
}

/**
 * Reduce a map to the storage shape: only the granted permissions, as `true`.
 *
 * Storing only grants keeps the JSONB column small and means revoking a
 * permission is the same operation as never granting it.
 */
function toStoredPermissions(map: PermissionMap): Record<string, boolean> {
  const stored: Record<string, boolean> = {};
  for (const permission of Object.values(Permission)) {
    if (map[permission]) stored[permission] = true;
  }
  return stored;
}

async function loadRole(roleId: string) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) throw new Error('Database connection not available');

  const { data, error } = await supabase
    .from('roles')
    .select('id, name, description, is_system_role, permissions')
    .eq('id', roleId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load role: ${error.message}`);
  return data;
}

/**
 * GET /api/roles/[roleId]/permissions
 *
 * The full permission map for one role. Requires MANAGE_USER_ROLES.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;

  if (!isValidUUID(roleId)) {
    return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
  }

  try {
    await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    const role = await loadRole(roleId);
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        is_system_role: role.is_system_role,
      },
      permissions: normalisePermissions(role.permissions),
    });
  } catch (error) {
    console.error('[role-permissions] GET failed', error);
    return handleGuardError(error);
  }
}

/**
 * PUT /api/roles/[roleId]/permissions
 *
 * Replace a role's permission map.
 *
 * System roles are rejected: their permissions are part of the platform
 * contract, not something an administrator may edit at runtime.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;

  if (!isValidUUID(roleId)) {
    return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
  }

  try {
    await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    const role = await loadRole(roleId);
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    if (role.is_system_role) {
      return NextResponse.json(
        { error: 'Permissions of system roles cannot be modified', code: 'SYSTEM_ROLE' },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const submitted = (body as { permissions?: unknown })?.permissions;
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
      return NextResponse.json({ error: 'A permissions object is required' }, { status: 400 });
    }

    const known = new Set<string>(Object.values(Permission));
    const source = submitted as Record<string, unknown>;
    const next = emptyPermissionMap();

    for (const [key, value] of Object.entries(source)) {
      if (!known.has(key)) {
        return NextResponse.json({ error: `Unknown permission: ${key}` }, { status: 400 });
      }
      if (typeof value !== 'boolean') {
        return NextResponse.json(
          { error: `Permission ${key} must be a boolean` },
          { status: 400 }
        );
      }
      next[key as Permission] = value;
    }

    const supabase = createAdminSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const { error } = await supabase
      .from('roles')
      .update({ permissions: toStoredPermissions(next) })
      .eq('id', roleId);

    if (error) {
      throw new Error(`Failed to update permissions: ${error.message}`);
    }

    return NextResponse.json({ success: true, permissions: next });
  } catch (error) {
    console.error('[role-permissions] PUT failed', error);
    return handleGuardError(error);
  }
}
