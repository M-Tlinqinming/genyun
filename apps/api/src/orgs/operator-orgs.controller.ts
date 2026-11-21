import {
  addDays,
  adminInvitationSchema,
  checkRegionParts,
  chinaToday,
  formatRegion,
  isCreditContractActive,
  orgRenewalSchema,
  regionPartsOf,
  type OrgRenewalResult,
  CREDIT_ENTRY_POOL,
  CREDIT_ENTRY_TYPE_LABELS,
  creditAdjustSchema,
  type CreditAdjustResult,
  invitationState,
  operatorTaskStage,
  detectFileType,
  fileRejectionReason,
  FILE_TYPES,
  openingGaps,
  orgOpenSchema,
  orgRegisterSchema,
  orgServiceState,
  UPLOAD_RULES,
  type OrgOpenDraft,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { areaList } from '@vant/area-data';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { clientIp, insertAuditLog } from '../audit/audit.ts';
import { canManageOrganizations } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { creditBriefs, CreditsService, lockOrg } from '../credits/credits.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  creditEntries,
  enterprises,
  files,
  memberships,
  organizationContracts,
  organizationInvitations,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';
import { receiveOne } from '../files/files.controller.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { MAIL_OUTBOX, MAILER, type Mailer } from '../mail/mailer.ts';
import { createInvitation, EMAIL_HAS_ACCOUNT } from './invitations.ts';

const NOT_FOUND = '找不到该客户组织';
const ALREADY_OPEN = '这个组织已经开通了，续约请到组织详情里点「登记续约」';
// 2026-12-31 → 2026.12.31
const dotted = (date: string) => date.replaceAll('-', '.');

const columns = {
  id: organizations.id,
  name: organizations.name,
  region: organizations.region,
  regionProvince: organizations.regionProvince,
  regionCity: organizations.regionCity,
  regionDistrict: organizations.regionDistrict,
  socialCreditCode: organizations.socialCreditCode,
  contactName: organizations.contactName,
  contactPhone: organizations.contactPhone,
  contactEmail: organizations.contactEmail,
  note: organizations.note,
  contractStartsAt: organizations.contractStartsAt,
  contractEndsAt: organizations.contractEndsAt,
  activatedAt: organizations.activatedAt,
  createdAt: organizations.createdAt,
  registeredByName: sql<string | null>`(select u.name from users u where u.id = "organizations"."registered_by")`,
  activatedByName: sql<string | null>`(select u.name from users u where u.id = "organizations"."activated_by")`,
};

type OrgRow = {
  activatedAt: Date | null;
  contractStartsAt: string | null;
  contractEndsAt: string | null;
  regionProvince: string | null;
  regionCity: string | null;
  regionDistrict: string | null;
};
// 三列地区换成 regionParts（老数据只有文字时为 null）
const withState = <T extends OrgRow>({ regionProvince, regionCity, regionDistrict, ...o }: T) => ({
  ...o,
  regionParts: regionPartsOf({ regionProvince, regionCity, regionDistrict }),
  state: orgServiceState({ ...o, activatedAt: o.activatedAt?.toISOString() ?? null }, chinaToday()),
});

// 登记、修改资料：核对省市区，三列和拼好的全称一起存
function registerValues(body: unknown) {
  const parsed = orgRegisterSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
  const { region, ...rest } = parsed.data;
  const wrong = checkRegionParts(region, areaList);
  if (wrong) throw new BadRequestException(wrong);
  return {
    ...rest,
    region: formatRegion(region, 'full'),
    regionProvince: region.province,
    regionCity: region.city,
    regionDistrict: region.district,
  };
}

// 运营管理客户组织：登记、修改资料、上传合同原件、开通（Paper 16 页 I02 与开通弹窗）。
// 客户、专业人员一律 403；不存在的组织和内部组织一律 404
@Controller('operator/organizations')
export class OperatorOrgsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(MAIL_OUTBOX) private readonly mailOutbox: boolean,
    @Inject(CreditsService) private readonly credits: CreditsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    this.guard(user);
    const rows = await this.db
      .select({
        ...columns,
        // 子查询里写全表名：drizzle 在这里不带表名，会和子查询里的同名列混淆
        enterprises: sql<number>`(select count(*)::int from enterprises e where e.org_id = "organizations"."id")`,
        members: sql<number>`(select count(*)::int from memberships m where m.org_id = "organizations"."id")`,
        openTasks: sql<number>`(select count(*)::int from tasks t where t.org_id = "organizations"."id" and t.closed_at is null and t.deleted_at is null)`,
      })
      .from(organizations)
      .where(eq(organizations.kind, 'customer'))
      .orderBy(desc(organizations.createdAt));
    const contracts = await this.latestContracts(rows.map((r) => r.id));
    // 次数汇总加「等次数」的成果份数；还没开通的为 null
    const credits = await creditBriefs(
      this.db,
      rows.filter((r) => r.activatedAt).map((r) => r.id),
    );
    return rows.map((r) => ({ ...withState(r), contract: contracts.get(r.id) ?? null, credits: credits.get(r.id) ?? null }));
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const org = await this.load(id);
    const contracts = await this.latestContracts([id]);
    // 开通、续约弹窗里带出最近上传、还没挂到任何合同上的原件，关掉弹窗再打开不用重传
    const attached = this.db
      .select({ id: organizationContracts.fileId })
      .from(organizationContracts)
      .where(and(eq(organizationContracts.orgId, id), sql`${organizationContracts.fileId} is not null`));
    const [contractFile] = await this.db
      .select({
        id: files.id,
        originalName: files.originalName,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
        uploadedByName: users.name,
      })
      .from(files)
      .innerJoin(users, eq(users.id, files.uploadedBy))
      .where(and(eq(files.orgId, id), eq(files.kind, 'contract'), notInArray(files.id, attached)))
      .orderBy(desc(files.createdAt))
      .limit(1);
    return {
      ...withState(org),
      contract: contracts.get(id) ?? null,
      contractFile: contractFile ?? null,
      contracts: await this.contractList(id),
      ...(await this.people(id)),
      enterprises: await this.enterpriseTasks(id),
    };
  }

  // 重发邀请或更换首位管理员：作废还没接受的管理员邀请，按填的人重新发一封。
  // 首位管理员接受以后，成员由客户管理员自己邀请和管理，这里不再更换
  @Post(':id/admin-invitation')
  @HttpCode(200)
  async inviteAdmin(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    const org = await this.load(id);
    if (!org.activatedAt) throw new ConflictException('这个组织还没开通。请先在列表里点「开通」');
    const parsed = adminInvitationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const d = parsed.data;

    await this.rejectExistingAccount(d.email);

    const invitation = await this.db.transaction(async (tx) => {
      // 锁住组织这一行：和并发的更换、接受邀请排队，避免作废旧邀请时对方刚好接受
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).for('update');
      const [admin] = await tx
        .select({ id: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.orgId, id), eq(memberships.role, 'customer_admin')))
        .limit(1);
      if (admin) throw new ConflictException('首位管理员已经接受邀请。之后的成员由客户管理员在「组织管理」里邀请');
      await tx
        .update(organizationInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.orgId, id),
            eq(organizationInvitations.role, 'customer_admin'),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        );
      return createInvitation(tx, {
        orgId: id,
        orgName: org.name,
        role: 'customer_admin',
        email: d.email,
        name: d.name,
        phone: d.phone,
        invitedBy: user.id,
        inviterName: '耕云运营',
        resend: true,
      });
    });
    const mailSent = await this.sendMail(invitation.mail);
    return { email: d.email, expiresAt: invitation.expiresAt, mailSent, ...this.mailMode() };
  }

  @Post()
  async register(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    this.guard(user);
    const values = registerValues(body);
    const [created] = await this.db
      .insert(organizations)
      .values({ ...values, kind: 'customer', registeredBy: user.id })
      .returning({ id: organizations.id });
    return withState(await this.load(created!.id));
  }

  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    await this.load(id);
    const values = registerValues(body);
    await this.db.update(organizations).set(values).where(eq(organizations.id, id));
    return withState(await this.load(id));
  }

  // 合同原件：只收 PDF、最大 20 MB；kind = contract，只有运营能取下载链接
  @Post(':id/contract-file')
  async uploadContract(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.guard(user);
    await this.load(id);
    const { maxBytes } = UPLOAD_RULES.contract;
    let file: Express.Multer.File | undefined;
    try {
      file = await receiveOne(req, res, maxBytes);
    } catch (err) {
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        throw new BadRequestException(`合同原件超过 ${maxBytes / 1024 / 1024} MB。请降低扫描分辨率后重新上传`);
      }
      if (err instanceof MulterError) throw new BadRequestException('请一次上传一个文件');
      throw err;
    }
    if (!file) throw new BadRequestException('请选择合同原件');
    const name = file.originalname.trim().slice(0, 200) || '合同原件.pdf';
    const reason = fileRejectionReason('contract', name, file.buffer);
    if (reason) throw new BadRequestException(reason);
    const type = detectFileType(file.buffer)!;

    const fileId = randomUUID();
    const storageKey = `${id}/${fileId}`;
    const contentType = FILE_TYPES[type].mime;
    await this.storage.put(storageKey, file.buffer, contentType);
    const [created] = await this.db
      .insert(files)
      .values({
        id: fileId,
        orgId: id,
        kind: 'contract',
        originalName: name,
        contentType,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        storageKey,
        uploadedBy: user.id,
      })
      .returning({
        id: files.id,
        kind: files.kind,
        originalName: files.originalName,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
      });
    return { ...created!, uploadedByName: user.name };
  }

  // 开通：登记合同和次数、合同有效期生效、给首位管理员发邀请。没确认到账不能开通；合同原件可以以后再传
  @Post(':id/open')
  @HttpCode(200)
  async open(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    this.guard(user);
    const org = await this.load(id);
    if (org.activatedAt) throw new ConflictException(ALREADY_OPEN);

    const gaps = openingGaps((body ?? {}) as OrgOpenDraft);
    if (gaps.length > 0) {
      throw new BadRequestException({ statusCode: 400, message: `开通前还要填：${gaps.join('、')}`, gaps });
    }
    const parsed = orgOpenSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const d = parsed.data;

    await this.rejectExistingAccount(d.adminEmail);

    const invitation = await this.db.transaction(async (tx) => {
      // 并发开通时只有一次能成功
      const [updated] = await tx
        .update(organizations)
        .set({ contractStartsAt: d.startsAt, contractEndsAt: d.endsAt, activatedAt: new Date(), activatedBy: user.id })
        .where(and(eq(organizations.id, id), isNull(organizations.activatedAt)))
        .returning({ id: organizations.id });
      if (!updated) throw new ConflictException(ALREADY_OPEN);
      await this.checkContract(tx, id, d);
      await this.insertContract(tx, id, user.id, {
        ...d,
        contractStartsAt: d.startsAt,
        contractEndsAt: d.endsAt,
        purchaseReason: '开通时按合同登记。',
        giftReason: '开通时按活动规则赠送，跟合同一起到期。',
      });
      await insertAuditLog(tx, {
        action: 'org_open',
        actorId: user.id,
        actorEmail: user.email,
        ip: clientIp(req),
        target: `${org.name} · 合同 ${d.contractNumber}`,
      });
      return createInvitation(tx, {
        orgId: id,
        orgName: org.name,
        role: 'customer_admin',
        email: d.adminEmail,
        name: d.adminName,
        phone: d.adminPhone,
        invitedBy: user.id,
        inviterName: '耕云运营',
      });
    });
    // 事务提交后再发信；发信失败不回滚开通，运营可在组织详情里重新发送
    const mailSent = await this.sendMail(invitation.mail);
    return {
      ...withState(await this.load(id)),
      invitation: { email: d.adminEmail, expiresAt: invitation.expiresAt, mailSent, ...this.mailMode() },
    };
  }

  /**
   * 登记续约（画板没画，照开通弹窗）：新增一份合同，登记购买、赠送次数，更新组织的合同有效期。
   * 没到期的：新合同要接着现在的合同（开始日不晚于现在到期日的后一天），到期日要更晚，只更新到期日；
   * 已到期的：开始、到期都换成新合同的。提交后放开等续约的成果
   */
  @Post(':id/renewal')
  @HttpCode(200)
  async renew(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<OrgRenewalResult> {
    this.guard(user);
    const org = await this.load(id);
    if (!org.activatedAt || !org.contractEndsAt) throw new ConflictException('这个组织还没开通，请先开通');
    const parsed = orgRenewalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const d = parsed.data;

    await this.db.transaction(async (tx) => {
      await lockOrg(tx, id);
      const [now] = await tx
        .select({ startsAt: organizations.contractStartsAt, endsAt: organizations.contractEndsAt })
        .from(organizations)
        .where(eq(organizations.id, id));
      const currentEnd = now!.endsAt!;
      const running = currentEnd >= chinaToday();
      if (running) {
        const latestStart = addDays(currentEnd, 1);
        if (d.contractStartsAt > latestStart) {
          throw new BadRequestException(`新合同要接着现在的合同：开始日不能晚于 ${dotted(latestStart)}`);
        }
        if (d.contractEndsAt <= currentEnd) {
          throw new BadRequestException(`新合同的到期日要晚于现在的合同（${dotted(currentEnd)}）`);
        }
      }
      const [last] = await tx
        .select({ startsAt: organizationContracts.startsAt })
        .from(organizationContracts)
        .where(eq(organizationContracts.orgId, id))
        .orderBy(desc(organizationContracts.startsAt))
        .limit(1);
      if (last && d.contractStartsAt < last.startsAt) {
        throw new BadRequestException(`新合同的开始日不能早于上一份合同（${dotted(last.startsAt)}）`);
      }
      await this.checkContract(tx, id, d);

      await this.insertContract(tx, id, user.id, {
        ...d,
        purchaseReason: '续约时按合同登记。',
        giftReason: '续约时按活动规则赠送，跟合同一起到期。',
      });
      await tx
        .update(organizations)
        .set(running ? { contractEndsAt: d.contractEndsAt } : { contractStartsAt: d.contractStartsAt, contractEndsAt: d.contractEndsAt })
        .where(eq(organizations.id, id));
      await insertAuditLog(tx, {
        action: 'contract_renew',
        actorId: user.id,
        actorEmail: user.email,
        ip: clientIp(req),
        target: `${org.name} · 合同 ${d.contractNumber}，到 ${dotted(d.contractEndsAt)}`,
      });
    });
    // 提交后放开等续约的成果（新合同还没开始的，到了开始日由每小时扫描放开）
    const released = await this.credits.releaseLocked(id, 'renewal');
    return { released };
  }

  // 运营看一个组织的次数：汇总、等次数的成果份数、台账明细（16 页「次数记录」）
  @Get(':id/credits')
  async creditsView(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    await this.load(id);
    return this.credits.operatorView(id);
  }

  // 调整次数（16 页「调整次数」弹窗；弹窗本身 K16 做）。提交后放开锁住的成果，再检查次数提醒
  @Post(':id/credits')
  @HttpCode(200)
  async adjustCredits(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<CreditAdjustResult> {
    this.guard(user);
    const org = await this.load(id);
    const parsed = creditAdjustSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const d = parsed.data;
    // 次数记录和操作日志同一个事务写；减次数时 adjust 自己检查提醒
    await this.credits.adjust(id, d, user.id, {
      actorEmail: user.email,
      ip: clientIp(req),
      target: `${org.name} · ${CREDIT_ENTRY_TYPE_LABELS[d.type]} ${d.delta > 0 ? '+' : ''}${d.delta} 次`,
    });
    // 提交后放开锁住的成果；放开了（扣了次数）才检查提醒
    const released = await this.credits.releaseLocked(id, 'credits');
    return { summary: (await creditBriefs(this.db, [id])).get(id)!, released };
  }

  /**
   * 开通、续约共用，在写合同的事务里查：
   * - 合同编号不能和这个组织登记过的重复（去掉首尾空格、不分大小写比；存的还是填的原样）；
   * - 合同原件选填；填了就要是这个组织上传过、还没挂到别的合同上的合同原件
   */
  private async checkContract(tx: Pick<Database, 'select'>, orgId: string, d: { contractNumber: string; contractFileId: string | null }) {
    const numbers = await tx
      .select({ number: organizationContracts.number })
      .from(organizationContracts)
      .where(eq(organizationContracts.orgId, orgId));
    const key = (n: string) => n.trim().toUpperCase();
    if (numbers.some((c) => key(c.number) === key(d.contractNumber))) throw new ConflictException('这个合同编号已经登记过了');

    if (!d.contractFileId) return;
    const [found] = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, d.contractFileId), eq(files.orgId, orgId), eq(files.kind, 'contract')))
      .limit(1);
    if (!found) throw new BadRequestException('合同原件找不到了，请重新上传');
    const [used] = await tx
      .select({ id: organizationContracts.id })
      .from(organizationContracts)
      .where(eq(organizationContracts.fileId, d.contractFileId))
      .limit(1);
    if (used) throw new BadRequestException('这份合同原件已经挂在别的合同上了，请上传这份合同自己的原件');
  }

  // 开通、续约共用：写一份合同和它的购买、赠送次数（16 页「次数记录」的原因；页面会在前面加「原因：」，存的时候不带）
  private async insertContract(
    tx: Pick<Database, 'insert'>,
    orgId: string,
    operatorId: string,
    d: {
      contractNumber: string;
      contractStartsAt: string;
      contractEndsAt: string;
      contractFileId: string | null;
      purchasedCredits: number;
      giftCredits: number;
      giftCampaign: string | null;
      purchaseReason: string;
      giftReason: string;
    },
  ) {
    const [contract] = await tx
      .insert(organizationContracts)
      .values({
        orgId,
        number: d.contractNumber,
        scopeKind: null,
        scopeEnterprises: null,
        startsAt: d.contractStartsAt,
        endsAt: d.contractEndsAt,
        fileId: d.contractFileId,
        paymentConfirmedBy: operatorId,
      })
      .returning({ id: organizationContracts.id });
    const credits = [
      ...(d.purchasedCredits > 0
        ? [{ type: 'contract_purchase' as const, delta: d.purchasedCredits, campaign: null, reason: d.purchaseReason }]
        : []),
      ...(d.giftCredits > 0 ? [{ type: 'gift' as const, delta: d.giftCredits, campaign: d.giftCampaign, reason: d.giftReason }] : []),
    ];
    if (credits.length > 0) {
      await tx
        .insert(creditEntries)
        .values(credits.map((c) => ({ ...c, orgId, contractId: contract!.id, pool: CREDIT_ENTRY_POOL[c.type], createdBy: operatorId })));
    }
  }

  // 组织详情「年度服务」页签：全部合同，新的在前；次数按类型相加（不含交付扣减）
  private async contractList(orgId: string) {
    const rows = await this.db
      .select({
        id: organizationContracts.id,
        number: organizationContracts.number,
        startsAt: organizationContracts.startsAt,
        endsAt: organizationContracts.endsAt,
        scopeKind: organizationContracts.scopeKind,
        scopeEnterprises: organizationContracts.scopeEnterprises,
        paymentConfirmedAt: organizationContracts.paymentConfirmedAt,
        paymentConfirmedByName: users.name,
        fileId: files.id,
        fileName: files.originalName,
        fileCreatedAt: files.createdAt,
      })
      .from(organizationContracts)
      .innerJoin(users, eq(users.id, organizationContracts.paymentConfirmedBy))
      .leftJoin(files, eq(files.id, organizationContracts.fileId))
      .where(eq(organizationContracts.orgId, orgId))
      .orderBy(desc(organizationContracts.startsAt), desc(organizationContracts.createdAt));
    const sums = await this.db
      .select({ contractId: creditEntries.contractId, type: creditEntries.type, total: sql<number>`sum(${creditEntries.delta})::int` })
      .from(creditEntries)
      .where(eq(creditEntries.orgId, orgId))
      .groupBy(creditEntries.contractId, creditEntries.type);
    const today = chinaToday();
    return rows.map(({ fileId, fileName, fileCreatedAt, ...c }) => {
      const sum = (type: string) => sums.find((s) => s.contractId === c.id && s.type === type)?.total ?? 0;
      return {
        ...c,
        state: isCreditContractActive(c, today) ? ('active' as const) : c.startsAt > today ? ('upcoming' as const) : ('expired' as const),
        credits: { purchase: sum('contract_purchase'), gift: sum('gift'), topUp: sum('top_up'), compensation: sum('compensation') },
        file: fileId ? { id: fileId, originalName: fileName!, createdAt: fileCreatedAt! } : null,
      };
    });
  }

  // 这一期首位管理员只能是新账号（已有账号加入其他组织留给第 7 项），发邀请时当场拦下，不等对方接受时才报错
  private async rejectExistingAccount(email: string) {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictException({ statusCode: 409, message: EMAIL_HAS_ACCOUNT, field: 'email' });
  }

  // 模拟发信时提示「预览环境未真实发送」；发件箱开放时才加「可在模拟发件箱查看」
  private mailMode() {
    const mailSimulated = this.mailer.simulated === true;
    return { mailSimulated, mailInOutbox: mailSimulated && this.mailOutbox };
  }

  private async sendMail(mail: Parameters<Mailer['send']>[0]): Promise<boolean> {
    try {
      await this.mailer.send(mail);
      return true;
    } catch (err) {
      console.error('邀请邮件发送失败', err instanceof Error ? err.message : 'unknown');
      return false;
    }
  }

  // 组织详情「联系人与成员」「开通与邀请」
  private async people(orgId: string) {
    const members = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, createdAt: users.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(users.createdAt);
    const invites = await this.db
      .select({
        id: organizationInvitations.id,
        email: organizationInvitations.email,
        name: organizationInvitations.name,
        phone: organizationInvitations.phone,
        role: organizationInvitations.role,
        createdAt: organizationInvitations.createdAt,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        revokedAt: organizationInvitations.revokedAt,
        invitedByName: users.name,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.invitedBy))
      .where(eq(organizationInvitations.orgId, orgId))
      .orderBy(desc(organizationInvitations.createdAt));
    return { members, invitations: invites.map((i) => ({ ...i, state: invitationState(i) })) };
  }

  // 组织详情「企业与任务」（只读）：每家企业最近的一个任务
  private async enterpriseTasks(orgId: string) {
    const ents = await this.db
      .select({ id: enterprises.id, name: enterprises.name })
      .from(enterprises)
      .where(eq(enterprises.orgId, orgId))
      .orderBy(enterprises.createdAt);
    const rows = await this.db
      .select({
        enterpriseId: tasks.enterpriseId,
        id: tasks.id,
        number: tasks.number,
        status: tasks.status,
        assignedExpertId: tasks.assignedExpertId,
        closedAt: tasks.closedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.createdAt));
    const latest = new Map<string, { id: string; number: string; stage: ReturnType<typeof operatorTaskStage> }>();
    for (const t of rows) {
      if (!latest.has(t.enterpriseId)) latest.set(t.enterpriseId, { id: t.id, number: t.number, stage: operatorTaskStage(t) });
    }
    return ents.map((e) => ({ ...e, task: latest.get(e.id) ?? null }));
  }

  private guard(user: SessionUser) {
    if (!canManageOrganizations(user)) throw new ForbiddenException('只有耕云运营可以管理客户组织');
  }

  private async load(id: string) {
    const [org] = await this.db
      .select(columns)
      .from(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.kind, 'customer')))
      .limit(1);
    if (!org) throw new NotFoundException(NOT_FOUND);
    return org;
  }

  private async latestContracts(orgIds: string[]) {
    const map = new Map<string, { number: string; scopeKind: 'single' | 'annual' | null; scopeEnterprises: number | null }>();
    if (orgIds.length === 0) return map;
    const rows = await this.db
      .select({
        orgId: organizationContracts.orgId,
        number: organizationContracts.number,
        scopeKind: organizationContracts.scopeKind,
        scopeEnterprises: organizationContracts.scopeEnterprises,
      })
      .from(organizationContracts)
      .where(inArray(organizationContracts.orgId, orgIds))
      .orderBy(desc(organizationContracts.createdAt));
    for (const r of rows) if (!map.has(r.orgId)) map.set(r.orgId, r);
    return map;
  }
}
