// 生产安全事故风险评估报告。正文迁自旧仓库 lib/md-generator/reports.ts（generateRiskAssessmentReportMd），
// 改动同应急预案：中文全角标点；旧稿里「以企业 E4 模块填报为准」这类内部说法改为「（待补充）」；
// 成立日期、周边环境取专家补充的事实。排版暂与应急预案相同（第 9c 项按实际案例定）。
import { RISK_LEVELS, riskLevel, riskScore, workplacesOf, type PlanInput } from '@genyun/shared';
import { MISSING, dash, fill, planContext, siteColumn, type PlanContext } from '../plan/context.ts';
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

const list = (xs: string[], fallback: string) => (xs.length ? xs.join('、') : fallback);

/**
 * 危险有害因素分析：每类事故一段（写法参照世祥、千利两家风险评估结论），场所取危险源辨识，
 * 设备、物料、熔融金属按企业资料带出；没有对应写法的事故类型只写场所。
 */
function factorParagraphs(ctx: PlanContext): string[] {
  const s = ctx.signals;
  const chem = ctx.hazardous.length ? `${ctx.hazardous.join('、')}等危险化学品` : '危险化学品';
  const liquids = list(s.flammableLiquids, '可燃液体');
  const text: [RegExp, () => string][] = [
    [/可燃液体蒸气爆炸/, () => `${liquids}挥发产生的蒸气在通风不良处积聚，达到爆炸极限后遇明火、电火花、静电或高温，可能发生蒸气爆炸，并引发火灾。`],
    [/可燃气体爆炸/, () => `${list(s.combustibleGases, '可燃气体')}从${s.gasPipeline ? '管道、阀门、' : ''}${s.gasTanks ? '储罐、' : ''}气瓶或用气设备处泄漏，与空气混合达到爆炸极限，遇明火、电火花或高温，可能发生爆炸，并引发火灾。`],
    [/高温熔融物爆炸/, () => `${list(s.meltTypes, '高温熔融金属')}等高温熔融物遇水、潮湿炉料或模具，水分急剧汽化，可能发生蒸气爆炸，熔融物喷溅造成灼烫和火灾。`],
    [/粉尘爆炸/, () => `${list(s.dustSources, '产尘')}等工序产生${s.dustKinds.length ? s.dustKinds.join('、') : '可燃粉尘'}，清扫不及时、除尘不畅、粉尘浓度达到爆炸极限时，遇火花、高温或静电可能发生粉尘爆炸，并可能扬起积尘引发二次爆炸。`],
    [/管道爆炸/, () => '压力管道因腐蚀减薄、焊缝缺陷、超压运行或安全附件失灵，可能发生破裂爆炸，介质喷出伤人。'],
    [/容器爆炸/, () => `${list(s.pressureVessels, '压力容器')}因罐体腐蚀老化、安全阀和压力表等安全附件失灵、超压运行或违规操作，可能发生物理爆炸，冲击波和碎片伤人，爆炸产生的高温还可能引燃周围可燃物。`],
    [/火灾/, () => `电气线路和设备过载、短路、接触不良产生高温或电火花，引燃周围可燃物；${s.flammableLiquids.length ? `使用${liquids}等易燃液体，通风不良时蒸气与空气形成爆炸性混合物，遇明火、电火花可能引发火灾；` : ''}${s.lithium ? `${s.lithiumItems.join('、')}受挤压、短路、过充或损坏时可能发生热失控起火，扑灭后仍可能复燃；` : ''}物料和包装材料堆放过多、动火作业管理不严、违规吸烟等，也可能引发火灾事故。`],
    [/触电/, () => '用电场所电气线路、设备绝缘老化破损，防护罩缺失，接地、接零或漏电保护失效，或违章带电作业，人体触及带电体可能发生触电。'],
    [/机械/, () => `${list(s.dangerMachines, '生产')}等机械设备防护装置缺失或失效、维修保养不当、违章操作时，运动部件或飞出物与人体接触，可能造成挤压、剪切、卷入、绞伤等伤害。`],
    [/物体打击/, () => '货物、物料堆放不稳或堆垛过高发生倒塌，高处物件固定不牢坠落，设备带病运行或防护不足导致物体飞出，均可能砸伤作业人员。'],
    [/灼烫/, () => `${s.meltTypes.length ? `${s.meltTypes.join('、')}等高温熔融金属喷溅、` : ''}高温设备表面和焊接维修作业可能造成物理灼烫；${ctx.hazardous.length ? `接触${chem}可能造成化学灼伤。` : '操作中应做好隔热防护。'}`],
    [/道路/, () => '自备车辆道路运输中因疲劳驾驶、超速、车辆故障或路况不良，可能发生交通事故。'],
    [/车辆/, () => `${s.internalVehicles.length ? `${s.internalVehicles.join('、')}等厂内车辆` : '进出厂区的货车等车辆'}因驾驶员操作不当、车辆故障、视线不良或人车混行，可能发生碰撞、碾压、倾翻。`],
    [/起重/, () => '起重机械在运行、检修过程中因吊具或钢丝绳失效、超载、误操作，可能发生起重物坠落、挤压、倾覆等事故。'],
    [/泄漏/, () => `${chem}在储存、转运、使用中因容器破损、阀门密封失效或操作不当发生泄漏，可能引发火灾、中毒或环境污染。`],
    [/高处坠落/, () => '在离基准面 2 m 以上的平台、梯子、屋面作业时，护栏缺失或破损、未系安全带、无人监护，可能发生高处坠落。'],
    [/跌落/, () => '在楼梯、平台、车辆或货物上作业、行走时，地面湿滑、照明不足或注意力不集中，可能跌落至地面造成伤害。'],
    [/中毒/, () => `${ctx.hazardous.length ? `${chem}泄漏逸散` : '有毒有害气体逸散'}、作业场所通风不良时，作业人员吸入或接触，可能发生急性中毒。`],
    [/窒息/, () => '惰性气体泄漏积聚或人员进入通风不良的场所，氧含量下降，可能导致人员窒息。'],
    [/坍塌/, () => '建（构）筑物、货架堆垛、临时搭建结构因设计施工缺陷、超载或老化，可能发生坍塌伤人。'],
    [/淹溺/, () => '消防水池、污水池等水体的防护栏、盖板、警示标志不足，人员检查、清理时违规操作，可能跌落水中发生淹溺。'],
    [/^其他(伤害)?$/, () => '搬运重物、手工操作可能导致扭伤、挫伤、割伤；地面沟坑无防护、通道堆放杂物可能导致摔伤、碰撞。另外，台风、雷击、暴雨、地震等自然灾害可能造成停电、设备损坏，并引发次生事故。'],
  ];
  const places = new Map<string, string[]>();
  for (const h of ctx.input.expert.hazards ?? []) {
    const f = h.factor.trim();
    if (!f) continue;
    const ps = places.get(f) ?? [];
    const site = ctx.siteOf(h.addressId);
    for (const w of workplacesOf(h.workplace)) if (!ps.includes(site ? `${site}${w}` : w)) ps.push(site ? `${site}${w}` : w);
    places.set(f, ps);
  }
  return [...places].map(([factor, ps], i) => {
    const where = ps.length ? `主要场所：${ps.join('、')}。` : '';
    const body = text.find(([re]) => re.test(factor))?.[1]() ?? '应结合岗位操作规程、设备维护和现场检查加强控制。';
    return `（${i + 1}）${factor}：${where}${body}`;
  });
}

