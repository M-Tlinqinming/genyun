import {
  agencyDistrictsOf,
  BUILTIN_AGENCY_DISTRICTS,
  BUILTIN_PROCESS_TEMPLATES,
  type AgencyDistrict,
  type HolidayEntry,
  type KnowledgeAgency,
  type KnowledgeRegion,
  type ProcessTemplate,
  setHolidayCalendar,
} from '@genyun/shared';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { DATABASE, type Database } from '../db/client.ts';
import { agencyRegions, holidays, localAgencies, processTemplates, users } from '../db/schema.ts';

// 几台接口服务各自缓存节假日表，别的服务改了以后最晚这么久跟上
const HOLIDAY_REFRESH_MS = 5 * 60_000;

// 知识库给业务用的读取（M3 第 5 项）：生成文档读属地应急机构、客户选工艺模板、工作日计算读节假日。
// 属地机构、工艺模板在数据库没有数据或读不到时退回内置数据（packages/shared）；节假日见 reloadHolidays
@Injectable()
export class KnowledgeService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private holidaysLoaded = false;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await this.reloadHolidays();
    this.timer = setInterval(() => void this.reloadHolidays(), HOLIDAY_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // 节假日表读进内存（工作日计算是同步的，见 packages/shared/src/workdays.ts）。
  // 读到空表就按空表算（只跳过周末）；启动时第一次就读不到才用内置表，之后刷新失败保留上次读到的
  async reloadHolidays(): Promise<void> {
    try {
      const rows = await this.db.select({ date: holidays.date, kind: holidays.kind, name: holidays.name }).from(holidays);
      setHolidayCalendar(rows as HolidayEntry[]);
      this.holidaysLoaded = true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      if (this.holidaysLoaded) {
        console.error(`节假日刷新失败，继续用上次读到的节假日表：${reason}`);
      } else {
        console.error(`节假日读取失败，先用内置的节假日表：${reason}`);
        setHolidayCalendar(null);
      }
    }
  }

  // 运营页面用的完整列表（含停用的）
  async regions(): Promise<KnowledgeRegion[]> {
    const [regionRows, agencyRows] = await Promise.all([
      this.db.select().from(agencyRegions).orderBy(asc(agencyRegions.sortOrder), asc(agencyRegions.createdAt)),
      this.db
        .select({ agency: localAgencies, verifiedByName: users.name })
        .from(localAgencies)
        .leftJoin(users, eq(users.id, localAgencies.verifiedBy))
        .orderBy(asc(localAgencies.sortOrder), asc(localAgencies.createdAt)),
    ]);
    return regionRows.map((r) => ({
      id: r.id,
      province: r.province,
      city: r.city,
      name: r.name,
      aliases: r.aliases,
      plan: r.plan,
      agencies: agencyRows
        .filter((a) => a.agency.regionId === r.id)
        .map(({ agency: a, verifiedByName }): KnowledgeAgency => ({
          id: a.id,
          regionId: a.regionId,
          category: a.category,
          name: a.name,
          phone: a.phone,
          area: a.area,
          aliases: a.aliases,
          plan: a.plan,
          note: a.note,
          disabled: a.disabledAt !== null,
          verifiedAt: a.verifiedAt?.toISOString() ?? null,
          verifiedByName: a.verifiedAt ? verifiedByName : null,
        })),
    }));
  }

  // 生成文档用的属地机构表（每次生成时现读，运营改了马上用于之后的生成）
  async agencyDistricts(): Promise<AgencyDistrict[]> {
    try {
      return agencyDistrictsOf(await this.regions()) ?? BUILTIN_AGENCY_DISTRICTS;
    } catch (err) {
      console.error(`属地应急机构读取失败，先用内置数据：${err instanceof Error ? err.message : 'unknown'}`);
      return BUILTIN_AGENCY_DISTRICTS;
    }
  }

  // 客户能选的工艺模板：已发布、没停用的那一版（只带工序和设备）
  async publishedTemplates(): Promise<ProcessTemplate[]> {
    try {
      const all = await this.db.select({ id: processTemplates.id }).from(processTemplates).limit(1);
      if (all.length === 0) return [...BUILTIN_PROCESS_TEMPLATES];
      const rows = await this.db
        .select()
        .from(processTemplates)
        .where(and(isNull(processTemplates.disabledAt), isNotNull(processTemplates.publishedAt)))
        .orderBy(asc(processTemplates.sortOrder), asc(processTemplates.createdAt));
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        keywords: r.keywords,
        steps: r.steps.map((s) => ({ name: s.name, equipment: s.equipment })),
      }));
    } catch (err) {
      console.error(`工艺模板读取失败，先用内置模板：${err instanceof Error ? err.message : 'unknown'}`);
      return [...BUILTIN_PROCESS_TEMPLATES];
    }
  }

  // 客户新换模板时核对：必须是客户现在能选的（已发布、没停用）。没换模板的保存不查，已选用停用模板的企业不受影响
  async templateSelectable(id: string): Promise<boolean> {
    return (await this.publishedTemplates()).some((t) => t.id === id);
  }
}
