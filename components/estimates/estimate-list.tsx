'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Send,
  Check,
  X,
  Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatMinor } from '@/lib/money';
import { apiFetch } from '@/lib/api-config';
import { EstimateStatusBadge } from './estimate-status-badge';
import { EstimateCreateDialog } from './estimate-create-dialog';
import {
  ESTIMATE_STATUSES,
  getAllowedTransitions,
  type EstimateDetail,
  type EstimateListResponse,
  type EstimateStatus,
  type EstimateSummary,
  type ProjectOption,
} from './estimate-types';

const ALL = '__all__';
const NO_PROJECT = '__none__';

interface EstimateListProps {
  accountId: string;
  projects: ProjectOption[];
  /** The user may create and edit draft estimates. */
  canManage: boolean;
  /** The user may move an estimate through its lifecycle. */
  canManageLifecycle: boolean;
}

async function fetcher(url: string) {
  const res = await apiFetch(url, { cache: 'no-store', credentials: 'include' });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data?.error || 'Request failed') as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data;
}

/** The label and icon used for each transition the API accepts. */
const TRANSITION_UI: Record<
  EstimateStatus,
  { label: string; icon: typeof Send; variant: 'default' | 'outline' | 'destructive' }
> = {
  draft: { label: 'Reopen', icon: Send, variant: 'outline' },
  sent: { label: 'Send', icon: Send, variant: 'default' },
  accepted: { label: 'Accept', icon: Check, variant: 'default' },
  rejected: { label: 'Reject', icon: X, variant: 'destructive' },
  void: { label: 'Void', icon: Ban, variant: 'outline' },
};

