// 应急预案的附件 1–10（GB/T 29639-2020 第 9 章，附件 7–10 为耕云补充）。正文迁自旧仓库 lib/md-generator/preamble.ts，
// 改动同综合预案：中文全角标点、引用改为本文档的章节号与附件号、写死飞宇的说法按企业资料写。
// 每个附件一段 Markdown：# 附件名、## 附 N.x、### 附 N.x.x；图用 [[figure:key]] 占位。
import { RISK_LEVELS, accidentTypeOf, riskLevel, riskScore, workplacesOf, type RiskLevel } from '@genyun/shared';
import {
  MISSING,
  cnDate,
  commsMeans,
  dash,
  fill,
  firstAidLocation,
  firstAidNames,
  firstAidText,
  hasAed,
  hazardPlace,
  medicalAgreement,
  pick,
  practiceItemsText,
  safetyLead,
  siteColumn,
  supplyNames,
  type PlanContext,
} from './context.ts';

export interface Attachment {
  key: string;
  markdown: string;
}

export function attachments(ctx: PlanContext, drawings: DrawingKey[]): Attachment[] {
  return [
    { key: 'profile', markdown: companyProfile(ctx) },
    { key: 'risk', markdown: riskResults(ctx) },
    { key: 'system', markdown: planSystem(ctx) },
    { key: 'supplies', markdown: suppliesList(ctx) },
    { key: 'contacts', markdown: contacts(ctx) },
    { key: 'forms', markdown: formTexts(ctx) },
    { key: 'drawings', markdown: keyDrawings(drawings) },
    { key: 'resources', markdown: resourceSurvey(ctx) },
    { key: 'training', markdown: trainingPlan(ctx) },
    { key: 'alarm', markdown: alarmFlow() },
  ];
}

// ── 附件1 生产经营单位概况 ──
function companyProfile(ctx: PlanContext): string {
  const { input, company } = ctx;
  const site = siteColumn(ctx);
  const b = input.basic;
  const p = input.production;
  const facts = input.expert.facts ?? {};
  const address = fill(b.registeredAddress?.detail);
  const people =
    b.technicalManagementCount !== undefined && b.safetyManagementCount !== undefined
      ? `，其中技术管理人员 ${b.technicalManagementCount} 人、专兼职安全管理人员 ${b.safetyManagementCount} 人`
      : '';
  const mark = (v: string) => (b.economicNature === v ? '☑' : '□');
  const economic = `全民所有制 ${mark('全民所有制')} 集体所有制 ${mark('集体所有制')} 私有制 ${mark('私有制')} 其它 ${mark('其它')}`;
  const steps = p.processFlow.steps.map((s) => s.name);
  const extinguishers = p.emergencySupplies.filter((s) => /灭火器/.test(s.name));
  const hydrants = p.emergencySupplies.filter((s) => /消火栓/.test(s.name));
  const count = (xs: typeof extinguishers) => (xs.length ? xs.map((s) => `${s.name} ${dash(s.quantity)} ${s.unit ?? ''}`.trim()).join('、') : '—');
  const pool = p.firePool?.answer === 'yes' ? p.firePool : undefined;
  const water = pool ? `市政管网 + 自建消防水池${pool.volumeM3 ? `（容量 ${pool.volumeM3} m³）` : ''}` : '市政管网供水';
  const hazards = input.expert.hazards ?? [];
  const byPlace = new Map<string, string[]>();
  for (const h of hazards) {
    const site = ctx.siteOf(h.addressId);
    for (const w of workplacesOf(h.workplace).length ? workplacesOf(h.workplace) : ['未分类作业场所']) {
      const place = site ? `${site} ${w}` : w;
      const list = byPlace.get(place) ?? [];
      if (h.factor.trim() && !list.includes(h.factor.trim())) list.push(h.factor.trim());
      byPlace.set(place, list);
    }
  }
  const neighbours = input.location.neighbours;
  const neighbourNames = neighbours?.answer === 'listed' ? neighbours.items.map((n) => n.name).join('、') : '';
  const neighbourText = neighbourNames ? `公司相邻单位有${neighbourNames}；` : '';

  return [
    '# 生产经营单位概况',
    '## 企业概况',
    `${company}${facts.establishedDate ? `成立于${cnDate(facts.establishedDate)}，` : ''}注册地址为${address}；统一社会信用代码 ${fill(b.socialCreditCode)}，法定代表人 ${fill(b.legalRepresentative)}，注册资本 ${dash(b.registeredCapital)}。公司经营范围依据营业执照：${fill(b.businessScope)}。主要产品 / 服务：${fill(b.mainProducts)}`,
    `从业人数：全公司在册职工 ${fill(b.employeeCount)} 人${people}。${facts.superior?.trim() ? `隶属关系 / 上级主管单位：${facts.superior.trim().replace(/[。；，]$/, '')}。` : ''}安全生产业务接受${ctx.bureau}行业监管。重点岗位：本企业涉及的特种作业岗位及消防安全管理、应急救援等关键应急响应岗位，应持证上岗并纳入年度应急培训与演练。周边环境与重大危险源辨识：${fill(facts.surroundings)}`,
    '**表1-1 企业基本情况表**',
    '| 项目 | 内容 |',
    '| --- | --- |',
    `| 公司名称 | ${company} |`,
    `| 注册地址 | ${address} |`,
    `| 邮政编码 | ${dash(b.postalCode)} |`,
    `| 联系电话 | ${dash(b.contactPhone)} |`,
    `| 传真 | ${dash(b.fax)} |`,
    `| 联系人 | ${dash(b.contactPerson)} |`,
    `| 公司网址 | ${dash(b.website)} |`,
    `| 电子邮箱 | ${dash(b.email)} |`,
    `| 公司类型 | ${dash(b.companyType)} |`,
    `| 登记机关 | ${dash(b.registrationAuthority)} |`,
    `| 经济性质 | ${economic} |`,
    `| 统一社会信用代码 | ${fill(b.socialCreditCode)} |`,
    `| 法定代表人 | ${fill(b.legalRepresentative)} |`,
    `| 主管负责人 | ${dash(b.responsiblePerson)} |`,
    `| 职工人数 | 在册 ${fill(b.employeeCount)} 人（技术管理 ${dash(b.technicalManagementCount)} 人 / 安全管理 ${dash(b.safetyManagementCount)} 人） |`,
    `| 注册资本 / 资产 | 注册资本 ${dash(b.registeredCapital)}；固定资产 ${dash(b.fixedAssets)}；上年销售额 ${dash(b.lastYearRevenue)} |`,
    '## 公司所在地理位置',
    `${company}${ctx.addresses.length ? `生产经营地址共 ${ctx.addresses.length} 处：${ctx.addresses.map((a) => a.address).join('；')}` : `位于${fill(input.location.siteAddress.detail || b.registeredAddress?.detail)}`}。${neighbourText}公司东、南、西、北各方位毗邻单位及周边道路、绿地、水体等具体情况以企业现场填报 / 属地地图核实为准，详见附件7 关键图纸。`,
    '## 产品生产工艺流程图',
    ...(steps.length
      ? ['公司主要产品生产工艺流程如下图所示：', '[[figure:process-flow]]', '**主要产品生产工艺流程图**']
      : [p.processFlow.description ? `公司主要生产工艺：${p.processFlow.description}。` : `公司主要生产工艺：${MISSING}`]),
    '## 主要生产设备设施',
    '**表1-2 主要生产设备设施**',
    `| 设备名称 | 规格型号 | 数量 | 单位 | 使用部门 | 存放地点 | 使用状况 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(p.equipment.length
      ? p.equipment.map(
          (e) =>
            `| ${fill(e.name)} | ${dash(e.spec)} | ${dash(e.quantity)} | ${dash(e.unit)} | ${dash(e.department)} | ${dash(e.location)} | ${dash(e.condition)} |${site.cell(e.addressId)}`,
        )
      : [`| ${MISSING} |  |  |  |  |  |  |${site.empty}`]),
    '## 主要原辅材料贮存量',
    '**表1-3 主要原辅材料贮存量表**',
    `| 名称 | CAS号 | 年用量（t） | 日常最大储存量（t） | 储存位置 | 危险化学品 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(p.materials.length
      ? p.materials.map(
          (m) =>
            `| ${fill(m.name)} | ${dash(m.casNumber)} | ${dash(m.annualUsageTons)} | ${dash(m.maxStorageTons)} | ${dash(m.storageLocation)} | ${ctx.hazardous.includes(m.name) ? '是' : '否'} |${site.cell(m.addressId)}`,
        )
      : [`| ${MISSING} |  |  |  |  |  |${site.empty}`]),
    '## 主要建（构）筑物',
    '**表1-4 主要建（构）筑物情况一览表**',
    '| 序号 | 建（构）筑物名称 | 结构 | 耐火等级 | 层数 | 建筑面积（m²） | 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(p.buildings.length
      ? p.buildings.map((bd, i) => {
          const f = facts.buildings?.[bd.name];
          return `| ${i + 1} | ${fill(bd.name)} | ${dash(f?.structure)} | ${dash(f?.fireRating)} | ${dash(bd.floors)} | ${dash(bd.floorAreaM2)} | ${dash(bd.remarks)} |`;
        })
      : [`| 1 | ${MISSING} |  |  |  |  |  |`]),
    '注：未注明耐火等级的建（构）筑物，钢筋混凝土 / 砖混结构一般按二级耐火等级认定，以设计文件 / 消防验收为准。',
    '## 消防设备、设施',
    `公司按规范配置灭火器、室内外消火栓等消防器材（灭火器：${count(extinguishers)}；消火栓：${count(hydrants)}）。消防水源：${water}（未自建消防水池的，消防用水由市政管网供给）。消防设施按规定定期检测维护，确保完好有效。`,
    '## 危险源与风险分析',
    '根据周边环境、总平面布置、作业环境、场所特点等，遵循科学性、系统性、全面性和预测性的原则，参照《生产安全事故分类与编码》（GB 6441-2025）的分类标准，公司各作业场所主要危险、有害因素详见下表（风险分级与 LEC 量化评估结果详见附件2 风险评估的结果）：',
    '**表1-5 公司主要作业场所危险有害因素分析表**',
    '| 序号 | 作业场所 | 主要危险、有害因素 |',
    '| --- | --- | --- |',
    ...(byPlace.size
      ? [...byPlace].map(([place, factors], i) => `| ${i + 1} | ${place} | ${factors.join('、') || '—'} |`)
      : [`| 1 | ${MISSING} |  |`]),
    '**主要危险、有害因素对周边的影响分析**',
    `（1）火灾事故对周边企业及环境的影响：若公司发生火灾且抢救不及时导致火势蔓延，可能对${neighbourNames ? `相邻的${neighbourNames}及` : '厂区周边相邻单位、'}周边道路、环境造成危险有害影响（周边情况以企业填报 / 属地地图核实为准，详见附件7 关键图纸）。`,
    '（2）其他事故对周边环境的影响：触电、机械伤害、物体打击等生产安全事故主要发生在公司内部，一般不会影响周边企业及环境。',
    `（3）周边企业（环境）对本公司的影响：若${neighbourNames || '周边相邻单位'}发生火灾等事故且抢救不及时导致蔓延，可能对本公司人员、财产安全造成危害。`,
    '（4）自然灾害引发次生生产安全事故：强台风、雷雨天气可能造成人员触电、设备损坏或引发火灾等；地震可能引发断电、断水、通信中断、设备毁损、交通中断、火灾等事故，造成人员伤亡和财产损失。',
  ].join('\n');
}

