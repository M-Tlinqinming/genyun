// 风险评估报告与应急资源调查报告共用的部分（迁自旧仓库 lib/md-generator/reports.ts）：
// 企业概况、企业基本情况表、地理位置、危险有害因素表，以及把 Markdown 正文拼成交付文档。
// 章用「1.」、节用「1.1」，编号后不空格（按专家稿，Martin 2026-10-31 确认）；再往下（1）企业概况）是加粗段落。
import { flowOptionsOf, processFlowSvg, workplacesOf, type DeliveryDocument, type DocumentKind } from '@genyun/shared';
import { svgToPng } from '../word/png.ts';
import { MISSING, cnDate, dash, fill, type PlanContext } from '../plan/context.ts';
import { parseMarkdown, toSections, type Figure } from '../plan/markdown.ts';

export function companyOverview(ctx: PlanContext): string[] {
  const { company, input } = ctx;
  const b = input.basic;
  const established = input.expert.facts?.establishedDate ? `成立于${cnDate(input.expert.facts.establishedDate)}，` : '';
  const tech = b.technicalManagementCount === undefined ? '' : `，技术管理人员 ${b.technicalManagementCount} 人`;
  const safety = b.safetyManagementCount === undefined ? '' : `，安全管理人员 ${b.safetyManagementCount} 人`;
  return [
    `${company}${established}注册地址为${fill(b.registeredAddress?.detail)}；据营业执照，统一社会信用代码为 ${fill(b.socialCreditCode)}，法定代表人为${fill(b.legalRepresentative)}，注册资本为 ${dash(b.registeredCapital)}。企业经营范围为：${fill(b.businessScope)}。主要产品 / 服务为：${fill(b.mainProducts)}。`,
    `${company}现有职工 ${fill(b.employeeCount)} 人${tech}${safety}。企业规模、行业分类及安全管理要求以企业提供的资料、营业执照和属地监管要求为准。`,
  ];
}

export function companyBasicTable(ctx: PlanContext, no: string): string[] {
  const b = ctx.input.basic;
  const mark = (v: string) => (b.economicNature === v ? '☑' : '□');
  return [
    `**表${no}企业基本情况表**`,
    '| 项目 | 内容 |',
    '| --- | --- |',
    `| 公司名称 | ${ctx.company} |`,
    `| 注册地址 | ${fill(b.registeredAddress?.detail)} |`,
    `| 邮政编码 | ${dash(b.postalCode)} |`,
    `| 联系电话 | ${dash(b.contactPhone)} |`,
    `| 传真 | ${dash(b.fax)} |`,
    `| 联系人 | ${dash(b.contactPerson)} |`,
    `| 公司网址 | ${dash(b.website)} |`,
    `| 电子邮箱 | ${dash(b.email)} |`,
    `| 公司类型 | ${dash(b.companyType)} |`,
    `| 登记机关 | ${dash(b.registrationAuthority)} |`,
    `| 经济性质 | 全民所有制 ${mark('全民所有制')} 集体所有制 ${mark('集体所有制')} 私有制 ${mark('私有制')} 其它 ${mark('其它')} |`,
    `| 统一社会信用代码 | ${fill(b.socialCreditCode)} |`,
    `| 法定代表人 | ${fill(b.legalRepresentative)} |`,
    `| 主管负责人 | ${dash(b.responsiblePerson)} |`,
    `| 职工人数 | ${b.employeeCount === undefined ? MISSING : `${b.employeeCount} 人`} |`,
    `| 技术管理人数 | ${b.technicalManagementCount === undefined ? '—' : `${b.technicalManagementCount} 人`} |`,
    `| 安全管理人数 | ${b.safetyManagementCount === undefined ? '—' : `${b.safetyManagementCount} 人`} |`,
    `| 注册资本 | ${dash(b.registeredCapital)} |`,
    `| 固定资产 | ${dash(b.fixedAssets)} |`,
    `| 上年销售额 | ${dash(b.lastYearRevenue)} |`,
  ];
}

export function locationText(ctx: PlanContext): string {
  const { input } = ctx;
  const address = fill(input.location.siteAddress.detail || input.basic.registeredAddress?.detail);
  // 一照多址：列出全部生产经营地址
  const where = ctx.addresses.length
    ? `生产经营地址共 ${ctx.addresses.length} 处：${ctx.addresses.map((a) => a.address).join('；')}`
    : `位于${address}`;
  return `${ctx.company}${where}。公司所在地理位置、周边道路、相邻企业、居民区及其他敏感目标以现场踏勘和属地地图核实结果为准。周边环境及重大危险源情况：${fill(input.expert.facts?.surroundings)}`;
}

export function hazardFactorsTable(ctx: PlanContext, no: string): string[] {
  const byPlace = new Map<string, string[]>();
  // 一条危险源可以有多个场所（「、」分隔），按单个场所汇总
  for (const h of ctx.input.expert.hazards ?? []) {
    const site = ctx.siteOf(h.addressId);
    for (const w of workplacesOf(h.workplace).length ? workplacesOf(h.workplace) : ['未分类作业场所']) {
      const place = site ? `${site} ${w}` : w;
      const list = byPlace.get(place) ?? [];
      if (h.factor.trim() && !list.includes(h.factor.trim())) list.push(h.factor.trim());
      byPlace.set(place, list);
    }
  }
  return [
    `**表${no}主要危险有害因素**`,
    '| 序号 | 作业场所 | 主要危险、有害因素 | 备注 |',
    '| --- | --- | --- | --- |',
    ...(byPlace.size ? [...byPlace].map(([place, f], i) => `| ${i + 1} | ${place} | ${f.join('、') || '/'} | / |`) : [`| 1 | ${MISSING} | / | / |`]),
  ];
}

/** Markdown 正文（# 章、## 节、### 及以下为加粗段落）→ 交付文档；封面写编制单位与编制日期 */
export function buildReport(ctx: PlanContext, kind: DocumentKind, name: string, markdown: string): DeliveryDocument {
  const steps = ctx.input.production.processFlow.steps.map((s) => s.name);
  const figures: Record<string, Figure> = steps.length
    ? {
        'process-flow': {
          type: 'figure',
          ...svgToPng(processFlowSvg(steps, flowOptionsOf(steps, ctx.input.expert.figures?.process)).svg),
          placement: 'inline',
        },
      }
    : {};
  const parsed = parseMarkdown(markdown, figures);
  return {
    kind,
    title: `${ctx.company}${name}`,
    cover: { company: ctx.company, name, lines: [`编制单位：${ctx.company}`], dates: [`编制日期：${cnDate(ctx.input.issuedOn)}`] },
    frontPages: [],
    sections: toSections(parsed.sections, kind, {
      maxDepth: 2,
      title: (path, t) => (path.length === 1 ? `${path[0]}.${t}` : `${path.join('.')}${t}`),
    }),
  };
}