export function EstimateList({
  accountId,
  projects,
  canManage,
  canManageLifecycle,
}: EstimateListProps) {
  const [status, setStatus] = useState<string>(ALL);
  const [projectId, setProjectId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const listKey = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== ALL) params.set('status', status);
    if (projectId === NO_PROJECT) {
      params.set('hasProject', 'false');
    } else if (projectId !== ALL) {
      params.set('projectId', projectId);
    }
    if (query.trim()) params.set('q', query.trim());
    params.set('page', String(page));
    const search = params.toString();
    return `/api/accounts/${accountId}/estimates?${search}`;
  }, [accountId, status, projectId, query, page]);

  const {
    data,
    error,
    isLoading,
    mutate: refreshList,
  } = useSWR<EstimateListResponse>(listKey, fetcher, { keepPreviousData: true });

  const {
    data: detail,
    mutate: refreshDetail,
    isLoading: detailLoading,
  } = useSWR<{ success: boolean; estimate: EstimateDetail }>(
    selectedId ? `/api/accounts/${accountId}/estimates/${selectedId}` : null,
    fetcher
  );

  const runTransition = async (toStatus: EstimateStatus) => {
    if (!selectedId) return;
    setTransitioning(toStatus);
    try {
      const res = await apiFetch(`/api/accounts/${accountId}/estimates/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toStatus }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to update the estimate');
      }
      toast.success(`Estimate marked as ${toStatus}`);
      await Promise.all([refreshDetail(), refreshList()]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to update the estimate');
    } finally {
      setTransitioning(null);
    }
  };

  const estimates = data?.estimates ?? [];
  const pageCount = data?.pageCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="estimate-filter-status">Status</Label>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger id="estimate-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {ESTIMATE_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="estimate-filter-project">Project</Label>
            <Select
              value={projectId}
              onValueChange={(value) => {
                setProjectId(value);
                setPage(1);
              }}
            >
              <SelectTrigger id="estimate-filter-project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                <SelectItem value={NO_PROJECT}>No project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="estimate-filter-search">Search</Label>
            <div className="flex gap-2">
              <Input
                id="estimate-filter-search"
                value={search}
                placeholder="Title or reference"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setQuery(search);
                    setPage(1);
                  }
                }}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Apply search"
                onClick={() => {
                  setQuery(search);
                  setPage(1);
                }}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshList()}
            disabled={isLoading}
            aria-label="Refresh estimates"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New estimate
            </Button>
          )}
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error.message}
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {isLoading && !data ? (
          <div className="text-muted-foreground py-8 text-center">Loading estimates…</div>
        ) : estimates.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center">
            <FileText className="mx-auto mb-2 h-6 w-6 opacity-50" />
            <p className="text-sm">No estimates yet.</p>
            {canManage && (
              <Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create the first one
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Reference</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((estimate: EstimateSummary) => {
                const isOpen = selectedId === estimate.id;
                return (
                  <TableRow
                    key={estimate.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(isOpen ? null : estimate.id)}
                  >
                    <TableCell>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{estimate.reference}</TableCell>
                    <TableCell className="font-medium">{estimate.title}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {estimate.projects?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <EstimateStatusBadge status={estimate.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinor(estimate.total_minor, estimate.currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <span className="text-muted-foreground">
              Page {data?.page ?? 1} of {pageCount} · {data?.total ?? 0} estimates
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={(data?.page ?? 1) <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={(data?.page ?? 1) >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail */}
      {selectedId && (
        <div className="bg-[var(--surface-2)] space-y-4 rounded-xl border p-4">
          {detailLoading && !detail ? (
            <div className="text-muted-foreground py-4 text-center">Loading estimate…</div>
          ) : detail?.estimate ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{detail.estimate.title}</h3>
                  <p className="text-muted-foreground font-mono text-xs">
                    {detail.estimate.reference}
                    {detail.estimate.valid_until
                      ? ` · valid until ${detail.estimate.valid_until}`
                      : ''}
                  </p>
                </div>
                <EstimateStatusBadge status={detail.estimate.status} />
              </div>

              {detail.estimate.notes && (
                <p className="text-muted-foreground text-sm">{detail.estimate.notes}</p>
              )}

              {/* Line items */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-[var(--surface-1)]/40">
                    <tr className="border-b border-border">
                      <th className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold">
                        Description
                      </th>
                      <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold">
                        Qty
                      </th>
                      <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold">
                        Unit
                      </th>
                      <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.estimate.line_items.map((line) => (
                      <tr key={line.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                          {line.quantity_milli / 1000}
                        </td>
                        <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                          {formatMinor(line.unit_amount_minor, detail.estimate.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMinor(line.amount_minor, detail.estimate.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <dl className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    {formatMinor(detail.estimate.subtotal_minor, detail.estimate.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="tabular-nums">
                    {formatMinor(detail.estimate.tax_minor, detail.estimate.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-6 border-t border-border pt-1 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    {formatMinor(detail.estimate.total_minor, detail.estimate.currency)}
                  </dd>
                </div>
              </dl>

              {/* Lifecycle actions */}
              {canManageLifecycle && getAllowedTransitions(detail.estimate.status).length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {getAllowedTransitions(detail.estimate.status).map((next) => {
                    const ui = TRANSITION_UI[next];
                    const Icon = ui.icon;
                    return (
                      <Button
                        key={next}
                        size="sm"
                        variant={ui.variant}
                        disabled={transitioning !== null}
                        onClick={() => runTransition(next)}
                      >
                        <Icon className="mr-2 h-4 w-4" />
                        {transitioning === next ? 'Working…' : ui.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {/* History */}
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  History
                </p>
                <ul className="space-y-1">
                  {detail.estimate.status_history.map((entry) => (
                    <li key={entry.id} className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Badge variant="secondary" className="text-[10px]">
                        {entry.from_status ?? 'new'}
                        {' → '}
                        {entry.to_status}
                      </Badge>
                      <span>
                        {new Date(entry.created_at).toLocaleString()}
                        {entry.note ? ` — ${entry.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>
      )}

      <EstimateCreateDialog
        accountId={accountId}
        projects={projects}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          refreshList();
        }}
      />
    </div>
  );
}

export default EstimateList;
