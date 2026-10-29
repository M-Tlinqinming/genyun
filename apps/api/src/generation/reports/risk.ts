// 生产安全事故风险评估报告。正文迁自旧仓库 lib/md-generator/reports.ts（generateRiskAssessmentReportMd），
// 改动同应急预案：中文全角标点；旧稿里「以企业 E4 模块填报为准」这类内部说法改为「（待补充）」；
// 成立日期、周边环境取专家补充的事实。排版暂与应急预案相同（第 9c 项按实际案例定）。
import { RISK_LEVELS, riskLevel, riskScore, type PlanInput } from '@genyun/shared';
import { MISSING, dash, fill, planContext, type PlanContext } from '../plan/context.ts';
import { buildReport, companyBasicTable, companyOverview, hazardFactorsTable, locationText } from './common.ts';

function hazardRows(ctx: PlanContext) {
  return (ctx.input.expert.hazards ?? []).map((h) => {
    const d = riskScore(h);
    return { ...h, d, level: riskLevel(d) ?? '—' };
  });
}

function uniqueFactors(ctx: PlanContext): string[] {
  return [...new Set((ctx.input.expert.hazards ?? []).map((h) => h.factor.trim()).filter(Boolean))];
}

/** 按风险程度从高到低分组 */
function byLevel(ctx: PlanContext): { level: string; factors: string[] }[] {
  const rows = hazardRows(ctx);
  return [...[...RISK_LEVELS].reverse(), '—']
    .map((level) => ({ level, factors: [...new Set(rows.filter((r) => r.level === level).map((r) => r.factor))] }))
    .filter((g) => g.factors.length > 0);
}

const LEC_TABLES = [
  '**表 2.2-1 事故发生的可能性分值**',
  '| 分数值 | 事故发生的可能性 | 分数值 | 事故发生的可能性 |',
  '| --- | --- | --- | --- |',
  '| 10 | 完全可以预料到 | 0.5 | 很不可能，可以设想 |',
  '| 6 | 相当可能 | 0.2 | 极不可能 |',
  '| 3 | 可能，但不经常 | 0.1 | 实际不可能 |',
  '| 1 | 可能性小，完全意外 | / | / |',
  '**表 2.2-2 暴露于危险环境的分值**',
  '| 分数值 | 频繁程度 | 分数值 | 频繁程度 |',
  '| --- | --- | --- | --- |',
  '| 10 | 连续暴露 | 2 | 每月一次暴露 |',
  '| 6 | 每天工作时间内暴露 | 1 | 每年几次暴露 |',
  '| 3 | 每周一次暴露 | 0.5 | 非常罕见的暴露 |',
  '**表 2.2-3 发生事故可能造成后果的分值**',
  '| 分数值 | 可能造成的后果 | 分数值 | 可能造成的后果 |',
  '| --- | --- | --- | --- |',
  '| 100 | 大灾难，许多人死亡 | 7 | 严重，重伤 |',
  '| 40 | 灾难，数人死亡 | 3 | 重大，致残 |',
  '| 15 | 非常严重，一人死亡 | 1 | 需要救护 |',
  '**表 2.2-4 危险性等级划分标准**',
  '| D 值 | 风险程度 | 管控要求 |',
  '| --- | --- | --- |',
  '| D ≤ 20 | 稍有危险 | 可接受，纳入日常巡查 |',
  '| 20 < D ≤ 70 | 一般危险 | 需要关注，落实日常控制措施 |',
  '| 70 < D ≤ 160 | 显著危险 | 需要整改，纳入重点管理 |',
  '| 160 < D ≤ 320 | 高度危险 | 立即整改，必要时停止相关作业 |',
  '| D > 320 | 极其危险 | 立即停止作业，根除危险源 |',
];