// ── 附件2 风险评估的结果（LEC 法） ──
function riskResults(ctx: PlanContext): string {
  const hazards = ctx.input.expert.hazards ?? [];
  if (hazards.length === 0) {
    return [
      '# 风险评估的结果',
      '本节展示本企业生产经营场所风险评估的结果摘要，采用 **LEC 法** 对各类危险有害因素开展半定量评估。',
      `危险源辨识与 LEC 评估${MISSING}。`,
    ].join('\n');
  }
  const counts = new Map<RiskLevel, number>();
  const rows = hazards.map((h, i) => {
    const d = riskScore(h);
    const level = riskLevel(d);
    if (level) counts.set(level, (counts.get(level) ?? 0) + 1);
    return `| ${i + 1} | ${fill(hazardPlace(ctx.input, h))} | ${fill(h.factor)} | ${dash(h.l)} | ${dash(h.e)} | ${dash(h.c)} | ${dash(d)} | ${level ?? '—'} |`;
  });
  const summary =
    [...RISK_LEVELS]
      .reverse()
      .filter((l) => counts.get(l))
      .map((l) => `${l} ${counts.get(l)} 项`)
      .join('、') || '暂未识别量化危险源';
  return [
    '# 风险评估的结果',
    `本节展示${ctx.company}生产经营场所风险评估的结果摘要。本企业采用 **LEC 法（可能性 × 暴露频次 × 后果严重度）** 对辨识出的危险有害因素开展半定量评估，风险值 **D = L × E × C**，并据此划分风险等级，作为应急资源配置、专项预案选取与现场处置方案编制的依据。`,
    '**LEC 法取值标准**：',
    // 与风险评估报告表 2.2-1 至 2.2-3 同一套分值
    '- **L（发生事故可能性）**：0.1 实际不可能 / 0.2 极不可能 / 0.5 很不可能，可以设想 / 1 可能性小，完全意外 / 3 可能，但不经常 / 6 相当可能 / 10 完全可以预料到',
    '- **E（暴露于危险环境频次）**：0.5 非常罕见 / 1 每年几次 / 2 每月一次 / 3 每周一次 / 6 每天工作时间内 / 10 连续暴露',
    '- **C（发生事故后果严重度）**：1 需要救护 / 3 重大，致残 / 7 严重，重伤 / 15 非常严重，一人死亡 / 40 灾难，数人死亡 / 100 大灾难，许多人死亡',
    '**风险等级判定阈值（D 值区间）**：',
    '- D ≤ 20：**稍有危险**（可忽略，日常管控）',
    '- 20 < D ≤ 70：**一般危险**（需关注，纳入日常巡查）',
    '- 70 < D ≤ 160：**显著危险**（需整改，纳入专项管理）',
    '- 160 < D ≤ 320：**高度危险**（立即整改，需停产评估）',
    '- D > 320：**极其危险**（立即停产，根除危险源）',
    `**风险评估结果汇总**：本次共辨识出 **${hazards.length}** 项危险有害因素，经 LEC 评估，风险等级分布为 ${summary}。各项风险源详见下表。`,
    '| 序号 | 作业场所 | 危险有害因素 | L | E | C | D=L×E×C | 风险等级 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '**结论与应用**：',
    '- 上述风险评估结果是本预案确定响应分级（详见 1.2 响应分级）、选取专项应急预案、编制现场处置方案的直接依据；',
    '- 显著危险及以上等级的风险源已逐项制定专项预案或现场处置方案，确保有针对性的应急准备；',
    '- 一般及稍有危险等级的风险源纳入日常安全检查与岗位风险告知，持续监控其变化；',
    '- 本评估结果每年至少复核一次，工艺变更、设备更新、人员调整、事故发生后及时按预案修订机制更新。',
  ].join('\n');
}