// GB 18218-2018 表 1 的临界量（t），只收常见、核对过的几种；其余由专家核定
const CRITICAL_TONS: [names: string[], tons: number][] = [
  [['乙醇', '酒精'], 500],
  [['甲醇'], 500],
  [['汽油'], 200],
  [['丙酮'], 500],
  [['甲苯'], 500],
  [['乙酸乙酯'], 500],
  [['天然气'], 50],
  [['液化石油气', '液化气'], 50],
  [['氢气'], 5],
  [['乙炔'], 1],
  [['氧气', '液氧'], 200],
  [['氨气', '液氨'], 10],
  [['氯气', '液氯'], 5],
  [['环氧乙烷'], 10],
];
const criticalOf = (name: string) => CRITICAL_TONS.find(([names]) => names.some((n) => name.includes(n)))?.[1];

/** 重大危险源辨识：按最大储存量 q 与临界量 Q 算 ∑q/Q 给结论；临界量或储存量不详的写待补充 */
function majorHazard(ctx: PlanContext): string[] {
  const basis = '根据《危险化学品重大危险源辨识》（GB 18218-2018）的规定';
  const materials = ctx.input.production.materials.filter((m) => ctx.hazardous.includes(m.name));
  if (!materials.length) return [`${basis}，经辨识，公司生产经营过程中未储存、使用危险化学品，不构成危险化学品重大危险源。`];
  const rows = materials.map((m) => ({ name: m.name, q: m.maxStorageTons, Q: criticalOf(m.name) }));
  const ratio = (r: (typeof rows)[number]) => (r.q !== undefined && r.Q !== undefined ? r.q / r.Q : undefined);
  const known = rows.every((r) => ratio(r) !== undefined);
  const sum = rows.reduce((s, r) => s + (ratio(r) ?? 0), 0);
  const sumText = sum < 0.0001 ? sum.toExponential(1) : String(Math.round(sum * 10000) / 10000);
  return [
    '**表 1.3-2 危险化学品重大危险源辨识表**',
    '| 名称 | 最大储存量 q（t） | 临界量 Q（t） | q/Q |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => {
      const v = ratio(r);
      return `| ${r.name} | ${dash(r.q)} | ${r.Q ?? MISSING} | ${v === undefined ? '/' : Math.round(v * 10000) / 10000} |`;
    }),
    known
      ? sum < 1
        ? `${basis}，经辨识，∑q/Q = ${sumText} < 1，公司的危险化学品使用、暂存场所不构成危险化学品重大危险源。`
        : `${basis}，经辨识，∑q/Q = ${sumText} ≥ 1，公司构成危险化学品重大危险源，应按规定开展分级、登记建档，并报${ctx.bureau}备案。`
      : `${basis}，部分物料的临界量或最大储存量不详，辨识结论待核定后填写${MISSING}。`,
  ];
}

