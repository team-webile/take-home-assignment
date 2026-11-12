-- =============================================================
-- SEED: Demo roles (fixed UUIDs) + safe column patches
-- Run after schema.sql, before: npm run seed:users
-- Re-runnable: roles are upserted, not skipped.
-- =============================================================

-- 1. Safe patches for DBs that applied an older schema.sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_completed_onboarding BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

-- `display_order` is written by app/api/roles/* and app/api/tasks/[taskId].
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

-- 2. Insert seed roles with the exact UUIDs create-seed-users.ts expects
--    Permissions are the base permission set; account scoping is enforced at
--    request time by lib/permission-checker.ts (context match on accountId).
INSERT INTO roles (id, name, description, is_system_role, hierarchy_level, display_order, permissions) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Superadmin',        'Full system access. Bypasses all permission checks.',               TRUE,  100, 100, '{}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Client',            'External client user. Access limited to their account projects.',  TRUE,  0,   10,  '{"view_projects": true, "view_estimates": true}'),
  ('70707070-7070-7070-7070-707070707070', 'Contributor',       'Limited view (contributor access).',                              FALSE, 10,  20,  '{"view_projects": true, "manage_time": true, "view_estimates": true}'),
  ('10101010-1010-1010-1010-101010101010', 'Senior Designer',   'Tasks and time tracking.',                                        FALSE, 30,  30,  '{"view_projects": true, "manage_time": true, "edit_own_availability": true, "view_estimates": true}'),
  ('30303030-3030-3030-3030-303030303030', 'Senior Developer',  'Tasks and time tracking.',                                        FALSE, 30,  31,  '{"view_projects": true, "manage_time": true, "edit_own_availability": true, "view_estimates": true}'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Project Manager',   'Projects, tasks, and capacity planning.',                         FALSE, 50,  50,  '{"manage_projects": true, "view_projects": true, "view_team_capacity": true, "manage_time": true, "view_estimates": true}'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Account Manager',   'Account management views.',                                       FALSE, 60,  60,  '{"manage_accounts": true, "view_all_accounts": true, "manage_projects": true, "view_all_projects": true, "view_estimates": true, "manage_estimates": true, "manage_estimate_lifecycle": true}'),
  ('77777777-7777-7777-7777-777777777777', 'Admin',             'Workflows, roles, and newsletters.',                              FALSE, 80,  80,  '{"manage_user_roles": true, "manage_workflows": true, "manage_newsletters": true, "manage_users": true, "view_estimates": true, "manage_estimates": true}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Executive Director','Full analytics and org visibility.',                               FALSE, 90,  90,  '{"view_all_analytics": true, "view_all_projects": true, "view_all_departments": true, "view_all_accounts": true, "view_estimates": true}')
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  description       = EXCLUDED.description,
  is_system_role    = EXCLUDED.is_system_role,
  hierarchy_level   = EXCLUDED.hierarchy_level,
  display_order     = EXCLUDED.display_order,
  permissions       = EXCLUDED.permissions;

-- 3. Normalise status values left over from older seeds.
--    accounts now uses the 'active' | 'inactive' | 'archived' domain that the
--    application code (lib/validation-schemas.ts) validates against; projects
--    keep the planning/in_progress/review/complete/on_hold domain.
UPDATE accounts  SET status = 'active'      WHERE status IN ('planning','in_progress','review','complete','on_hold');
UPDATE projects  SET status = 'in_progress' WHERE status = 'active';