// ── 附件3 预案体系与衔接 ──
function planSystem(ctx: PlanContext): string {
  const a = ctx.input.agencies;
  const upper = [a.districtPlan, a.streetPlan].filter(Boolean);
  return [
    '# 预案体系与衔接',
    '## 应急预案体系',
    `本预案体系由综合应急预案、专项应急预案以及现场处置方案构成，并与${upper.length ? `上级预案${upper.map((n) => `《${n}》`).join('、')}` : '属地政府生产安全事故应急预案'}相衔接。详见图3-1。`,
    '[[figure:plan-system]]',
    `**图3-1 ${ctx.company}应急预案体系与衔接图**`,
  ].join('\n');
}

// ── 附件4 应急物资装备的名录或清单 ──
function suppliesList(ctx: PlanContext): string {
  const p = ctx.input.production;
  const kit = p.firstAidKit;
  const aidItems = kit?.answer === 'yes' ? kit.items : [];
  const all = [...supplyNames(ctx), ...firstAidNames(ctx)];
  const maintenance = pick(all, [/空气呼吸器/, /AED|自动体外除颤|除颤器/, /防化服|隔热服/], '专业器材');
  const site = siteColumn(ctx);
  const header = [`| 序号 | 名称 | 型号 / 规格 | 数量 | 存放位置 | 责任人 | 联系电话 |${site.head}`, `| --- | --- | --- | --- | --- | --- | --- |${site.sep}`];
  let n = 0;
  const supplyRows = p.emergencySupplies.map((s) => {
    const keeper = ctx.person(s.custodianId);
    const qty = s.quantity === undefined ? MISSING : `${s.quantity} ${s.unit ?? ''}`.trim();
    return `| ${++n} | ${fill(s.name)} | ${s.model?.trim() || '/'} | ${qty} | ${fill(s.location)} | ${keeper?.name || '/'} | ${keeper?.phone || '/'} |${site.cell(s.addressId)}`;
  });
  const aidRows = aidItems.map((f) => {
    const qty = f.quantity === undefined ? MISSING : `${f.quantity} ${f.unit ?? ''}`.trim();
    return `| ${++n} | ${fill(f.name)} | / | ${qty} | ${firstAidLocation(ctx) || '/'} | / | / |${site.empty}`;
  });
  const total = supplyRows.length + aidRows.length;
  if (total === 0) {
    return [
      '# 应急物资装备的名录或清单',
      `本节列出${ctx.company}应急物资与装备清单，包括名称、型号、数量、存放位置、责任人、联系电话。`,
      `应急物资装备清单${MISSING}。`,
      ...header,
    ].join('\n');
  }
  return [
    '# 应急物资装备的名录或清单',
    `本节列出${ctx.company}应急物资与装备清单，共 **${total}** 项，涵盖消防器材、个人防护装备、抢险救援工具、应急照明、通讯器材、急救药品与急救器材等，确保事故发生后各应急小组可在 5 分钟内就近调取处置所需物资。`,
    '**管理要求**：',
    '- **责任落实**：下表中「责任人」为该类物资的日常维护责任人，负责定期检查物资数量、有效期、完好状态，异常及时补充更换；责任人电话纳入综合保障组应急通讯录，事故发生时第一时间联络其调度物资。',
    `- **定期检查**：消防器材每月由抢险救灾组开展 1 次完好性检查并填表登记；急救药品每季度由综合保障组核对有效期，临期 3 个月前预订更换；${maintenance}按产品说明书或检测要求定期维护。`,
    `- **使用培训**：所有应急器材的位置、用途、使用方法，均在岗前培训和每年应急演练中向相关岗位员工讲解演示；关键器材（${practiceItemsText(ctx)}）由专人持证或经培训后使用。`,
    '- **动态更新**：工艺变更、原辅材料调整、新增风险源时，由安全管理员组织重新评估物资配置充足性，缺口在 30 日内补齐，并同步更新本清单与现场标识。',
    ...(supplyRows.length ? ['**一、应急器材与防护装备**', ...header, ...supplyRows] : []),
    ...(aidRows.length ? ['**二、急救药品与急救器材**', ...header, ...aidRows] : []),
  ].join('\n');
}

// ── 附件5 有关应急部门、机构或人员的联系方式 ──
function contacts(ctx: PlanContext): string {
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
  const a = ctx.input.agencies;
  const external = [
    `| ${ctx.street} | ${a.streetOffice ? dash(a.streetOffice.phone) : MISSING} | 属地协调 / 周边疏散协助 |`,
    ...(ctx.park ? [`| ${ctx.park.manager} | ${ctx.park.dutyPhone ?? MISSING} | 园区联动 / 事故先报园区 |`] : []),
    `| ${ctx.bureau} | ${a.emergencyBureau?.phone || '12350 / 属地值班电话'} | 事故报告 / 应急资源调度 |`,
    `| ${a.fireDept?.name || '属地消防救援机构'} | 119${a.fireDept?.phone ? `；值班 ${a.fireDept.phone}` : ''} | 火灾扑救 / 抢险救援 |`,
    `| ${ctx.hospital} | 120 / 医院急诊 | 现场急救 / 伤员转运 |`,
    '| 公安机关 | 110 | 治安维护 / 交通疏导 |',
    `| ${ctx.company}24小时值班电话 | ${ctx.dutyPhone} | 企业内部报警 / 值班联络 |`,
  ];
  return [
    '# 有关应急部门、机构或人员的联系方式',
    '**内部应急通讯录**',
    `| 序号 | 机构 / 小组 | 姓名 | 应急职务 | 实际岗位 | 联系电话 |${site.head}`,
    `| --- | --- | --- | --- | --- | --- |${site.sep}`,
    ...(rows.length ? rows : [`| 1 | 应急组织 | — | — | — | — |${site.on ? ' — |' : ''}`]),
    '**外部应急联系方式**',
    '| 序号 | 单位 / 机构 | 联系电话 | 用途 |',
    '| --- | --- | --- | --- |',
    ...external.map((r, i) => `| ${i + 1} ${r}`),
  ].join('\n');
}