// 可能波及厂界外的事故类型
const SPREADING = /火灾|爆炸|泄漏|中毒/;

function analysisResult(ctx: PlanContext): string[] {
  const factors = uniqueFactors(ctx);
  const spreading = factors.filter((f) => SPREADING.test(f) && !/^火灾$/.test(f));
  const internal = factors.filter((f) => !SPREADING.test(f) && !/^其他(伤害)?$/.test(f));
  return [
    '（1）火灾事故对周边企业及环境的影响分析',
    `如果公司发生火灾事故且扑救不及时导致火势蔓延，可能对相邻企业、周边道路及人员产生危险有害影响。${spreading.length ? `${spreading.join('、')}等事故处置不及时的，同样可能波及厂界外，应按 1.2 响应分级及时疏散周边人员并向${ctx.bureau}报告。` : ''}`,
    '（2）其他事故对周边环境的影响分析',
    internal.length ? `本公司存在的${internal.join('、')}等生产安全事故主要发生在公司内部，一般不会影响周边企业及环境。` : '本公司其他生产安全事故主要发生在公司内部，一般不会影响周边企业及环境。',
    '（3）周边企业（环境）对本公司的影响分析',
    '如果相邻企业或厂房发生火灾等事故且扑救不及时导致蔓延，可能对本公司的人员、财产安全造成危害。',
    '（4）自然灾害引发次生生产安全事故分析',
    '强台风、雷雨天气可能造成触电事故，也可能直接损坏设备设施，或间接引发火灾等事故造成人员伤亡；地震可能引发断电、断水、通信中断、设备设施毁损、交通中断及火灾等事故，造成人员伤亡和财产损失。',
    '本次危险有害因素辨识结果作为后续事故风险分析、应急资源调查和应急处置方案编制的基础。各风险因素的 LEC 半定量评价结果详见第 2 章。',
  ];
}

