// 生成整份应急预案的文档结构：封面、批准发布令、编制小组，然后是
// 一、综合应急预案；二、… 各专项应急预案；现场处置方案；附件（GB/T 29639-2020 的件、章结构，与旧仓库一致）。
// 适用范围按专家确认的开关（没确认的用系统建议），图由共用规则画好转成 PNG 放进 Word。
import {
  CHART_ORDER,
  COMMANDER_DUTY,
  DEPUTY_DUTY,
  GROUP_LEADER_DUTIES,
  alarmFlowSvg,
  flowOptionsOf,
  orderGroups,
  orgChartSvg,
  planSystemSvg,
  processFlowSvg,
  responseFlowSvg,
  type DeliveryDocument,
  type DocSection,
  type FrontPage,
  type PlanInput,
  type PlanTemplate,
  type Svg,
} from '@genyun/shared';
import type { FilledSlots } from '../ai/slots.ts';
import { svgToPng } from '../word/png.ts';
import { DRAWINGS, attachments, type DrawingKey } from './attachments.ts';
import { comprehensiveMarkdown } from './comprehensive.ts';
import { templateBody, usesKnowledgeBlock } from './content.ts';
import { humanize } from './humanize.ts';
import { MISSING, cnDate, commsMeans, fill, hazardArea, ownGroupNames, planContext, type PlanContext } from './context.ts';
import { parseMarkdown, toSections, type Figure } from './markdown.ts';

/** 客户上传的图纸（已转成图片）；PDF 图纸转图片在第 10 项接上 */
export type PlanDrawings = Partial<Record<DrawingKey, { png: Uint8Array; width: number; height: number }>>;

const CN = '一二三四五六七八九十';
const cnOrdinal = (n: number) => (n <= 10 ? CN[n - 1]! : n < 20 ? `十${CN[n - 11] ?? ''}` : String(n));

const INTRO =
  '本章是公司应对各类生产安全事故的综合性、纲领性工作方案，统辖「专项应急预案」与「现场处置方案」，规定本企业应急工作的适用范围与响应分级、应急组织机构及职责、信息报告、预警机制、响应启动、应急处置、应急支援、响应终止、后期处置以及通信与信息、应急队伍、物资装备等应急保障的共性条款。具体分事故的处置程序见对应的专项应急预案与现场处置方案，本章与其相互衔接、共同构成本企业完整的生产安全事故应急预案体系。';


function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const figure = (s: Svg, placement: Figure['placement'] = 'inline'): Figure => ({ type: 'figure', ...svgToPng(s.svg), placement });