// ── 附件6 格式化文本 ──
function formTexts(ctx: PlanContext): string {
  const { bureau, company } = ctx;
  const office = ctx.facts.hasEmergencyOffice ? '应急办公室' : '应急指挥部';
  const announce = commsMeans(ctx).filter((c) => c !== '现场呼喊').join(' + ');
  return [
    '# 格式化文本',
    `本节为${company}事故应急响应过程中的关键信息节点提供**统一格式的空白表样（格式化文本）**，确保事故发生后信息接报、响应启动、对外发布等环节的记录与决策标准化、可追溯。所有表样在${office}与值班室印刷备份不少于 20 份，事故时由对应责任人逐栏填写，事后归入应急响应总台账留存不少于 5 年。`,
    '## 事故信息接报登记表',
    '**使用场景**：值班员 / 安全管理员接到事故报告（含本厂员工电话报告、车间负责人上报、外部通报）时，**立即**逐栏填写，确保事故「何时 / 何地 / 何人 / 何事 / 伤亡 / 处置」等关键要素不漏不错，作为后续启动响应、对外报告的原始凭证。',
    '| 项目 | 内容 | 项目 | 内容 |',
    '| --- | --- | --- | --- |',
    '| 接报编号 | ___________ | 接报时间 | ____年__月__日 __:__ |',
    '| 接报人（值班员） | ___________ | 报告人姓名 | ___________ |',
    '| 报告人单位 / 部门 | ___________ | 报告人联系电话 | ___________ |',
    '| 事故发生时间 | ____年__月__日 __:__ | 事故发生地点 | ___________ |',
    `| 事故类型 | □ 火灾 □ 爆炸 □ 触电 □ 机械伤害 □ 坠落 □ 中毒${ctx.hazardous.length ? ' □ 危化品泄漏' : ''} □ 其他：____ | 事故简要经过 | ___________ |`,
    '| 已知伤亡 | 死亡 ____ 人 / 重伤 ____ 人 / 轻伤 ____ 人 / 失踪 ____ 人 | 财产损失估计 | 约 ____ 万元 |',
    '| 现场是否仍在扩散 | □ 是 □ 否 □ 不详 | 现场已采取措施 | ___________ |',
    '| 上报路径 | □ 已报现场负责人 □ 已报总指挥 □ 已报 119/120/110 □ 已报主管部门 | 上报总指挥时间 | ____年__月__日 __:__ |',
    '| 接报人签字 | ___________ |  |  |',
    '**填表说明**：1）接报后须在 5 分钟内完成本表填写并报现场负责人；2）信息不完整不得作为延迟上报的理由，应一边补充一边上报；3）严禁瞒报、迟报、谎报。',
    '## 应急响应启动通知单',
    '**使用场景**：总指挥（或其授权人）根据事故信息接报登记表和现场态势，决定启动应急响应级别时**正式签发**本通知单，以书面形式宣告响应正式启动，作为各应急小组到位、外部联动启动、资源调度的依据。',
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 启动通知编号 | ___________ |',
    '| 启动响应级别 | □ I 级（特别重大） □ II 级（重大） □ III 级（较大） □ IV 级（一般） |',
    '| 启动时间 | ____年__月__日 __:__ |',
    '| 依据事故信息接报编号 | ___________ |',
    '| 启动理由（事故概况） | _________________________________________________ |',
    '| 指挥部集结地点 | ___________ |',
    `| 要求到位的应急小组 | ${ctx.input.organization.groups.map((g) => `□ ${ctx.groupName(g)}`).join(' ')} □ 全部 |`,
    '| 各应急小组到位时间要求 | ____ 分钟内（白班） / ____ 分钟内（夜班） |',
    `| 启动外部联动 | □ 报告主管部门（${bureau}） □ 拨打 119 □ 拨打 120 □ 拨打 110 □ 通报相邻企业 |`,
    '| 现场临时指挥负责人 | ___________ |',
    '| 备注事项 | ___________ |',
    '| 总指挥签发 | ___________ |',
    '| 签发时间 | ____年__月__日 __:__ |',
    `**填表说明**：1）总指挥不在时由其书面授权的副总指挥代签，授权书一并归档；2）签发后立即通过${announce}同步通告；3）本单一份留指挥部，一份送值班室，一份现场张贴。`,
    '## 对外信息发布审批表',
    `**使用场景**：对外信息（向${bureau}书面报告 / 新闻通气稿 / 公司官网公告 / 媒体回应口径）发布前，由新闻发言人（默认综合保障组组长）起草本审批表，经总指挥审核批准后方可对外发布，确保对外口径统一、内容合法合规、不瞒报不迟报。`,
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 发布编号 | ___________ |',
    '| 拟发布时间 | ____年__月__日 __:__ |',
    '| 发布渠道 | □ 政府主管部门书面报告 □ 新闻通气会 □ 公司官网公告 □ 媒体口径（回应记者询问） □ 其他：____ |',
    '| 发布对象 | ___________ |',
    '| 起草人（新闻发言人） | ___________ |',
    '| 信息内容摘要（事故时间地点 / 基本经过 / 伤亡 / 处置进展 / 下步措施） | _________________________________________________ |',
    '| 涉密 / 隐私核查 | □ 不涉国家秘密 □ 不涉商业秘密 □ 不涉个人隐私（死者姓名已征求家属同意或脱敏） |',
    '| 法律合规审查 | □ 已审 □ 不涉法律风险 审查人签字：___________ |',
    `| 主管部门审核（II 级及以上事故必需） | □ 已报 ${bureau} 审核 □ 主管部门反馈：___________ |`,
    '| 总指挥审批意见 | □ 同意发布 □ 修改后发布 □ 暂缓发布 修改要求：___________ |',
    '| 总指挥签字 | ___________ |',
    '| 审批时间 | ____年__月__日 __:__ |',
    '| 实际发布时间 | ____年__月__日 __:__ |',
    `**填表说明**：1）较大及以上事故对外发布前**必须**报 ${bureau} 审核，严禁绕过主管部门擅自对外发声；2）首报应在事故发生后 1 小时内完成，后续每 2 小时续报处置进展，直至响应终止；3）发布稿件留底归档，与本审批表一并归入应急响应总台账。`,
  ].join('\n');
}

