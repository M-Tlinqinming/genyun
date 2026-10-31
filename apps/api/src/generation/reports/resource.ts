// 生产安全应急资源调查报告。正文迁自旧仓库 lib/md-generator/reports.ts（generateResourceSurveyReportMd），
// 改动同风险评估报告；值班电话取客户填的 24 小时值班电话（旧稿误用企业联系电话），物资保管人与电话按应急组织人员带出。
import type { PlanInput } from '@genyun/shared';
import { MISSING, dash, fill, planContext, siteColumn, type PlanContext } from '../plan/context.ts';
import { buildReport, companyBasicTable, companyOverview, hazardFactorsTable, locationText } from './common.ts';

// 旧仓库建议补充的装备；企业已有的不再列
const RECOMMENDED: [string, string, string][] = [
  ['正压式空气呼吸器', '用于有限空间、烟气环境等专业应急救援', '2个'],
  ['担架', '用于伤员转移', '2个'],
  ['消防服', '用于初期火灾应急处置', '2套'],
  ['扩音器', '用于紧急疏散和现场指挥', '2个'],
  ['微型消防站', '用于火灾事故应急救援', '1个'],
];

function memberRows(ctx: PlanContext): string[] {
  const org = ctx.input.organization;
  const rows: string[] = [];
  const site = siteColumn(ctx);
  const add = (unit: string, role: string, p: { name: string; position?: string; phone?: string } | undefined, addressId?: string) => {
    if (!p?.name.trim()) return;
    rows.push(
      `| ${rows.length + 1} | ${unit} | ${p.name.trim()} | ${role} | ${dash(p.position)} | ${fill(p.phone)} |${site.on ? ` ${ctx.siteOf(addressId) || '全公司'} |` : ''}`,
    );
  };
  add('应急指挥部', '总指挥', org.commander);
  for (const d of org.deputies) add('应急指挥部', '副总指挥', d);
  for (const g of org.groups) {
    add(ctx.groupName(g), '组长', g.leader, g.addressId);
    for (const m of g.members) add(ctx.groupName(g), '组员', m, g.addressId);
  }
  return rows;
}