/** 模板里的 {{占位符}} 换成企业数据；没有数据的写「（待补充）」。t 是正在填的那份方案（事故区域按它取） */
function placeholders(ctx: PlanContext, t?: PlanTemplate): Record<string, string> {
  const p = ctx.input.production;
  const s = ctx.signals;
  const hazardousMaterials = p.materials.filter((m) => ctx.hazardous.includes(m.name));
  const join = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x?.trim())))].join('、');
  const elevators = p.equipment.filter((e) => /电梯/.test(e.name));
  const boilers = p.equipment.filter((e) => /锅炉|蒸汽|空压机|储气罐|压力容器/.test(e.name));
  // 火灾知识块的特殊场景：按企业实有的液压设备、可燃液体存放处、产尘工序带出，没有的不写
  const hydraulic = join(s.hydraulicFireSources);
  const liquidAt = join(hazardousMaterials.filter((m) => s.flammableLiquids.some((l) => m.name.includes(l))).map((m) => m.storageLocation));
  const liquids = join(s.flammableLiquids);
  const dustSteps = join(s.dustWorkstations);
  const fireScenes = [
    hydraulic && `${hydraulic}高压液压油泄漏喷射遇火`,
    liquids && `${liquidAt || '存放处'}内小量${liquids}遇明火火花引燃`,
    dustSteps && `${dustSteps}工序沉积粉尘遇火高温扰动二次燃爆`,
  ].filter(Boolean);
  return {
    COMPANY_24H_PHONE: ctx.dutyPhone,
    STREET_OFFICE_NAME: ctx.street,
    STREET_OFFICE_PHONE: fill(ctx.streetPhone),
    FIRE_DEPT_NAME: ctx.fireDept,
    FIRE_DEPT_PHONE: ctx.firePhone,
    EMERGENCY_BUREAU_NAME: ctx.bureau,
    EMERGENCY_BUREAU_PHONE: fill(ctx.bureauPhone),
    REPRESENTATIVE_CHEMICALS: fill(join(hazardousMaterials.slice(0, 3).map((m) => m.name))),
    CHEMICAL_STORAGE_LOCATIONS: fill(join(hazardousMaterials.map((m) => m.storageLocation))),
    COMBUSTIBLE_GAS: join(s.combustibleGases) || '可燃气体',
    GAS_LOCATIONS: fill(join(s.gasLocations)),
    GAS_FURNACES: join(s.gasFurnaces),
    DUST_KINDS: join(s.dustKinds) || '可燃粉尘',
    DUST_SOURCES: fill(join(s.dustSources)),
    HEAT_SOURCES: join(s.heatSources),
    MACHINE_AREAS: join(s.dangerMachineAreas) || (t ? hazardArea(ctx.input, t.title) : '') || '机械加工作业区域',
    VEHICLES: join(s.internalVehicles),
    LITHIUM_ITEMS: join(s.lithiumItems),
    HYDRAULIC_EQUIP: join(s.hydraulicFireSources),
    HAZARD_AREA: t ? hazardArea(ctx.input, t.title) : '',
    DUST_STEPS: dustSteps,
    DUST_SOURCE_TEXT: s.dustSources.length ? `${join(s.dustSources)}等产尘环节` : '产尘工序',
    DUST_AREA: join(s.dustAreas) || '产尘作业场所',
    DUST_COLLECTOR: s.dustCollectors.length ? `及${join(s.dustCollectors)}` : '',
    // 灼烫：没有危险化学品时不写化学灼伤
    CHEM_MISUSE: ctx.hazardous.length ? '；使用化学品操作失当' : '',
    CHEM_BURN: ctx.hazardous.length ? '、化学灼伤' : '',
    BURN_CHEM: ctx.hazardous.length
      ? `生产过程中需使用到 \`${fill(join(hazardousMaterials.slice(0, 3).map((m) => m.name)))}\` 等化学品，员工若操作不当不慎接触皮肤、眼睛，可能发生化学品灼伤事故；`
      : '',
    BURN_AREA: (t && hazardArea(ctx.input, t.title)) || '生产车间',
    FIRE_SCENES: fireScenes.map((x) => `；${x}`).join(''),
    FIRE_EXTRA: [hydraulic && `${hydraulic}液压油泄漏`, liquids && `${liquidAt || ''}${liquids}`, dustSteps && `${dustSteps}积尘`]
      .filter(Boolean)
      .map((x) => `、${x}`)
      .join(''),
    FIRE_KEY_SPOTS:
      [s.furnaceEquip.length ? `${join(s.furnaceEquip)}作业区` : '', dustSteps && `${dustSteps}工位`, liquidAt].filter(Boolean).join('、') || '生产车间',
    FIRE_SIGNS: [hydraulic && '液压油喷射', dustSteps && '积尘扬尘'].filter(Boolean).map((x) => `、${x}`).join(''),
    // 了解起火点、逐区域通知的手段：资料里有监控、广播才写
    CHECK_MEANS: ctx.facts.hasCctv ? '视频监控、电话或巡逻人员' : '电话或巡逻人员',
    ALARM_MEANS: commsMeans(ctx).filter((m) => m !== '电话').join('、'),
    COMMS: commsMeans(ctx).join('、'),
    DUST_WORKSHOPS: fill(
      join(p.processFlow.steps.filter((s) => /喷砂|抛光|打磨|研磨|抛丸|CNC/i.test(s.name)).map((s) => s.name)) ||
        join(p.buildings.filter((b) => /粉|喷|打磨/.test(`${b.name}${b.remarks ?? ''}`)).map((b) => b.name)),
    ),
    ELEVATOR_LOCATION: fill(join(elevators.map((e) => e.location))),
    ELEVATOR_TYPE: fill(join(elevators.map((e) => e.spec))),
    BOILER_OR_STEAMER: fill(join(boilers.map((e) => e.name))),
    BOILER_LOCATION: fill(join(boilers.map((e) => e.location))),
  };
}