// ── 附件7 关键图纸：横版单独占页。前三张客户上传；后三张按 Martin 批注由编制单位绘制（周边环境、至医院路线、外部交通），
// 专家上传的入口还没做，现在列为待补充 ──
export const DRAWINGS = {
  sitePlan: '总平面布置图',
  evacuation: '应急疏散路线图',
  fireFacility: '消防设施布置图',
  surroundings: '周边环境图',
  hospitalRoute: '至医院路线图',
  traffic: '外部交通图',
} as const;
export type DrawingKey = keyof typeof DRAWINGS;
const BY_CUSTOMER: DrawingKey[] = ['sitePlan', 'evacuation', 'fireFacility'];

function keyDrawings(provided: DrawingKey[]): string {
  const keys = Object.keys(DRAWINGS) as DrawingKey[];
  const missing = keys.filter((k) => !provided.includes(k));
  const fromCustomer = missing.filter((k) => BY_CUSTOMER.includes(k));
  const fromUs = missing.filter((k) => !BY_CUSTOMER.includes(k));
  return [
    '# 关键图纸',
    `本预案关键图纸包括${keys.map((k) => DRAWINGS[k]).join('、')}，标明疏散路线、警戒范围、应急资源分布及外部救援路线，具体如后续所示。`,
    ...keys.filter((k) => provided.includes(k)).map((k) => `[[figure:drawing-${k}]]`),
    ...(fromCustomer.length ? [`${fromCustomer.map((k) => DRAWINGS[k]).join('、')}（待补充）：由企业提供后纳入正式文本。`] : []),
    ...(fromUs.length ? [`${fromUs.map((k) => DRAWINGS[k]).join('、')}（待补充）：由编制单位现场踏勘后绘制，纳入正式文本。`] : []),
  ].join('\n');
}