function resourceMarkdown(ctx: PlanContext): string {
  const { company, input, bureau, street } = ctx;
  const p = input.production;
  const a = input.agencies;
  const org = input.organization;
  const factors = [...new Set((input.expert.hazards ?? []).map((h) => h.factor.trim()).filter(Boolean))].join('、') || MISSING;
  const communication = org.groups.find((g) => g.kind === 'communication');
  const members = memberRows(ctx);
  const site = siteColumn(ctx);
  const supplies = p.emergencySupplies.map((s, i) => {
    const keeper = ctx.person(s.custodianId);
    const qty = s.quantity === undefined ? MISSING : `${s.quantity} ${s.unit ?? ''}`.trim();
    return `| ${i + 1} | ${fill(s.name)} | ${qty} | ${fill(s.location)} | ${keeper?.name || '/'} | ${keeper?.phone || '/'} |${site.cell(s.addressId)}`;
  });
  const kit = p.firstAidKit;
  const aid = kit?.answer === 'yes' ? kit.items.map((f, i) => `| ${i + 1} | ${fill(f.name)} | ${dash(f.quantity)} | ${dash(f.unit)} |`) : [];
  const existing = new Set([...p.emergencySupplies.map((s) => s.name.trim()), ...(kit?.answer === 'yes' ? kit.items.map((f) => f.name.trim()) : [])]);
  const recommended = RECOMMENDED.filter(([name]) => ![...existing].some((n) => n.includes(name)));
  const hospital = input.expert.facts?.hospital;
  const hospitalDistance = hospital?.distanceKm === undefined ? '/' : `约 ${hospital.distanceKm} 公里`;

  return [
    '# 单位内部应急资源',
    '## 依据',
    '1）《中华人民共和国突发事件应对法》；',
    '2）《中华人民共和国安全生产法》；',
    '3）《生产安全事故应急条例》；',
    '4）《生产安全事故应急预案管理办法》；',
    '5）《广东省安全生产条例》；',
    '6）《生产经营单位生产安全事故应急预案编制导则》GB/T 29639-2020；',
    '7）企业现场调查资料、应急组织资料、应急物资清单和外部联络资料。',
    '## 调查工作',
    '### 1）对象及范围',
    `${company}生产经营管理管辖区域内发生${factors}等各类生产安全事故并引起人身伤害及财产损失后，公司可利用的应急资源，包括内部应急人力资源、外部救援人力资源、内部应急物资、外部应急设施装备等。`,
    '### 2）调查工作程序',
    `成立以主要负责人为组长、安全管理人员及相关部门负责人为组员的生产安全事故应急资源调查小组，根据公司内部应急资源、周边企业可依托资源、就近政府应急队伍和应急资料开展调查，编写《${company}生产安全应急资源调查报告》。`,
    '## 公司基本情况',
    '### 1）企业概况',
    ...companyOverview(ctx),
    ...companyBasicTable(ctx, '1.3-1'),
    '### 2）公司所在地理位置',
    locationText(ctx),
    '### 3）公司生产过程主要风险状况',
    '主要危险源：根据周边环境、总平面布置、作业环境、场所特点等，参照《生产安全事故分类与编码》（GB 6441-2025），公司各区域主要危险、有害因素详见下表。',
    ...hazardFactorsTable(ctx, '1.3-2'),
    '## 公司内部人力和物资应急资源',
    '### 1）公司内部人力资源',
    '为认真编制切实可行的生产安全事故应急预案，公司结合内部人力资源和实际情况设置应急救援组织体系。公司内部应急小组成员联系方式如下。',
    '**表 1.4-1 各应急小组成员姓名联系方式**',
    `| 序号 | 小组 | 姓名 | 应急职务 | 职务或岗位 | 联系方式 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(members.length ? members : [`| 1 | 应急组织 | ${MISSING} | / | / | / |${site.on ? ' / |' : ''}`]),
    '### 2）通信与信息保障',
    '公司通过固定电话、移动电话、现场呼喊、企业通信群和应急通讯录进行信息报告、指挥调度和外部联络。应急通讯录应根据人员变化及时修订。',
    '**通信与信息保障表**',
    '| 序号 | 通信对象 | 联系方式 | 用途 |',
    '| --- | --- | --- | --- |',
    `| 1 | 企业 24 小时值班电话 | ${ctx.dutyPhone} | 企业内部报警 / 值班联络 |`,
    `| 2 | 总指挥 | ${fill(org.commander?.phone)} | 应急指挥启动 |`,
    `| 3 | ${communication ? ctx.groupName(communication) : '通讯联络组'} | ${communication ? fill(communication.leader?.phone) : '/'} | 信息报告 / 内外部联络 |`,
    ...[
      `| ${street} | ${a.streetOffice ? dash(a.streetOffice.phone) : MISSING} | 属地协调 |`,
      ...(ctx.park ? [`| ${ctx.park.manager} | ${ctx.park.dutyPhone ?? MISSING} | 事故先报园区 / 园区联动 |`] : []),
      `| ${bureau} | ${a.emergencyBureau?.phone || '12350 / 属地值班电话'} | 事故报告 / 资源调度 |`,
    ].map((r, i) => `| ${i + 4} ${r}`),
    '### 3）应急物资保障情况',
    '公司根据事故风险类型和现场处置需要配置消防器材、应急照明、疏散指示、警戒隔离、急救药品等应急物资装备。现有应急物资及装备如下。',
    '**表 1.4-2 公司内现有应急物资及装备一览表**',
    `| 序号 | 设施名称 | 数量 | 位置 | 保管人 | 联系电话 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(supplies.length ? supplies : [`| 1 | ${MISSING} | / | / | / | / |${site.on ? ' / |' : ''}`]),
    '**急救药箱药品清单**',
    '| 序号 | 药品名称 | 数量 | 单位 |',
    '| --- | --- | --- | --- |',
    ...(aid.length ? aid : [`| 1 | ${kit?.answer === 'no' ? '未配置急救药箱' : MISSING} | / | / |`]),
    '# 单位外部应急资源',
    '当事故超出公司内部先期处置能力时，应立即请求属地政府、消防救援、医疗急救、公安交通和周边可依托单位支援。单位外部应急资源如下。',
    '| 当地政府有关部门 / 外部资源 | 联系电话 | 备注 |',
    '| --- | --- | --- |',
    '| 报警 | 110 | 24 小时 |',
    '| 火警 | 119 | 24 小时 |',
    '| 交通 | 122 | 24 小时 |',
    '| 急救 | 120 | 24 小时 |',
    `| ${bureau} | ${a.emergencyBureau?.phone || '12350 / 属地值班电话'} | 事故报告 / 应急资源调度 |`,
    `| ${street} | ${a.streetOffice ? dash(a.streetOffice.phone) : MISSING} | 属地协调 / 周边疏散协助 |`,
    ...(ctx.park ? [`| ${ctx.park.manager} | ${ctx.park.dutyPhone ?? MISSING} | 事故先报园区 / 园区联动调度 |`] : []),
    ...(ctx.facts.hasRescueAgreements && ctx.rescueParties ? [`| ${ctx.rescueParties} | / | 救援协议单位 |`] : []),
    ...(ctx.facts.hasMutualAid && ctx.mutualAidParties ? [`| ${ctx.mutualAidParties} | / | 应急互助协议企业 |`] : []),
    `| ${a.fireDept?.name || '属地消防救援机构'} | ${a.fireDept?.phone || '119'} | 火灾扑救 / 抢险救援 |`,
    `| ${ctx.hospital} | 120 / 医院急诊 | ${hospitalDistance} |`,
    '# 应急资源差距分析',
    '**1）差距分析**',
    '本公司的应急资源及周边可依托的社会应急资源基本满足应急需求，具备应急救援或先期处置的基础能力。由于公司突发事件类型较多，各类事故造成的危害难以完全预测，公司自身专业救援能力有限，仍需加强应急资源储备、维护、培训和外部联动。',
    '**2）调查主要结论**',
    '本次应急资源调查从人、财、物三方面进行了调查和核对。公司已配备安全、消防、环保等要求必要的应急设施及装备；通过本次调查进一步摸清了周边政府配套公共应急资源及队伍。事故发生后，如能及时有效调用内部资源和外部资源，可满足初期处置和应急救援的基本需求。',
    '**补充完善应急装备清单**',
    '| 序号 | 物资名称 | 技术要求或功能要求 | 配备 | 备注 |',
    '| --- | --- | --- | --- | --- |',
    ...(recommended.length
      ? recommended.map(([name, req, qty], i) => `| ${i + 1} | ${name} | ${req} | ${qty} | 按风险变化动态补充 |`)
      : ['| 1 | 现有应急装备 | 定期检查、维护、补充 | 按现有清单执行 | 暂无新增建议 |']),
  ].join('\n');
}

export function buildResourceReport(input: PlanInput) {
  const ctx = planContext(input);
  return buildReport(ctx, 'resource', '生产安全应急资源调查报告', resourceMarkdown(ctx));
}
