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
// 数据库里没有数据或读不到时一律退回内置数据（packages/shared），业务照常进行
@Injectable()
export class KnowledgeService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await this.reloadHolidays();
    this.timer = setInterval(() => void this.reloadHolidays(), HOLIDAY_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // 节假日表读进内存（工作日计算是同步的，见 packages/shared/src/workdays.ts）
  async reloadHolidays(): Promise<void> {
    try {
      const rows = await this.db.select({ date: holidays.date, kind: holidays.kind, name: holidays.name }).from(holidays);
      setHolidayCalendar(rows as HolidayEntry[]);
    } catch (err) {
      console.error(`节假日读取失败，先用内置的节假日表：${err instanceof Error ? err.message : 'unknown'}`);
      setHolidayCalendar(null);
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

  // 客户保存时核对模板编号：知识库里有（停用的也算，已选用的企业不受影响），或是内置模板
  async templateExists(id: string): Promise<boolean> {
    if (BUILTIN_PROCESS_TEMPLATES.some((t) => t.id === id)) return true;
    const [row] = await this.db.select({ id: processTemplates.id }).from(processTemplates).where(eq(processTemplates.id, id));
    return Boolean(row);
  }
}