// ── 附件8 应急资源调查报告 ──
function resourceSurvey(ctx: PlanContext): string {
  const { input, company, bureau, street } = ctx;
  const f = ctx.facts;
  const chem = ctx.hazardous.length > 0;
  const neighbours = input.location.neighbours;
  const comms = ['固定电话', '移动电话', ...(f.hasRadio ? ['对讲机'] : []), ...(f.hasImGroup ? ['企业微信群'] : []), ...(f.hasPaSystem ? ['应急广播'] : [])];
  const a = input.agencies;
  const p = input.production;
  const org = input.organization;
  const rescuers = new Set(
    [org.commander, ...org.deputies, ...org.groups.flatMap((g) => [g.leader, ...g.members])].filter(Boolean).map((x) => x!.id),
  ).size;
  const supplyTotal = p.emergencySupplies.length + firstAidNames(ctx).length;
  const totalArea = p.buildings.reduce((s, b) => s + (b.floorAreaM2 ?? 0), 0);
  const pool = p.firePool?.answer === 'yes' ? p.firePool : undefined;
  const facts = input.expert.facts ?? {};
  const hospitalKm = facts.hospital?.distanceKm !== undefined ? `约 ${facts.hospital.distanceKm} km` : '';
  const hazardCount = input.expert.hazards?.length;
  const agreed = [
    f.hasRescueAgreements ? `与${ctx.rescueParties || '有关救援单位'}签订了救援协议` : '',
    f.hasMutualAid ? `与${ctx.mutualAidParties || '周边企业'}签订了应急互助协议` : '',
  ].filter(Boolean);
  const agreedText = agreed.length ? `公司已${agreed.join('、')}；` : '';
  const specialRisks = [
    ctx.hazardous.length ? `危险化学品${ctx.chemNote}泄漏处置` : '',
    ctx.scope.pressureVessel ? '压力容器爆炸' : '',
    ctx.scope.dustProcess ? '粉尘爆炸' : '',
    ctx.scope.meltingProcess ? '高温熔融物喷溅' : '',
  ].filter(Boolean);
  return [
    '# 应急资源调查报告',
    `本节呈现${company}**应急资源调查**结果，作为预案确定资源调配方案、识别保障短板的依据。调查范围覆盖**本单位内部应急资源**、**外部可依托应急资源**两大类，并在末尾给出**资源差距分析与补强对策**，确保事故发生后人员、物资、装备、场所、资金、社会救援力量等各类资源能在第一时间汇集到位。`,
    `**调查方法**：由安全管理部门牵头，会同生产、设备、综合保障、人力资源等部门，对照附件2 风险评估${hazardCount ? `识别出的 ${hazardCount} 项风险因素` : '的结果'}，逐项核查本单位现有应急资源数量、状态、可调用性；同步走访属地应急管理部门、消防大队、医疗机构、邻企，核实外部可依托救援力量与响应时效。**调查时点**：每年年初组织一次全面调查，工艺变更、人员调整、新增风险源时即时更新。`,
    '**一、本单位内部应急资源**',
    '本单位内部应急资源是事故发生后最先调用的第一道防线，涵盖人员、物资、装备、场所、资金五大类。',
    '**1. 应急人员资源（本单位内部）**',
    `- 全公司在册职工 ${fill(input.basic.employeeCount)} 人，其中应急指挥部及各应急小组（${org.groups.map((g) => ctx.groupName(g)).join(' / ')}）共 **${rescuers}** 人，组织架构与职责详见 2 应急组织机构及职责与附件5。`,
    '- 关键岗位人员持证情况：电工持电工作业证、特种设备作业人员持相应作业证、消防安全管理员持消防设施操作员证。',
    '- 员工应急能力建设：全员每年至少接受 1 次综合应急培训 + 1 次综合演练，各应急小组每半年至少开展 1 次专项 / 现场处置演练，详见附件9 应急培训计划与演练安排。',
    '**2. 应急物资与装备资源（本单位内部）**',
    `- 应急器材与防护装备 + 急救药品器材合计 **${supplyTotal}** 项，详见附件4 应急物资装备的名录或清单。`,
    `- 消防水源：${pool ? `市政管网 + 自建消防水池${pool.volumeM3 ? `，自建消防水池容量 ${pool.volumeM3} m³` : ''}` : '市政管网'}；室内外消火栓配置详见附件4。`,
    `- 通讯保障：${comms.join(' + ')}，平时季度测试，详见 5.1 通信与信息保障。`,
    '**3. 应急场所资源（本单位内部）**',
    `- 建（构）筑物 ${p.buildings.length} 栋，合计建筑面积约 ${totalArea} m²，均设安全出口与疏散通道，通道宽度、应急照明、疏散指示标志按 GB 50016 标准配置。`,
    f.hasAssemblyPoint
      ? `- 紧急集合点：${ctx.assemblyPoint ? `${ctx.assemblyPoint}，` : ''}位置见附件7 关键图纸。`
      : '- 紧急集合点：应在厂区内远离建筑物和危险源的开阔地带设置，并在疏散路线图上标明。',
    f.hasEmergencyOffice
      ? '- 应急指挥部办公地点：公司应急办公室（配备电话、应急通讯录、预案纸质本）。'
      : '- 应急指挥部办公地点：事故时由总指挥在事故现场上风向的安全地点或公司办公区确定（应备有电话、应急通讯录、预案纸质本）。',
    '**4. 应急资金保障（本单位内部）**',
    `- 公司年度安全生产专项费用按规定足额提取并列支，其中应急培训与演练经费 ${fill(facts.training?.budget)}；物资装备购置与更新经费按年度计划列支，事故应急处置费用单独列入年度预算。`,
    '- 应急资金审批：事故响应期间，总指挥可直接批准 5 万元以内紧急采购；5 万元以上由总指挥与财务负责人会签，事后补正手续。',
    '**二、单位外部可依托应急资源**',
    '本单位规模与专业救援能力有限，事故扩散或处置超出本单位能力时，需第一时间寻求**外部**社会救援力量增援。本节按可依托方向逐类列明**外单位**应急力量与调用条件；各单位到场时间以每年调查核实的结果为准，本报告不预设。',
    '| 序号 | 外部资源类别 | 单位 / 机构名称 | 联系方式 | 依托方式 |',
    '| --- | --- | --- | --- | --- |',
    ...[
      `| 属地应急管理部门 | ${bureau} | ${a.emergencyBureau?.phone || '12350 / 属地值班电话'} | 报告事故 / 请求资源调度 |`,
      `| 街道应急办 | ${street} | ${a.streetOffice ? dash(a.streetOffice.phone) : MISSING} | 协调辖区资源 / 协助疏散周边 |`,
      ...(ctx.park ? [`| 园区管理方 | ${ctx.park.manager} | ${ctx.park.dutyPhone ?? MISSING} | 事故先报园区 / 园区联动调度 |`] : []),
      ...(f.hasRescueAgreements && ctx.rescueParties ? [`| 协议救援单位 | ${ctx.rescueParties} | 应急通讯录 | 救援协议 / 事故时到场支援 |`] : []),
      ...(f.hasMutualAid && ctx.mutualAidParties && !(neighbours?.answer === 'listed' && neighbours.items.some((n) => ctx.mutualAidParties.includes(n.name)))
        ? [`| 互助协议企业 | ${ctx.mutualAidParties} | 应急通讯录 | 互助协议 / 物资借调 / 人员驰援 |`]
        : []),
      `| 消防救援队 | ${a.fireDept?.name || '属地消防大队'} | 报警 119${a.fireDept?.phone ? `；值班 ${a.fireDept.phone}` : ''} | 火灾扑救${chem ? ' / 危化品泄漏' : ''} / 抢险救援 |`,
      `| 医疗急救机构 | ${ctx.hospital}${hospitalKm ? `（${hospitalKm}）` : ''} | 120 / 医院急诊 | 现场急救 / 伤员转运 / 院内救治 |`,
      '| 公安治安力量 | 属地派出所 | 110 | 治安维护 / 现场封控 / 交通疏导 |',
      ...(neighbours?.answer === 'listed'
        ? neighbours.items.map((n) => `| 邻企互助力量 | ${n.name} | ${[n.contact, n.phone].filter(Boolean).join(' ') || '应急通讯录'} | ${f.hasMutualAid ? '互助协议 / ' : ''}物资借调 / 人员驰援 |`)
        : [`| 邻企互助力量 | 周边邻企 | 应急通讯录 | ${f.hasMutualAid ? '互助协议 / ' : ''}物资借调 / 人员驰援 |`]),
      `| 专业救援队伍 | 属地${chem ? '危化品 / ' : ''}工业事故专业救援队 | 应急管理局协调调度 | 重大事故专业处置（超本单位能力时） |`,
      '| 社会救援力量 | 红十字应急救护志愿者 / 同行业互助网 | 红十字会 / 行业协会 | 大规模事故时辅助救援 / 物资支援 |',
    ].map((r, i) => `| ${i + 1} ${r}`),
    '**外部资源调用程序**：',
    `- **事故发生 → 立即报告**：由总指挥（或值班负责人）在事故发生后 1 小时内向 ${bureau} 报告；符合《生产安全事故报告和调查处理条例》（国务院第 493 号令）情形的，同步上报市级及以上应急管理部门。`,
    '- **拨打外部专业电话**：火警 119、医疗 120、治安 110 — 由通讯联络组在现场负责人确认事故级别后立即拨打，详见 3.1 信息报告与附件10 报警流程。',
    `- **邻企互助启动**：${f.hasMutualAid ? '根据签订的互助协议，' : ''}通过应急通讯录直接联络周边企业应急负责人，通报情况并提出援助请求。`,
    `- **专业救援队请求**：超出本单位处置能力时，由总指挥通过 ${bureau} 调度属地${chem ? '危化品 / ' : ''}工业事故专业救援队伍，本单位提供工艺资料、${chem ? '危化品资料、' : ''}平面图等技术支持。`,
    `**应协议化的外部资源**：${agreedText}公司应${[
      medicalAgreement(ctx) ? '' : `与 ${ctx.hospital} 签订应急医疗救援协议`,
      `与 ${a.fireDept?.name || '属地消防救援机构'} 建立应急联动机制`,
      f.hasMutualAid ? '' : '与周边企业签订应急互助协议',
    ]
      .filter(Boolean)
      .join('、')}。`,
    '**三、应急资源差距分析与补强对策**',
    '本节对照附件2 风险评估的结果，**对应急资源现状开展差距分析**，识别**本单位内部**应急资源与外部可依托资源的不足之处，并提出补强对策。',
    '**已识别的资源差距（本单位内部）**：',
    `1. **专业救援能力差距**：本单位无专职消防救援队，${specialRisks.length ? `${specialRisks.join('、')}等` : ''}专业事故依赖外部专业救援力量，外部力量到场前的初期处置只能依靠本单位应急小组。`,
    `2. **重型抢险装备差距**：本单位未配备消防车、举高车、${chem ? '专业危化品堵漏器材、' : ''}大功率排烟机等重型装备，大型火灾${chem ? '、危化品泄漏' : ''}的初期处置受限，需依赖 119 消防力量。`,
    `3. **专业医疗救治差距**：本单位现场医疗资源以${firstAidText(ctx)}为主，无医务室与驻厂医生；严重创伤、烧烫伤${chem ? '、化学品中毒' : ''}等需立即转运至属地医院专业救治。`,
    '4. **夜班 / 节假日值守差距**：夜班与节假日厂区仅留少量值班人员，夜间事故初期响应力量薄弱。',
    '**已识别的资源差距（外部 / 社会层面）**：',
    '- 外部专业救援力量的到场时间取决于驻点距离与道路状况，须在年度调查中实地核实；',
    f.hasMutualAid
      ? '- 邻企互助协议执行力依赖对方应急体系成熟度，实际事故时增援能力存在不确定性；'
      : '- 与周边企业的互助尚未协议化，实际事故时增援能力存在不确定性；',
    '- 社会公众应急救援志愿力量（如红十字救护员）主要服务于公共突发事件，工业事故响应优先级较低。',
    '**补强对策与实施计划**：',
    '| 序号 | 差距项 | 补强对策 | 责任部门 | 完成时限 |',
    '| --- | --- | --- | --- | --- |',
    `| 1 | 内部专业救援能力 | 在抢险救灾组内培养持证消防设施操作员${chem ? '与危化品处置专业人员' : ''}；每年增加 1 次外部专业培训 | 安全管理部门 | 当年完成 |`,
    `| 2 | 重型抢险装备 | 与属地消防大队签订重型装备应急调用备忘录；评估自购小型消防泵${chem ? ' + 防化堵漏套件' : ''}可行性 | 综合保障组 | 半年内 |`,
    '| 3 | 医疗救治时效 | 与属地医院落实「应急绿色通道」协议；新增 1 名持证现场急救员 | 安全管理部门 | 当年完成 |',
    '| 4 | 夜班 / 节假日响应 | 完善 24 小时值班制度，夜班值班人员定时巡查；关键设备远程监测报警接入值班室 | 综合保障组 | 即时落实 |',
    '| 5 | 邻企互助实效 | 与周边企业签订应急互助协议，每年开展 1 次联合演练，核实可执行性 | 安全管理部门 | 每年一次 |',
    '**动态更新机制**：',
    '- 本应急资源调查报告每年至少全面更新一次，工艺变更、设备新增、人员调整、风险评估结果变化、外部联动单位变化时即时同步更新；',
    '- 更新责任：安全管理部门组织实施，综合保障组提供物资装备数据，人力资源部门提供人员数据；',
    `- 更新结果同步纳入预案修订流程，修订后报 ${bureau} 备案；`,
    '- 内审与外审：本调查报告纳入年度安全生产标准化自评与第三方评审范围，作为评估应急保障能力的关键依据。',
  ].join('\n');
}

