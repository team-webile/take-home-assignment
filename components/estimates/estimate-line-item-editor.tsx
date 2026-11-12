'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatMinor,
  lineAmountMinor,
  parseMinor,
  parseQuantity,
  taxAmountMinor,
} from '@/lib/money';

/**
 * A line item as it is being typed. Every money / quantity value is kept as the
 * raw string the user typed; the conversion to integer minor units (or
 * thousandths) happens on submit, never while typing.
 */
export interface LineItemDraft {
  description: string;
  quantity: string;
  unitAmount: string;
  taxRatePercent: string;
}

export const emptyLineItem = (): LineItemDraft => ({
  description: '',
  quantity: '1',
  unitAmount: '',
  taxRatePercent: '0',
});

interface EstimateLineItemEditorProps {
  accountId: string;
  currency: string;
  value: LineItemDraft[];
  onChange: (next: LineItemDraft[]) => void;
  /** Only draft estimates may be edited — pass true to render read-only. */
  disabled?: boolean;
}

/**
 * Convert a typed tax rate ("20") into basis points (2000).
 * Returns null when the value cannot be used as a rate.
 */
export function parseTaxRatePercent(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const basisPoints = Math.round(value * 100);
  if (basisPoints < 0 || basisPoints > 10000) return null;
  return basisPoints;
}

/** Live (display-only) amount of one line. Unparseable input counts as 0. */
export function computeLineAmountMinor(
  item: LineItemDraft,
  currency: string
): { amountMinor: number; taxMinor: number } {
  const quantityMilli = parseQuantity(item.quantity) ?? 0;
  const unitAmountMinor = parseMinor(item.unitAmount, currency) ?? 0;
  const taxRateBasisPoints = parseTaxRatePercent(item.taxRatePercent) ?? 0;
  const amountMinor = lineAmountMinor(quantityMilli, unitAmountMinor);
  const taxMinor = taxAmountMinor(amountMinor, taxRateBasisPoints);
  return { amountMinor, taxMinor };
}

export function EstimateLineItemEditor({
  currency,
  value,
  onChange,
  disabled = false,
}: EstimateLineItemEditorProps) {
  const updateRow = (index: number, field: keyof LineItemDraft, next: string) => {
    onChange(value.map((row, i) => (i === index ? { ...row, [field]: next } : row)));
  };

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...value, emptyLineItem()]);
  };

  let subtotalMinor = 0;
  let taxMinor = 0;
  for (const item of value) {
    const line = computeLineAmountMinor(item, currency);
    subtotalMinor += line.amountMinor;
    taxMinor += line.taxMinor;
  }
  const totalMinor = subtotalMinor + taxMinor;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-[var(--surface-1)]/40">
            <tr className="border-b border-border">
              <th scope="col" className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold">
                Description
              </th>
              <th scope="col" className="text-muted-foreground w-24 px-3 py-2 text-left text-xs font-semibold">
                Quantity
              </th>
              <th scope="col" className="text-muted-foreground w-32 px-3 py-2 text-left text-xs font-semibold">
                Unit amount
              </th>
              <th scope="col" className="text-muted-foreground w-24 px-3 py-2 text-left text-xs font-semibold">
                Tax %
              </th>
              <th scope="col" className="text-muted-foreground w-32 px-3 py-2 text-right text-xs font-semibold">
                Amount
              </th>
              <th scope="col" className="w-12 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-6 text-center">
                  No line items yet.
                </td>
              </tr>
            ) : (
              value.map((item, index) => {
                const { amountMinor } = computeLineAmountMinor(item, currency);
                return (
                  <tr key={index} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Line ${index + 1} description`}
                        value={item.description}
                        onChange={(e) => updateRow(index, 'description', e.target.value)}
                        disabled={disabled}
                        placeholder="Design work, 10 hours…"
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Line ${index + 1} quantity`}
                        value={item.quantity}
                        onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                        disabled={disabled}
                        inputMode="decimal"
                        placeholder="1"
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Line ${index + 1} unit amount`}
                        value={item.unitAmount}
                        onChange={(e) => updateRow(index, 'unitAmount', e.target.value)}
                        disabled={disabled}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Line ${index + 1} tax rate`}
                        value={item.taxRatePercent}
                        onChange={(e) => updateRow(index, 'taxRatePercent', e.target.value)}
                        disabled={disabled}
                        inputMode="decimal"
                        placeholder="0"
                        className="h-8"
                      />
                    </td>
                    <td className="text-foreground px-3 py-2 text-right tabular-nums">
                      {formatMinor(amountMinor, currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeRow(index)}
                        disabled={disabled}
                        aria-label={`Remove line ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
          <Plus className="mr-2 h-4 w-4" />
          Add line
        </Button>

        <dl className="text-sm">
          <div className="flex justify-end gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-foreground tabular-nums">{formatMinor(subtotalMinor, currency)}</dd>
          </div>
          <div className="flex justify-end gap-4">
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="text-foreground tabular-nums">{formatMinor(taxMinor, currency)}</dd>
          </div>
          <div className="flex justify-end gap-4 border-t border-border pt-1">
            <dt className="text-foreground font-medium">Total</dt>
            <dd className="text-foreground font-semibold tabular-nums">
              {formatMinor(totalMinor, currency)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default EstimateLineItemEditor;