/** 模板里按企业情况取舍的段落：单独一行 [[if:elevator|craneHoist]] … [[endif]]，任一为真保留，!key 取反 */
export function applyConditions(md: string, flags: Record<string, boolean>): string {
  const out: string[] = [];
  const stack: boolean[] = [];
  for (const line of md.split('\n')) {
    const open = /^\s*\[\[if:([!\w|]+)\]\]\s*$/.exec(line);
    if (open) {
      const keep = open[1]!.split('|').some((k) => {
        const key = k.replace(/^!/, '');
        if (!(key in flags)) throw new Error(`模板里有未知的条件：${k}`);
        return k.startsWith('!') ? !flags[key] : flags[key];
      });
      stack.push(keep);
      continue;
    }
    if (/^\s*\[\[endif\]\]\s*$/.test(line)) {
      if (!stack.length) throw new Error('模板条件段多了 [[endif]]');
      stack.pop();
      continue;
    }
    if (stack.every(Boolean)) out.push(line);
  }
  if (stack.length) throw new Error('模板条件段缺少 [[endif]]');
  return out.join('\n');
}

function fillPlaceholders(md: string, values: Record<string, string>): string {
  return md.replace(/\{\{([A-Z0-9_]+)\}\}/g, (all, key: string) => {
    const v = values[key];
    if (v === undefined) throw new Error(`模板里有未知的占位符：${all}`);
    return v;
  });
}

function compilationTeam(ctx: PlanContext): string[][] {
  const org = ctx.input.organization;
  if (org.compilationTeam?.leader) {
    const t = org.compilationTeam;
    return [
      ['组长', t.leader!.name, t.leader!.title ?? '', t.leader!.duty ?? ''],
      ...t.members.map((m) => ['编制组成员', m.name, m.title ?? '', m.duty ?? '']),
    ];
  }
  // 与自填第 2 步页面同一规则：总指挥任组长，副总指挥和各组组长任成员
  const rows: string[][] = [];
  if (org.commander) rows.push(['组长', org.commander.name, '总指挥', COMMANDER_DUTY]);
  for (const d of org.deputies) rows.push(['编制组成员', d.name, '副总指挥', DEPUTY_DUTY]);
  const groups = [...org.groups].sort((a, b) => CHART_ORDER.indexOf(a.kind) - CHART_ORDER.indexOf(b.kind));
  for (const g of groups) if (g.leader) rows.push(['编制组成员', g.leader.name, `${g.name}组长`, GROUP_LEADER_DUTIES[g.kind]]);
  return rows;
}

/** 模板里 [[if:key]] 可用的开关：适用范围、有无危化品、资料依据（facts）、设备物料推出的情况 */
export function templateFlags(ctx: PlanContext, t?: PlanTemplate): Record<string, boolean> {
  const s = ctx.signals;
  return {
    ...ctx.scope,
    ...ctx.facts,
    hazardousChemicals: ctx.hazardous.length > 0,
    // 这类事故有专家确认的危险源场所：事故区域按它写
    expertArea: Boolean(t && hazardArea(ctx.input, t.title)),
    boiler: s.boiler,
    lithium: s.lithium,
    combustibleGases: s.combustibleGases.length > 0,
    gasLocations: s.gasLocations.length > 0,
    gasTanks: s.gasTanks,
    gasPipeline: s.gasPipeline,
    gasFurnaces: s.gasFurnaces.length > 0,
    hydraulic: s.hydraulicFireSources.length > 0,
    dustSources: s.dustSources.length > 0,
    woodDust: s.dustKinds.includes('木粉尘'),
    resinDust: s.dustKinds.some((k) => k.includes('树脂粉尘')),
    powderDust: s.dustKinds.some((k) => k.includes('有机粉尘')),
    heatSources: s.heatSources.length > 0,
    vehicles: s.internalVehicles.length > 0,
    flammableLiquids: s.flammableLiquids.length > 0,
  };
}

/** 模板填好企业数据、按企业情况取舍、去掉内部编号后的正文 */
function resolvedTemplate(ctx: PlanContext, t: PlanTemplate, filled: FilledSlots): string {
  return humanize(fillPlaceholders(applyConditions(templateBody(t, ctx.signals, filled[t.id]), templateFlags(ctx, t)), placeholders(ctx, t)));
}

/** AI 改写过的「事故风险描述」段：模板编号 → 系统原文 → 改写（已校验） */
export type RiskRewrites = Record<string, Record<string, string>>;

/**
 * 现场处置方案「事故风险描述」里可由 AI 按企业改写的段落（系统原文）。
 * 用了知识块的方案已按企业写好并经专家核过，不再改写；加粗小标题、表格不动。
 */