function riskMarkdown(ctx: PlanContext): string {
  const { company, input } = ctx;
  const p = input.production;
  const facts = input.expert.facts ?? {};
  const factors = uniqueFactors(ctx).join('、') || MISSING;
  const hazardous = p.materials.filter((m) => ctx.hazardous.includes(m.name)).map((m) => m.name);
  const rows = hazardRows(ctx);
  const top = rows
    .filter((r) => r.d !== undefined)
    .sort((a, b) => b.d! - a.d!)
    .slice(0, 5);
  const groups = byLevel(ctx);
  const grouped = groups
    .filter((g) => g.level !== '—')
    .map((g) => `${g.level}：${g.factors.join('、')}`)
    .join('；');
  const steps = p.processFlow.steps.map((s) => s.name);

  return [
    '# 危险有害因素辨识',
    '## 依据',
    '1）有关法律法规',
    '（1）《中华人民共和国突发事件应对法》；',
    '（2）《中华人民共和国安全生产法》；',
    '（3）《中华人民共和国职业病防治法》；',
    '（4）《中华人民共和国消防法》；',
    '（5）《生产安全事故应急条例》；',
    '（6）《生产安全事故报告和调查处理条例》；',
    '（7）《生产安全事故应急预案管理办法》；',
    '（8）《广东省安全生产条例》；',
    '（9）其他有关法律、法规、规章和规范性文件。',
    '2）有关技术规范、指导参考文件',
    '（1）《危险化学品重大危险源辨识》GB 18218-2018；',
    '（2）《生产经营单位生产安全事故应急预案编制导则》GB/T 29639-2020；',
    '（3）《企业职工伤亡事故分类》GB 6441；',
    '（4）《生产过程安全卫生要求总则》GB/T 12801；',
    '（5）《生产安全事故应急演练基本规范》AQ/T 9007；',
    '（6）企业现场踏勘、基础资料、设备设施清单和危险有害因素辨识资料。',
    '## 公司基本概况',
    '### 1）企业概况',
    ...companyOverview(ctx),
    ...companyBasicTable(ctx, '1.2-1'),
    '### 2）公司所在地理位置',
    locationText(ctx),
    '### 3）产品生产工艺流程图',
    ...(steps.length
      ? ['主要产品工艺简述、流程图如下：', '[[figure:process-flow]]', '**主要产品生产工艺流程图**']
      : [`主要产品生产工艺：${fill(p.processFlow.description)}。`]),
    '### 4）主要生产设备设施',
    '**表 1.2-2 主要生产设备设施**',
    '| 设备名称 | 规格型号 | 数量 | 单位 | 使用部门 | 存放地点 | 使用状况 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(p.equipment.length
      ? p.equipment.map((e) => `| ${fill(e.name)} | ${dash(e.spec)} | ${dash(e.quantity)} | ${dash(e.unit)} | ${dash(e.department)} | ${dash(e.location)} | ${dash(e.condition)} |`)
      : [`| ${MISSING} | / | / | / | / | / | / |`]),
    '### 5）主要原辅材料贮存量',
    '**表 1.2-3 主要原辅材料贮存量表**',
    '| 名称 | CAS号 | 年用量（t） | 日常最大储存量（t） | 储存位置 | 危险化学品 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(p.materials.length
      ? p.materials.map(
          (m) => `| ${fill(m.name)} | ${dash(m.casNumber)} | ${dash(m.annualUsageTons)} | ${dash(m.maxStorageTons)} | ${dash(m.storageLocation)} | ${ctx.hazardous.includes(m.name) ? '是' : '否'} |`,
        )
      : [`| ${MISSING} | / | / | / | / | / |`]),
    '### 6）主要建（构）筑物情况',
    '**表 1.2-4 主要建（构）筑物情况一览表**',
    '| 序号 | 建（构）筑物名称 | 耐火等级 | 层数 | 建筑面积（m²） | 备注 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(p.buildings.length
      ? p.buildings.map(
          (b, i) => `| ${i + 1} | ${fill(b.name)} | ${dash(facts.buildings?.[b.name]?.fireRating)} | ${dash(b.floors)} | ${dash(b.floorAreaM2)} | ${dash(b.remarks)} |`,
        )
      : [`| 1 | ${MISSING} | / | / | / | / |`]),
    '## 危险有害因素辨识',
    '### 1）危险源',
    `根据周边环境、总平面布置、作业环境、场所特点等，遵循科学性、系统性、全面性和预测性的原则，参照《企业职工伤亡事故分类》，对${company}各作业场所危险源进行辨识。`,
    ...hazardFactorsTable(ctx, '1.3-1'),
    '### 2）危险有害因素分析',
    `经辨识，${company}生产经营过程中可能涉及的主要危险有害因素包括：${factors}。上述因素主要分布于生产车间、配电设施、物料暂存区域、厂内道路、办公及辅助区域等场所，需结合岗位操作规程、设备维护、消防设施、个体防护和现场巡查持续控制。`,
    '### 3）重大危险源辨识',
    hazardous.length
      ? `企业使用的危险化学品或危险物料包括：${hazardous.join('、')}。是否构成危险化学品重大危险源，应结合最大储存量、临界量和现场储存方式按 GB 18218-2018 进行专项辨识；本报告不对未提供阈值数据的物料作推定。`
      : '根据企业提供的资料，未识别出危险化学品重大危险源相关物料；如后续新增危险化学品储存或使用，应按 GB 18218-2018 重新开展辨识。',
    '### 4）危险有害因素分析结果',
    '本次危险有害因素辨识结果作为后续事故风险分析、应急资源调查和应急处置方案编制的基础。各风险因素的 LEC 半定量评价结果详见第 2 章。',
    '# 事故风险分析',
    '## 现有安全生产管理情况',
    '公司已建立基础安全生产管理制度，对主要生产设备、消防设施、应急物资、岗位操作和人员培训进行日常管理。现有事故风险防控措施主要包括：配置消防器材和应急照明，设置安全出口及疏散标志，对特种作业和重点岗位开展培训，对危险源实施日常检查，并建立应急组织和通讯联络机制。',
    '## 事故风险分析',
    '### 1）事故发生可能性分析',
    `本报告采用作业条件危险性评估法（LEC 法）对${company}主要危险有害因素进行半定量评估。LEC 法用与系统风险有关的三种因素指标值的乘积评价危险程度，即 **D = L×E×C**。其中 L 为事故发生可能性，E 为人员暴露于危险环境的频繁程度，C 为事故可能造成的后果，D 为危险性分值。`,
    ...LEC_TABLES,
    '### 2）事故风险分析结果',
    '**表 2.2-5 作业条件危险、危害因素评估表**',
    '| 序号 | 危害因素 | L | E | C | D=L×E×C | 风险程度 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(rows.length
      ? rows.map((r, i) => `| ${i + 1} | ${fill(r.factor)} | ${dash(r.l)} | ${dash(r.e)} | ${dash(r.c)} | ${dash(r.d)} | ${r.level} |`)
      : [`| 1 | ${MISSING} | / | / | / | / | / |`]),
    '# 事故风险评价',
    '## 事故风险程度',
    '本报告以 LEC 半定量评价结果作为事故风险程度划定依据。LSR 明细评价需要单独的 L、S、R 评价数据支撑；在未形成 LSR 专项评价数据前，本报告不将 LEC 分值机械换算为 LSR 分值。',
    '| 风险程度 | 危险有害因素 |',
    '| --- | --- |',
    ...(groups.length ? groups.map((g) => `| ${g.level} | ${g.factors.join('、')} |`) : [`| / | ${MISSING} |`]),
    '## 划定事故风险等级',
    `根据 LEC 法评估结果，当前风险值较高的危险有害因素为：${top.length ? top.map((r) => `${r.factor}（D=${r.d}）`).join('、') : MISSING}。企业应将一般危险及以上风险纳入日常巡查和重点管理，将涉及火灾、爆炸、触电、机械伤害、危险物料泄漏等风险的岗位作为培训、演练和应急准备重点。`,
    '# 结论建议',
    '## 评估结论',
    `1）${company}生产过程中可能存在的主要危险因素有：${factors}。`,
    `2）通过作业条件危险性评估法对公司主要危险场所事故发生可能性进行半定量评估，由 LEC 法评估结果可知，公司生产过程中危险有害因素风险程度为：${grouped || MISSING}。`,
    '## 建议',
    '### 1）现有控制及应急措施差距分析',
    '公司现有事故控制措施和应急保障措施总体可支撑初期处置，但仍需持续明确应急组织成员职责，保持应急资源可调用状态，加强关键岗位培训和演练，并根据风险评估结果动态完善应急管理制度。',
    '### 2）制定完善生产安全事故风险防控和应急措施',
    '（1）防火、防爆、防静电的对策措施：危险区域设置警示标志，动火作业严格审批，作业期间落实现场监护，作业结束后共同检查并清理现场。',
    '（2）消防和电气设施的安全对策措施：消防器材由专人管理，定期检查、维护和更换；临时用电、设备接线和电气检修应按制度审批并落实防护。',
    '（3）管理方面的对策措施：落实安全生产责任制，加强厂区巡查、岗位操作规程培训、应急演练和隐患整改闭环管理。',
    '（4）其他方面的对策措施：对存在事故隐患和缺陷的危险源应及时整改；不能立即整改的，必须采取切实可行的临时安全措施，防止事故发生。',
  ].join('\n');
}

export function buildRiskReport(input: PlanInput) {
  const ctx = planContext(input);
  return buildReport(ctx, 'risk', '生产安全事故风险评估报告', riskMarkdown(ctx));
}
