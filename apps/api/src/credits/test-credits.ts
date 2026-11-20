// 测试用：给组织登记一份合同和次数（直接往数据库插行）。只在测试里用
import { CREDIT_ENTRY_POOL } from '@genyun/shared';
import type { Database } from '../db/client.ts';
import { creditEntries, organizationContracts } from '../db/schema.ts';

export async function grantCredits(
  db: Database,
  orgId: string,
  by: string,
  opts: { purchase?: number; gift?: number; startsAt?: string; endsAt?: string; number?: string } = {},
): Promise<string> {
  const [contract] = await db
    .insert(organizationContracts)
    .values({
      orgId,
      number: opts.number ?? `GY-TEST-${Math.random().toString(36).slice(2, 8)}`,
      startsAt: opts.startsAt ?? '2026-01-01',
      endsAt: opts.endsAt ?? '2099-12-31',
      paymentConfirmedBy: by,
    })
    .returning({ id: organizationContracts.id });
  const rows = [
    ...(opts.purchase ? [{ type: 'contract_purchase' as const, delta: opts.purchase, campaign: null }] : []),
    ...(opts.gift ? [{ type: 'gift' as const, delta: opts.gift, campaign: '开通赠送' }] : []),
  ];
  if (rows.length > 0) {
    await db
      .insert(creditEntries)
      .values(rows.map((r) => ({ ...r, orgId, contractId: contract!.id, pool: CREDIT_ENTRY_POOL[r.type], createdBy: by })));
  }
  return contract!.id;
}
