'use client';

import { Badge } from '@/components/ui/badge';
import { cva } from 'class-variance-authority';
import type { EstimateStatus } from './estimate-types';

/**
 * Lifecycle of an estimate.
 *
 * draft -> sent | void
 * sent  -> accepted | rejected | void
 * accepted / rejected / void are terminal.
 *
 * The canonical list lives in `estimate-types.ts`; it is re-exported here for
 * convenience because the badge is the component most consumers import.
 */
export { ESTIMATE_STATUSES, type EstimateStatus } from './estimate-types';

/** Brand colours copied from components/project-data-table.tsx. */
const statusBadgeVariants = cva('capitalize text-white text-xs', {
  variants: {
    variant: {
      draft: 'bg-[#787878] hover:bg-[#647878]',
      sent: 'bg-[#007EE5] hover:bg-[#0066CC]',
      accepted: 'bg-[#4A5D3A] hover:bg-[#3A4D2A]',
      rejected: 'bg-[#B3261E] hover:bg-[#99201A]',
      void: 'bg-[#3D464D] hover:bg-[#282828]',
    },
  },
  defaultVariants: {
    variant: 'draft',
  },
});

interface EstimateStatusBadgeProps {
  status: EstimateStatus;
}

export function EstimateStatusBadge({ status }: EstimateStatusBadgeProps) {
  return (
    <Badge
      className={statusBadgeVariants({ variant: status })}
      aria-label={`Status: ${status}`}
    >
      {status}
    </Badge>
  );
}

export default EstimateStatusBadge;
