import {
  adminInvitationSchema,
  chinaToday,
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
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { canManageOrganizations } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
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

const columns = {
  id: organizations.id,
  name: organizations.name,
  region: organizations.region,
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

type OrgRow = { activatedAt: Date | null; contractStartsAt: string | null; contractEndsAt: string | null };
const withState = <T extends OrgRow>(o: T) => ({
  ...o,
  state: orgServiceState({ ...o, activatedAt: o.activatedAt?.toISOString() ?? null }, chinaToday()),
});

// 运营管理客户组织：登记、修改资料、上传合同原件、开通（Paper 16 页 I02 与开通弹窗）。
// 客户、专业人员一律 403；不存在的组织和内部组织一律 404
@Controller('operator/organizations')
export class OperatorOrgsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(MAIL_OUTBOX) private readonly mailOutbox: boolean,
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
        openTasks: sql<number>`(select count(*)::int from tasks t where t.org_id = "organizations"."id" and t.closed_at is null)`,
      })
      .from(organizations)
      .where(eq(organizations.kind, 'customer'))
      .orderBy(desc(organizations.createdAt));
    const contracts = await this.latestContracts(rows.map((r) => r.id));
    return rows.map((r) => ({ ...withState(r), contract: contracts.get(r.id) ?? null }));
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const org = await this.load(id);
    const contracts = await this.latestContracts([id]);
    // 开通弹窗里显示最近上传的合同原件，关掉弹窗再打开不用重传
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
      .where(and(eq(files.orgId, id), eq(files.kind, 'contract')))
      .orderBy(desc(files.createdAt))
      .limit(1);
    return {
      ...withState(org),
      contract: contracts.get(id) ?? null,
      contractFile: contractFile ?? null,
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
    const parsed = orgRegisterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const [created] = await this.db
      .insert(organizations)
      .values({ ...parsed.data, kind: 'customer', registeredBy: user.id })
      .returning({ id: organizations.id });
    return withState(await this.load(created!.id));
  }

  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    await this.load(id);
    const parsed = orgRegisterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    await this.db.update(organizations).set(parsed.data).where(eq(organizations.id, id));
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

  // 开通：登记合同、合同有效期生效、给首位管理员发邀请。原件未上传或未确认到账不能开通
  @Post(':id/open')
  @HttpCode(200)
  async open(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    const org = await this.load(id);
    if (org.activatedAt) throw new ConflictException('这个组织已经开通了，续期请到组织详情里登记');

    const gaps = openingGaps((body ?? {}) as OrgOpenDraft);
    if (gaps.length > 0) {
      throw new BadRequestException({ statusCode: 400, message: `开通前还要填：${gaps.join('、')}`, gaps });
    }
    const parsed = orgOpenSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const d = parsed.data;

    const [contractFile] = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, d.contractFileId), eq(files.orgId, id), eq(files.kind, 'contract')))
      .limit(1);
    if (!contractFile) throw new BadRequestException('合同原件找不到了，请重新上传');
    await this.rejectExistingAccount(d.adminEmail);

    const invitation = await this.db.transaction(async (tx) => {
      // 并发开通时只有一次能成功
      const [updated] = await tx
        .update(organizations)
        .set({ contractStartsAt: d.startsAt, contractEndsAt: d.endsAt, activatedAt: new Date(), activatedBy: user.id })
        .where(and(eq(organizations.id, id), isNull(organizations.activatedAt)))
        .returning({ id: organizations.id });
      if (!updated) throw new ConflictException('这个组织已经开通了，续期请到组织详情里登记');
      await tx.insert(organizationContracts).values({
        orgId: id,
        number: d.contractNumber,
        scopeKind: d.scopeKind,
        scopeEnterprises: d.scopeEnterprises,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        fileId: d.contractFileId,
        paymentConfirmedBy: user.id,
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
      .where(eq(tasks.orgId, orgId))
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
    const map = new Map<string, { number: string; scopeKind: 'single' | 'annual'; scopeEnterprises: number | null }>();
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
