'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  EstimateLineItemEditor,
  emptyLineItem,
  parseTaxRatePercent,
  type LineItemDraft,
} from './estimate-line-item-editor';
import { DEFAULT_CURRENCY, parseMinor, parseQuantity } from '@/lib/money';
import { apiFetch } from '@/lib/api-config';
import type { EstimateSummary, ParsedLineItem, ProjectOption } from './estimate-types';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'ZAR', 'BHD'];

const NO_PROJECT = '__none__';

interface EstimateCreateDialogProps {
  accountId: string;
  projects: ProjectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (estimate: EstimateSummary) => void;
}

/**
 * Create a draft estimate.
 *
 * Money never leaves the browser as a float: the typed amounts are converted
 * to integer minor units (and quantities to integer thousandths) here, before
 * the request is made.
 */
export function EstimateCreateDialog({
  accountId,
  projects,
  open,
  onOpenChange,
  onCreated,
}: EstimateCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [projectId, setProjectId] = useState<string>(NO_PROJECT);
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [submitting, setSubmitting] = useState(false);

  /**
   * The idempotency key is created once per drafting session and reused for
   * every retry, so a double click (or a retry after a flaky network) cannot
   * create two estimates. A fresh key is issued for the next estimate.
   */
  const idempotencyKeyRef = useRef<string>('');

  useEffect(() => {
    if (!open) return;
    idempotencyKeyRef.current = crypto.randomUUID();
    setTitle('');
    setReference('');
    setProjectId(NO_PROJECT);
    setCurrency(DEFAULT_CURRENCY);
    setNotes('');
    setValidUntil('');
    setItems([emptyLineItem()]);
  }, [open]);

  const reset = () => {
    setTitle('');
    setReference('');
    setProjectId(NO_PROJECT);
    setCurrency(DEFAULT_CURRENCY);
    setNotes('');
    setValidUntil('');
    setItems([emptyLineItem()]);
  };

  /** Convert the typed rows into the API's line-item shape, or explain why not. */
  const buildLineItems = (): { items: ParsedLineItem[]; error: string | null } => {
    const parsed: ParsedLineItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = `Line ${i + 1}`;

      const description = item.description.trim();
      if (!description) {
        return { items: [], error: `${label} needs a description.` };
      }

      const quantityMilli = parseQuantity(item.quantity);
      if (quantityMilli === null || quantityMilli <= 0) {
        return { items: [], error: `${label} needs a quantity greater than zero.` };
      }

      const unitAmountMinor = parseMinor(item.unitAmount, currency);
      if (unitAmountMinor === null) {
        return {
          items: [],
          error: `${label} has an invalid unit amount for ${currency}.`,
        };
      }
      if (unitAmountMinor < 0) {
        return { items: [], error: `${label} cannot have a negative unit amount.` };
      }

      const taxRateBasisPoints = parseTaxRatePercent(item.taxRatePercent);
      if (taxRateBasisPoints === null) {
        return { items: [], error: `${label} has an invalid tax rate.` };
      }

      parsed.push({ description, quantityMilli, unitAmountMinor, taxRateBasisPoints });
    }

    if (parsed.length === 0) {
      return { items: [], error: 'Add at least one line item.' };
    }

    return { items: parsed, error: null };
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('A title is required');
      return;
    }

    const { items: lineItems, error } = buildLineItems();
    if (error) {
      toast.error(error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/accounts/${accountId}/estimates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          title: title.trim(),
          reference: reference.trim() || undefined,
          projectId: projectId === NO_PROJECT ? null : projectId,
          currency,
          notes: notes.trim() || null,
          validUntil: validUntil || null,
          lineItems,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create the estimate');
      }

      toast.success(
        data.idempotentReplay
          ? 'Estimate already created — showing the existing draft'
          : 'Draft estimate created'
      );
      reset();
      onOpenChange(false);
      onCreated(data.estimate as EstimateSummary);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to create the estimate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New estimate</DialogTitle>
          <DialogDescription>
            Estimates start as drafts. Nothing is sent to the client until you move it to
            &quot;sent&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="estimate-title">Title *</Label>
              <Input
                id="estimate-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Phase 2 platform build"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimate-reference">Reference</Label>
              <Input
                id="estimate-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Auto-generated if left blank"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimate-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="estimate-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimate-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="estimate-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>No project</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimate-valid-until">Valid until</Label>
              <Input
                id="estimate-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="estimate-notes">Notes</Label>
              <Textarea
                id="estimate-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Scope, assumptions, payment terms…"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items</Label>
            <EstimateLineItemEditor
              accountId={accountId}
              currency={currency}
              value={items}
              onChange={setItems}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EstimateCreateDialog;
