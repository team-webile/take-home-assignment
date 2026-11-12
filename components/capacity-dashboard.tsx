import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UserWithRoles } from '@/lib/rbac';

type Props = {
  accountId?: string;
  projectId?: string;
  /** Passed by the account overview; accepted so the call site type-checks. */
  userProfile?: UserWithRoles;
  /** 'account' when rendered inside an account overview. */
  mode?: string;
};

/**
 * Lightweight placeholder component.
 *
 * The app references `CapacityDashboard` from `components/account-overview.tsx`.
 * The original implementation was removed from the repo; this keeps the UI/build
 * functional until a full capacity module is reintroduced.
 */
export function CapacityDashboard({ accountId, projectId }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Capacity</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        Capacity dashboard is not yet configured for this build.
        {(accountId || projectId) && (
          <div className="mt-2">
            <div>accountId: {accountId ?? '—'}</div>
            <div>projectId: {projectId ?? '—'}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
