/**
 * Account-level Kanban column configuration.
 *
 * The account overview renders projects in a Kanban-ish board. The board's
 * columns are stored per account in `account_kanban_configs` and are read and
 * written through `/api/accounts/[accountId]/kanban-config`.
 *
 * This module is the browser-side counterpart of that route: it loads the
 * configuration for one account and maps between a Kanban column and the
 * project status it represents.
 *
 * Kanban/Gantt for projects is deprecated in favour of workflows — only the
 * table view remains — so the mapping below is deliberately small and
 * defensive: an unknown column degrades to a default instead of throwing.
 */

import { apiFetch } from '@/lib/api-config';
import type { ProjectStatus } from '@/components/project-data-table';

/** A single Kanban column as stored in `account_kanban_configs.columns`. */
export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  order: number;
}

/** The configuration row for one account. */
export interface AccountKanbanConfig {
  id?: string;
  account_id?: string;
  columns: KanbanColumn[];
  created_at?: string;
  updated_at?: string;
}

/** The columns used when an account has no stored configuration. */
export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'planned', name: 'Planned', color: '#6B7280', order: 1 },
  { id: 'in-progress', name: 'In Progress', color: '#3B82F6', order: 2 },
  { id: 'review', name: 'Review', color: '#F59E0B', order: 3 },
  { id: 'complete', name: 'Complete', color: '#10B981', order: 4 },
];

/**
 * Kanban column id -> project status.
 *
 * The ids are the historical Kanban names; the project status domain is the
 * one the application validates (`lib/validation-schemas.ts`).
 */
const COLUMN_STATUS: Record<string, ProjectStatus> = {
  planned: 'planning',
  'in-progress': 'in_progress',
  review: 'review',
  complete: 'complete',
  'on-hold': 'on_hold',
  on_hold: 'on_hold',
};

const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'in_progress',
  'review',
  'complete',
  'on_hold',
];

function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as string[]).includes(value);
}

/** Keep only well-formed columns and put them in display order. */
function normaliseColumns(raw: unknown): KanbanColumn[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((column): column is Record<string, unknown> => !!column && typeof column === 'object')
    .map((column, index) => ({
      id: typeof column.id === 'string' ? column.id : `column-${index}`,
      name: typeof column.name === 'string' ? column.name : 'Column',
      color: typeof column.color === 'string' ? column.color : '#6B7280',
      order: typeof column.order === 'number' ? column.order : index,
    }))
    .sort((a, b) => a.order - b.order);
}

export const accountKanbanConfigService = {
  /**
   * Load the Kanban configuration for an account.
   *
   * Returns the stored configuration, or the defaults when the account has
   * never been configured. The caller is expected to handle a rejected
   * request (for example a user without VIEW_PROJECTS) by falling back to the
   * defaults as well.
   */
  async getOrCreateAccountKanbanConfig(accountId: string): Promise<AccountKanbanConfig> {
    const res = await apiFetch(`/api/accounts/${accountId}/kanban-config`, {
      cache: 'no-store',
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`Failed to load kanban configuration (${res.status})`);
    }

    const data = await res.json();
    const stored = data?.config;
    const columns = normaliseColumns(stored?.columns);

    return {
      ...(stored ?? {}),
      account_id: stored?.account_id ?? accountId,
      columns: columns.length > 0 ? columns : DEFAULT_KANBAN_COLUMNS,
    };
  },

  /**
   * The project status a column represents.
   *
   * Custom columns (for example "Approved") are visual-only: they have no
   * status of their own and fall back to `planning`.
   */
  getStatusForKanbanColumn(columnId: string, columns: KanbanColumn[]): ProjectStatus {
    const mapped = COLUMN_STATUS[columnId];
    if (mapped) return mapped;

    const column = columns.find((candidate) => candidate.id === columnId);
    if (column && isProjectStatus(column.id)) return column.id;

    return 'planning';
  },

  /**
   * The column that represents a project status.
   *
   * Falls back to the first column when no column maps to the status (for
   * example `on_hold`, which has no default column).
   */
  getKanbanColumnForStatus(status: string, columns: KanbanColumn[]): string {
    const match = columns.find(
      (column) => this.getStatusForKanbanColumn(column.id, columns) === status,
    );
    if (match) return match.id;

    return columns[0]?.id ?? DEFAULT_KANBAN_COLUMNS[0].id;
  },
};

export default accountKanbanConfigService;