export function riskParagraphs(input: PlanInput): { id: string; title: string; paragraphs: string[] }[] {
  const ctx = planContext(input);
  return ctx.selection.site
    .filter((t) => !usesKnowledgeBlock(t, ctx.signals))
    .map((t) => {
      const md = resolvedTemplate(ctx, t, {});
      const section = /^## 事故风险描述\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md)?.[1] ?? '';
      const paragraphs = section
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^(#|\*\*|\||!\[|<)/.test(l));
      return { id: t.id, title: t.title, paragraphs };
    })
    .filter((x) => x.paragraphs.length > 0);
}

/**
 * filled 是 AI 起草时已校验的知识块空位（见 ai/slots.ts），rewrites 是已校验的风险描述改写（见 ai/risk.ts）；
 * 没有就全部用系统推出的内容
 */
export function buildPlan(
  input: PlanInput,
  drawings: PlanDrawings = {},
  filled: FilledSlots = {},
  rewrites: RiskRewrites = {},
): DeliveryDocument {
  const ctx = planContext(input);
  const { company, selection } = ctx;
  const year = input.issuedOn.slice(0, 4);
  const shortName = input.expert.facts?.shortName?.trim();
  const code = shortName ? `${shortName}${year}` : MISSING;
  const version = `A ${year}`;
  const issued = cnDate(input.issuedOn);
  const templateMarkdown = (t: PlanTemplate) => {
    const md = resolvedTemplate(ctx, t, filled);
    const r = rewrites[t.id];
    return ownGroupNames(r ? md.split('\n').map((l) => r[l.trim()] ?? l).join('\n') : md, input);
  };

  const org = input.organization;
  const groups = [...org.groups].sort((a, b) => CHART_ORDER.indexOf(a.kind) - CHART_ORDER.indexOf(b.kind));
  const upper = [input.agencies.districtPlan, input.agencies.streetPlan].filter((x): x is string => Boolean(x));
  // 专家在图件里微调过的画法（第 9 项）
  const figs = input.expert.figures;
  const steps = input.production.processFlow.steps.map((s) => s.name);
  const providedDrawings = (Object.keys(DRAWINGS) as DrawingKey[]).filter((k) => drawings[k]);
  const figures: Record<string, Figure> = {
    'org-chart': figure(
      orgChartSvg({
        deputy: figs?.org?.deputy ?? org.deputies.length > 0,
        office: figs?.org?.office,
        groups: orderGroups(
          groups.map((g) => g.name),
          figs?.org?.order,
        ),
      }),
    ),
    'response-flow': figure(responseFlowSvg(), 'page'),
    'process-flow': figure(processFlowSvg(steps, flowOptionsOf(steps, figs?.process))),
    'plan-system': figure(
      planSystemSvg({ upper, company, specialty: selection.specialty.map((t) => t.title), site: selection.site.map((t) => t.title) }),
    ),
    'alarm-flow': figure(alarmFlowSvg({ commander: ctx.commander ? fill(ctx.commander.name) : MISSING, bureau: ctx.bureau })),
  };
  for (const k of providedDrawings) figures[`drawing-${k}`] = { type: 'figure', ...drawings[k]!, caption: DRAWINGS[k], placement: 'landscape' };

  const sections: DocSection[] = [];
  let part = 0;

  // 一、综合应急预案：# 章 1.、## 节 1.1、### 小节 1.1.1
  const comprehensive = parseMarkdown(ownGroupNames(comprehensiveMarkdown(ctx), input), figures);
  sections.push({
    id: 'plan.comprehensive',
    title: `${cnOrdinal(++part)}、综合应急预案`,
    blocks: [{ type: 'paragraph', text: [INTRO] }],
    sections: toSections(comprehensive.sections, 'plan.comprehensive', {
      maxDepth: 3,
      title: (path, t) => (path.length === 1 ? `${path[0]}. ${t}` : `${path.join('.')} ${t}`),
    }),
  });

  // 二、… 专项应急预案：模板一级标题是预案名，二级是五要素（1. 适用范围…），再往下是加粗段落
  for (const t of selection.specialty) {
    const parsed = parseMarkdown(templateMarkdown(t), figures);
    const root = parsed.sections[0];
    sections.push({
      id: `plan.specialty.${t.id}`,
      title: `${cnOrdinal(++part)}、${t.title}`,
      blocks: [...parsed.blocks, ...(root?.blocks ?? [])],
      sections: toSections(root?.children ?? [], `plan.specialty.${t.id}`, { maxDepth: 1, title: (path, x) => `${path[0]}. ${x}` }),
    });
  }

  // 现场处置方案：一件，每个方案一章（1. 火灾事故现场处置方案），往下 1.1、1.1.1
  const sites = selection.site.map((t) => {
    const parsed = parseMarkdown(templateMarkdown(t), figures);
    const root = parsed.sections[0];
    return { title: t.title, blocks: [...parsed.blocks, ...(root?.blocks ?? [])], children: root?.children ?? [], id: t.id };
  });
  sections.push({
    id: 'plan.site',
    title: `${cnOrdinal(++part)}、现场处置方案`,
    blocks: sites.length ? [] : [{ type: 'paragraph', text: ['本企业无适用的现场处置方案。'] }],
    sections: sites.map((s, i) => ({
      id: `plan.site.${s.id}`,
      title: `${i + 1}. ${s.title}`,
      blocks: s.blocks,
      sections: toSections(s.children, `plan.site.${s.id}`, { maxDepth: 2, title: (path, x) => `${i + 1}.${path.join('.')} ${x}` }),
    })),
  });

  // 附件：附件1、…；附件内 附1.1.、附1.1.1.；每个附件另起一页
  sections.push({
    id: 'plan.attachments',
    title: `${cnOrdinal(++part)}、附件`,
    blocks: [],
    childrenOnNewPage: true,
    sections: attachments(ctx, providedDrawings).map((a, i) => {
      const parsed = parseMarkdown(ownGroupNames(a.markdown, input), figures);
      const root = parsed.sections[0]!;
      const n = i + 1;
      return {
        id: `plan.attachment.${a.key}`,
        title: `附件${n}、${root.title}`,
        blocks: root.blocks,
        sections: toSections(root.children, `plan.attachment.${a.key}`, { maxDepth: 2, title: (path, x) => `附${n}.${path.join('.')}. ${x}` }),
      };
    }),
  });

  const frontPages: FrontPage[] = [
    {
      title: '预案批准发布令',
      blocks: [
        {
          type: 'paragraph',
          text: [
            `为贯彻《中华人民共和国安全生产法》及其它法律、法规和有关文件要求，确保公司员工的生命财产安全，减少公司财产损失，在事故发生后能快速、有效、有序地实施救援，公司组织相关部门和人员根据《中华人民共和国安全生产法》、《中华人民共和国突发事件应对法》、《生产安全事故应急条例》中华人民共和国国务院令第708号、《生产安全事故应急预案管理办法》（应急管理部令第2号《应急管理部关于修改〈生产安全事故应急预案管理办法〉的决定》修正）的要求，组建了${company}应急预案编制小组，按照《生产经营单位生产安全事故应急预案编制导则》（GB/T 29639-2020）及《广东省应急管理局关于〈生产安全事故应急预案管理办法〉的实施细则》的通知（粤安监应急〔2017〕9号），编制了《${company}生产安全事故应急救援预案》预案编号：${code}，版本号：${version}。`,
          ],
        },
        {
          type: 'paragraph',
          text: [
            '该预案是本公司实施应急救援的规范性文件，用于指导本公司生产安全事故的应急救援行动，本应急救援预案提供了紧急情况下的工作要求和应急程序，是公司安全生产经营的保障，本应急救援预案包括综合预案、专项预案及现场处置方案组成，经公司内部评审通过，并由生产安全事故应急预案评审专家组审查通过，现将预案予以颁布，并实施，本公司所有部门均严格遵守执行。',
          ],
        },
      ],
      signature: [`签发：主要负责人 ${fill(input.basic.legalRepresentative)}`, `单位（盖章）：${company}`, `颁布日期：${issued}`],
    },
    {
      title: '应急预案编制小组',
      blocks: [
        {
          type: 'paragraph',
          text: [`${company}组织相关部门和人员组建应急预案编制小组，负责本预案的编制、评审、修订与维护；成员构成及分工如下：`],
        },
        {
          type: 'table',
          header: [['序号', '项目', '姓名', '应急职务', '分工', '签名']],
          rows: compilationTeam(ctx).map((r, i) => [String(i + 1), ...r, '']),
        },
      ],
    },
  ];

  return {
    kind: 'plan',
    title: `${company}生产安全事故应急预案`,
    cover: {
      company,
      name: '生产安全事故应急预案',
      code,
      version,
      lines: [company],
      dates: [`发布日期：${issued}`, `实施日期：${cnDate(nextDay(input.issuedOn))}`],
    },
    frontPages,
    sections,
  };
}