/** 现有安全生产管理情况：只写资料里有的（组织、人员、培训、物资），不替企业声明制度是否健全 */
function managementStatus(ctx: PlanContext): string[] {
  const { company, input } = ctx;
  const org = input.organization;
  const b = input.basic;
  const p = input.production;
  const training = input.expert.facts?.training;
  const supplies = p.emergencySupplies.map((s) => s.name.trim()).filter(Boolean);
  const kit = p.firstAidKit?.answer === 'yes';
  const pool = p.firePool?.answer === 'yes';
  const lead = ctx.commander ? `由${fill(ctx.commander.position || '主要负责人')}${fill(ctx.commander.name)}担任应急总指挥` : '';
  const people = [
    b.safetyManagementCount !== undefined ? `安全管理人员 ${b.safetyManagementCount} 人` : '',
    b.technicalManagementCount !== undefined ? `技术管理人员 ${b.technicalManagementCount} 人` : '',
  ].filter(Boolean);
  return [
    '### 1）公司安全生产管理情况',
    [
      `${company}设有安全生产与应急管理组织${lead ? `，${lead}` : ''}`,
      org.groups.length ? `，下设${org.groups.map((g) => ctx.groupName(g)).join('、')}共 ${org.groups.length} 个应急小组` : '',
      people.length ? `；公司现有${people.join('、')}` : '',
      training?.department ? `；应急培训与演练由${training.department}组织实施` : '',
      training?.budget ? `，年度经费 ${training.budget}` : '',
      '。',
    ].join(''),
    '### 2）现有事故风险防控与应急措施情况',
    [
      supplies.length ? `公司现配备${supplies.length > 6 ? `${supplies.slice(0, 6).join('、')}等` : supplies.join('、')}应急物资装备共 ${supplies.length} 项` : `公司应急物资装备${MISSING}`,
      pool ? '，设有消防水池' : '',
      kit ? '，配置急救药箱' : '',
      `，设置 24 小时值班电话 ${ctx.dutyPhone}`,
      '。应急物资的数量、存放位置和保管人详见应急资源调查报告。',
    ].join(''),
  ];
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
  const site = siteColumn(ctx);
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
    '（3）《生产安全事故分类与编码》GB 6441-2025；',
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
    `| 设备名称 | 规格型号 | 数量 | 单位 | 使用部门 | 存放地点 | 使用状况 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(p.equipment.length
      ? p.equipment.map(
          (e) =>
            `| ${fill(e.name)} | ${dash(e.spec)} | ${dash(e.quantity)} | ${dash(e.unit)} | ${dash(e.department)} | ${dash(e.location)} | ${dash(e.condition)} |${site.cell(e.addressId)}`,
        )
      : [`| ${MISSING} | / | / | / | / | / | / |${site.on ? ' / |' : ''}`]),
    '### 5）主要原辅材料贮存量',
    '**表 1.2-3 主要原辅材料贮存量表**',
    `| 名称 | CAS号 | 年用量（t） | 日常最大储存量（t） | 储存位置 | 危险化学品 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(p.materials.length
      ? p.materials.map(
          (m) =>
            `| ${fill(m.name)} | ${dash(m.casNumber)} | ${dash(m.annualUsageTons)} | ${dash(m.maxStorageTons)} | ${dash(m.storageLocation)} | ${ctx.hazardous.includes(m.name) ? '是' : '否'} |${site.cell(m.addressId)}`,
        )
      : [`| ${MISSING} | / | / | / | / | / |${site.on ? ' / |' : ''}`]),
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
    `根据周边环境、总平面布置、作业环境、场所特点等，遵循科学性、系统性、全面性和预测性的原则，参照《生产安全事故分类与编码》（GB 6441-2025），对${company}各作业场所危险源进行辨识。`,
    ...hazardFactorsTable(ctx, '1.3-1'),
    '### 2）危险有害因素分析',
    `经辨识，${company}生产经营过程中可能涉及的主要危险有害因素包括：${factors}，分析如下：`,
    ...factorParagraphs(ctx),
    '### 3）重大危险源辨识',
    ...majorHazard(ctx),
    '### 4）危险有害因素分析结果',
    ...analysisResult(ctx),
    '# 事故风险分析',
    '## 现有安全生产管理情况',
    ...managementStatus(ctx),
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
