import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getCurrentUserProfileServer } from '@/lib/auth-server';
import { accountService } from '@/lib/account-service';
import { hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import { createServerSupabase, createAdminSupabaseClient } from '@/lib/supabase-server';
import { EstimateList } from '@/components/estimates/estimate-list';
import type { ProjectOption } from '@/components/estimates/estimate-types';

export const dynamic = 'force-dynamic';

interface EstimatesPageProps {
  params: Promise<{ accountId: string }>;
}

export async function generateMetadata({ params }: EstimatesPageProps): Promise<Metadata> {
  const { accountId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return { title: 'Estimates' };

  const { data: account } = await supabase
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();

  return { title: account ? `Estimates · ${account.name}` : 'Estimates' };
}

/**
 * Estimates, scoped to one account.
 *
 * Access is decided here, on the server: the page only renders for a user who
 * can reach the account *and* holds VIEW_ESTIMATES. The API enforces the same
 * rules again on every request — this check only decides what gets rendered.
 */
export default async function AccountEstimatesPage({ params }: EstimatesPageProps) {
  const { accountId } = await params;

  const userProfile = await getCurrentUserProfileServer();
  if (!userProfile) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-foreground text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground mt-2">Please log in to view estimates.</p>
        </div>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-foreground text-2xl font-bold">Database Error</h1>
          <p className="text-muted-foreground mt-2">Unable to connect to database.</p>
        </div>
      </div>
    );
  }

  const [canSeeAllAccounts, canViewAccount, canReachAccount, canViewEstimates] = await Promise.all([
    hasPermission(userProfile, Permission.VIEW_ALL_ACCOUNTS),
    hasPermission(userProfile, Permission.VIEW_ACCOUNTS, { accountId }, supabase),
    accountService.canUserAccessAccount(userProfile.id, accountId, supabase),
    hasPermission(userProfile, Permission.VIEW_ESTIMATES, { accountId }, supabase),
  ]);

  const hasAccountAccess = canSeeAllAccounts || canViewAccount || canReachAccount;

  if (!hasAccountAccess || !canViewEstimates) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-foreground text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground mt-2">
            You don&apos;t have permission to view estimates for this account.
          </p>
          <Link
            href={`/accounts/${accountId}`}
            className="text-primary mt-4 inline-flex items-center gap-2 text-sm underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to the account
          </Link>
        </div>
      </div>
    );
  }

  const [canManage, canManageLifecycle] = await Promise.all([
    hasPermission(userProfile, Permission.MANAGE_ESTIMATES, { accountId }, supabase),
    hasPermission(userProfile, Permission.MANAGE_ESTIMATE_LIFECYCLE, { accountId }, supabase),
  ]);

  // Permission is already verified above, so the read happens through the
  // service-role client and stays scoped to this account.
  const adminClient = createAdminSupabaseClient();
  const queryClient = adminClient || supabase;

  const [accountResult, projectsResult] = await Promise.all([
    queryClient
      .from('accounts')
      .select('id, name')
      .eq('id', accountId)
      .maybeSingle(),
    queryClient
      .from('projects')
      .select('id, name')
      .eq('account_id', accountId)
      .order('name', { ascending: true }),
  ]);

  const account = accountResult.data;
  const projects: ProjectOption[] = (projectsResult.data ?? []) as ProjectOption[];

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link
          href={`/accounts/${accountId}`}
          className="text-muted-foreground inline-flex items-center gap-2 text-sm hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {account?.name ?? 'Account'}
        </Link>
        <h1 className="text-foreground text-2xl font-bold">Estimates</h1>
        <p className="text-muted-foreground text-sm">
          Draft, send and track the estimates raised for this account.
        </p>
      </div>

      <EstimateList
        accountId={accountId}
        projects={projects}
        canManage={canManage}
        canManageLifecycle={canManageLifecycle}
      />
    </div>
  );
}