// ── 附件9 应急培训计划与演练安排 ──
function trainingPlan(ctx: PlanContext): string {
  const { input, company } = ctx;
  // 安全管理负责人：组织里有职务含「安全」的人用其职务，否则写「安全管理人员」
  const lead = safetyLead(ctx) === '总指挥' ? '安全管理人员' : safetyLead(ctx);
  const facts = input.expert.facts ?? {};
  const principal = fill(input.basic.responsiblePerson || input.basic.legalRepresentative);
  const budget = fill(facts.training?.budget);
  const dept = fill(facts.training?.department);
  const practice = practiceItemsText(ctx);
  const consumables = hasAed(ctx) ? '灭火器年检后填充、空气呼吸器气瓶充气、AED 电极片更换等' : '灭火器年检后填充、空气呼吸器气瓶充气、急救药品更换等';
  const keyPosts = [ctx.signals.melting ? '熔铸工、压铸机操作工' : '', '电工', ctx.scope.pressureVessel ? '压力容器操作人员' : '', '消防安全管理员']
    .filter(Boolean)
    .join('、');
  const groups = input.organization.groups.map((g) => ctx.groupName(g)).join('、');
  const chemicalDrill = ctx.hazardous.length
    ? `| 4 月 | 化学品${ctx.chemNote}泄漏现场处置 | 抢险救灾组 + 关键岗位 | 桌面推演 + 现场实操 | 6 | 安全员 + 化学品供应商技术员 |`
    : '| 4 月 | 典型事故现场处置（结合本企业风险） | 抢险救灾组 + 关键岗位 | 桌面推演 + 现场实操 | 6 | 安全员 |';
  return [
    '# 应急培训计划与演练安排',
    `本节按粤安监〔2012〕35 号 第二十八条、第二十九条要求，制定${company}**年度应急培训与演练计划**，确保全体从业人员（共 ${fill(input.basic.employeeCount)} 人）具备必要的应急知识、风险防范技能与事故应急处置能力，并通过定期演练检验和提升预案的有效性、可操作性。培训与演练所需经费由公司年度安全生产专项费用列支预算 **${budget}**，由 **${dept}** 总抓落地。`,
    '**1）培训对象与差异化要求**',
    '| 培训对象 | 年度最低学时 | 培训内容侧重 | 考核方式 |',
    '| --- | --- | --- | --- |',
    `| 主要负责人（${principal}）及其他公司层级负责人 | 不少于 16 学时 | 安全生产法律法规、应急预案体系、重大风险辨识、事故案例剖析、I/II 级响应的政府对接义务 | 笔试 + 应急管理部门组织的专门培训考核（取得合格证书） |`,
    '| 安全管理人员（含专职、兼职安全员） | 不少于 24 学时 | GB/T 29639 标准、本预案体系、风险评估（LEC）、演练设计与组织、现场指挥技巧 | 笔试 + 实操（组织 1 次演练评估） |',
    `| 应急小组成员（${groups}） | 不少于 16 学时 | 本岗位职责、应急器材使用（${practice}）、自救互救、协同指挥流程 | 笔试 + 实操（器材操作 + 模拟事故处置） |`,
    `| 关键岗位（${keyPosts}等持证上岗岗位） | 不少于 12 学时 | 本岗位事故风险、应急处置操作规程、个体防护用品正确佩戴、互救方法 | 笔试 + 实操 + 每年至少 1 次盲测 |`,
    '| 全员（所有从业人员） | 不少于 8 学时 | 厂区疏散路线、应急集合点、报警流程、灭火器使用、心肺复苏基础、举手报告制度 | 现场考核（报警 + 疏散 + 灭火器实操） |',
    '| 新员工（岗前） | 不少于 24 学时（含 8 学时应急专项） | 公司安全生产管理制度、本岗位安全操作规程、应急预案要点、本岗位风险与应急处置 | 笔试 + 实操（合格后方可上岗，不合格补训再考） |',
    '**特别说明**：外来人员（承包商作业人员、参观访客）进入厂区前由安全员进行 ≥ 15 分钟的「入厂安全告知 + 应急疏散告知」，签字确认后方可进入；在厂内连续作业超过 30 天的承包商，须随同本公司员工接受全员培训。',
    '**2）培训形式**',
    '采用「集中授课 + 现场实操 + 桌面推演 + 在线学习」四种形式组合，按学员类型与培训内容选择最有效形式：',
    '- **集中授课**：法规标准、案例分析、预案解读 — 主要用于公司层级和年度全员培训',
    '- **现场实操**：应急器材使用、疏散、灭火、心肺复苏 — 在应急器材存放点及厂区空旷地带现场进行',
    '- **桌面推演**：总指挥层级应急决策训练、跨部门协同 — 季度组织 1 次，公司主要负责人参加',
    '- **在线学习**：法规更新、外部事故案例 — 通过省市应急管理部门培训平台或公司内部学习平台进行，辅助形式',
    '**3）年度培训计划安排表**',
    '| 月份 | 培训主题 | 对象 | 形式 | 学时 | 主讲 / 主办 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| 1 月 | 年度安全工作部署 + 应急预案宣贯 | 全员 | 集中授课 | 4 | 主要负责人 + ${lead} |`,
    '| 2 月 | 关键岗位操作规程复训 + 个体防护 | 关键岗位 | 现场实操 | 4 | 安全员 + 车间负责人 |',
    `| 3 月 | 应急小组器材实操（${practice}） | 抢险救灾组 | 现场实操 | 8 | 外聘专业救援队教官 |`,
    chemicalDrill,
    `| 5 月 | 上半年现场处置方案演练（火灾） | 全员 | 演练（现场实操） | 4 | 总指挥 + ${lead} |`,
    '| 6 月 | 半年应急工作回顾 + 案例剖析 | 公司层级 + 安管人员 | 集中授课 | 4 | 主要负责人 |',
    '| 7 月 | 新员工岗前应急专项（滚动开展） | 当月新员工 | 集中授课 + 实操 | 8 | 人力资源部门 + 安全员 |',
    '| 8 月 | 高温季节中暑 + 触电事故应急处置 | 全员 | 集中授课 + 现场实操 | 4 | 安全员 |',
    '| 9 月 | 综合应急预案桌面推演 | 公司全部应急组织 | 桌面推演 | 4 | 总指挥 |',
    `| 10 月 | 下半年现场处置方案演练（机械伤害 / 高处坠落） | 关键岗位 + 抢险救灾组 | 演练（现场实操） | 4 | 总指挥 + ${lead} |`,
    '| 11 月 | **年度综合应急预案演练** | 全员 + 外部联动单位 | 演练（综合） | 8 | 总指挥（邀属地应急办观摩） |',
    `| 12 月 | 年度培训考核 + 档案归档 + 来年计划修订 | 公司层级 + 安管人员 | 考核 + 复盘 | 4 | ${lead} |`,
    '**滚动机制**：新员工岗前培训不固定月份，按实际入职批次每月滚动开展，由人力资源部门触发、安全员组织、车间负责人配合现场实操。',
    '**4）演练计划与频次**',
    '本公司年度**应急演练计划**按粤安监〔2012〕35 号 第三十二条要求执行，综合应急预案演练**每年**至少 1 次、现场处置方案演练**每半年**至少 1 次，具体频次与组织方式如下：',
    '- **综合应急预案演练**：每年至少组织 **1 次**，通常安排在 11 月。综合演练需覆盖应急组织全员、模拟 III 级及以上响应、邀请属地应急管理局 / 街道应急办观摩并提交演练评估报告。',
    '- **专项应急预案演练**：每年至少组织 **1 次**，根据本企业风险结构与上年度演练评估结果选择重点专项，与综合演练月份错开。',
    '- **现场处置方案演练**：每半年至少组织 **1 次**（即每年至少 2 次），分别在 5 月 / 10 月组织，由车间负责人组织本工段员工开展，无需公司层级全员参与，但安全员必须到场评估。',
    `- **每次演练后 30 日内**：必须形成书面演练评估报告（含演练经过、暴露问题、整改措施、整改责任人、整改时限），报${lead}批准，由综合保障组归档。`,
    '**5）考核、不合格补训与上岗联动**',
    '- **考核合格标准**：笔试 ≥ 80 分（法规与本预案要点）+ 实操 100% 完成（关键动作不能漏）；全员培训采用现场考核（疏散到位 + 灭火器实操完成即视为合格）',
    '- **不合格处理**：首次不合格补训后再考，二次不合格的关键岗位人员**暂停上岗**，接受脱产再培训直至考核合格；新员工不合格不得正式上岗',
    '- **持证岗位**：特种作业人员（电工、压力容器操作）按国家规定取得资格证；消防安全管理员、抢险救灾组核心成员须取得应急管理部门组织的应急救援员等专项证书',
    '**6）经费保障**',
    `本年度应急培训与演练专项预算 **${budget}**，列入公司安全生产费用提取与使用计划，专款专用，不得挪作他用。具体使用方向：`,
    '- 外聘讲师 / 救援队教官费用',
    '- 培训教材、个体防护用品、演练道具采购',
    `- 应急器材年度复训耗材（${consumables}）`,
    '- 演练评估外部专家咨询费',
    '- 应急救援员等专项资格证书考试费（公司报销）',
    `经费每季度由综合保障组核算上报${lead}，半年和年度审计跟随公司财务审计执行。`,
    '**7）培训档案与可追溯性**',
    `所有培训与演练必须形成完整记录，由 **${dept}** 归档，留存期限不少于 **5 年**（满足应急管理部门检查与事故倒查溯源要求）。每一次培训 / 演练的档案必须包含：`,
    '- 培训 / 演练计划通知单（含主题、时间、地点、对象、主讲）',
    '- 签到表（参训人员本人签字，缺训人员标注原因，后续补训跟踪）',
    '- 培训教材 / 演练脚本 / 课件 / 操作规程',
    '- 考核成绩单（笔试卷面 + 实操评分单）',
    '- 演练评估报告（含暴露问题与整改闭环）',
    '- 影像资料（关键演练环节照片或视频）',
    `档案以纸质 + 电子双轨保存：纸质件存放在安全管理部门档案柜，电子件存放在公司内部系统对应目录，由专人负责录入与备份。应急管理部门来检查时须 5 分钟内调阅出近 3 年任意一次培训 / 演练记录。`,
  ].join('\n');
}

// ── 附件10 报警流程 ──
function alarmFlow(): string {
  return [
    '# 报警流程',
    '[[figure:alarm-flow]]',
    '**报警流程图**',
    '**报警流程说明**：',
    '（1）「发现即报」是底线，任何员工目击事故 / 险情都必须在 1 分钟内向现场负责人或最近班组长报告。',
    '（2）现场负责人评估等级时，如无法判定，默认按高一级别上报，严禁压报瞒报。',
    '（3）总指挥根据级别决定是否启动综合预案 / 专项预案 / 现场处置方案。',
    '（4）外部联动由通讯联络组在总指挥确认后立即拨打，详见 5.1 通信与信息保障与附件5 有关应急部门、机构或人员的联系方式。',
    '（5）整个报警链路要求 5 分钟内闭环到总指挥层级。',
  ].join('\n');
}
