// 排版验收用的样例文档：文字取自飞宇批注版样板，覆盖排版规范里的每种情况
// （封面、批准发布令、编制小组、目录、各级标题、列表、表格、随正文的图、单独占页的图、附件逐个起页、横版图纸）。
// 只用来检查排版，内容不代表生成结果。
import type { Block, DeliveryDocument } from '@genyun/shared';
import { svgToPng } from './png.ts';

const P = (...text: string[]): Block[] => text.map((t) => ({ type: 'paragraph', text: [t] }));

function box(x: number, y: number, w: number, h: number, label: string, vertical = false): string {
  const text = vertical
    ? [...label].map((ch, i) => `<text x="${x + w / 2}" y="${y + 22 + i * 18}" text-anchor="middle">${ch}</text>`).join('')
    : `<text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle">${label}</text>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="1.2"/>${text}`;
}

function orgChart() {
  const groups = ['抢险救灾组', '综合保障组', '通讯联络组'];
  const gx = (i: number) => 60 + i * 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" font-family="SimSun, 宋体" font-size="14">
    ${box(150, 10, 100, 34, '总指挥')}<line x1="200" y1="44" x2="200" y2="70" stroke="#000"/>
    ${box(150, 70, 100, 34, '副总指挥')}<line x1="200" y1="104" x2="200" y2="130" stroke="#000"/>
    <line x1="${gx(0) + 20}" y1="130" x2="${gx(2) + 20}" y2="130" stroke="#000"/>
    ${groups.map((g, i) => `<line x1="${gx(i) + 20}" y1="130" x2="${gx(i) + 20}" y2="150" stroke="#000"/>${box(gx(i), 150, 40, 120, g, true)}`).join('')}
  </svg>`;
  return svgToPng(svg);
}

function responseFlow() {
  const steps = ['事故发生', '现场级响应/处置', '事态控制', '响应升级', '应急增援', '应急结束', '善后处理'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${steps.length * 70}" font-family="SimSun, 宋体" font-size="14">
    ${steps.map((s, i) => `${box(70, 10 + i * 70, 160, 34, s)}${i < steps.length - 1 ? `<line x1="150" y1="${44 + i * 70}" x2="150" y2="${80 + i * 70}" stroke="#000"/>` : ''}`).join('')}
  </svg>`;
  return svgToPng(svg);
}

function drawing(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" font-family="SimSun, 宋体" font-size="40">
    <rect x="4" y="4" width="1192" height="752" fill="#F2F2F2" stroke="#000" stroke-width="2"/>
    <text x="600" y="390" text-anchor="middle">${label}（客户上传的图纸）</text></svg>`;
  return svgToPng(svg);
}

export function samplePlan(): DeliveryDocument {
  const company = '惠阳飞宇电器有限公司';
  return {
    kind: 'plan',
    title: `${company}生产安全事故应急预案`,
    cover: {
      company,
      name: '生产安全事故应急预案',
      code: 'FY2026',
      version: 'A 2026',
      lines: [`单位名称：${company}`, '主要负责人：陈某'],
      dates: ['颁布日期：2026年4月11日', '实施日期：2026年4月12日'],
    },
    frontPages: [
      {
        title: '预案批准发布令',
        blocks: P(
          `为贯彻《中华人民共和国安全生产法》及其它法律、法规和有关文件要求，确保公司员工的生命财产安全，减少公司财产损失，在事故发生后能快速、有效、有序地实施救援，公司组织相关部门和人员组建了${company}应急预案编制小组，编制了《${company}生产安全事故应急救援预案》预案编号：FY2026，版本号：A 2026。`,
          '该预案是本公司实施应急救援的规范性文件，用于指导本公司生产安全事故的应急救援行动，本应急救援预案包括综合预案、专项预案及现场处置方案组成，现将预案予以颁布，并实施，本公司所有部门均严格遵守执行。',
        ),
        signature: ['签发：主要负责人 陈某', `单位（盖章）：${company}`, '颁布日期：2026年4月11日'],
      },
      {
        title: '应急预案编制小组',
        blocks: [
          ...P(`${company}组织相关部门和人员组建应急预案编制小组，负责本预案的编制、评审、修订与维护；成员构成及分工如下：`),
          {
            type: 'table',
            header: [['序号', '项目', '姓名', '应急职务', '分工', '签名']],
            rows: [
              ['1', '组长', '陈某', '总指挥', '制定应急预案编制计划，组织技术人员编制、评审、修订应急预案，并签署、颁布实施', ''],
              ['2', '编制组成员', '林某', '副总指挥', '应急预案编制汇总、统稿，组织风险评估与应急能力评估，后期应急预案的管理与维护', ''],
              ['3', '编制组成员', '王某', '抢险救灾组组长', '参与应急预案编制，重点编制应急组织、抢险救援与人员救护章节内容', ''],
              ['4', '编制组成员', '李某', '通讯联络组组长', '参与应急预案编制，重点编制预警、信息报告与对外联络章节内容，预案的打印、装订与发放', ''],
            ],
          },
        ],
      },
    ],
    sections: [
      {
        id: 'master',
        title: '一、综合应急预案',
        blocks: [],
        sections: [
          {
            id: 'master.1',
            title: '1. 总则',
            blocks: [],
            sections: [
              {
                id: 'master.1.1',
                title: '1.1 适用范围',
                blocks: P(
                  '本预案适用于本公司管辖区域内可能发生的：火灾、触电、机械致害、容器爆炸、物体打击及其他伤害等事故的应急处置，以及雷暴雨、台风等自然灾害引发的生产安全事故的应急处置。',
                  '适用于上述事故初始阶段或有明显事故特征时班组应急力量的现场处置，以及班组无法有效处置的较大事故的应急处置。',
                ),
                sections: [],
              },
              {
                id: 'master.1.2',
                title: '1.2 响应分级',
                blocks: [
                  ...P('依据生产安全事故的类别、危害程度、影响范围和专业人员的评估结果和可能发生的事故现场情况分析结果，设定预案的启动条件。应急响应分为两级：'),
                  {
                    type: 'list',
                    items: [
                      ['当事故的发生、发展还在某个部门或某个班组可控制的范围内，暂时不会对现场安全造成较大影响，事发现场相关人员采取应急措施，启动二级响应。'],
                      ['事故已经发生，事发现场相关人员采取措施后，仍无法控制事态发展，立即向总指挥或副总指挥报告，总指挥或副总指挥经初步分析后启动一级响应。'],
                    ],
                  },
                ],
                sections: [],
              },
            ],
          },
          {
            id: 'master.2',
            title: '2. 应急组织机构及职责',
            blocks: [],
            sections: [
              {
                id: 'master.2.1',
                title: '2.1 应急组织机构',
                blocks: [
                  ...P('公司成立有安全生产事故应急指挥部，设应急总指挥1名，副总指挥（兼现场指挥）1名。应急指挥部下设抢险救灾组、综合保障组、通讯联络组。公司应急救援组织结构如下图所示：'),
                  { type: 'figure', ...orgChart(), caption: `图 2-1 ${company}应急救援组织体系图` },
                ],
                sections: [],
              },
              {
                id: 'master.2.2',
                title: '2.2 职责',
                blocks: [],
                sections: [
                  {
                    id: 'master.2.2.1',
                    title: '2.2.1 总指挥职责',
                    blocks: [
                      { type: 'paragraph', text: [{ text: '总指挥：', bold: true }, '由公司总经理担任（总指挥外出时，由副总指挥或者指定代理人担任总指挥）。'] },
                      {
                        type: 'list',
                        items: [['负责组织制定应急预案及负责应急救援指挥工作；'], ['负责做好稳定生产秩序和伤亡人员的善后及安抚工作；'], ['负责组织预案的演练，及时对预案进行调整、修订和补充。']],
                      },
                    ],
                    sections: [],
                  },
                ],
              },
            ],
          },
          {
            id: 'master.3',
            title: '3. 应急响应',
            blocks: [],
            sections: [
              {
                id: 'master.3.1',
                title: '3.1 信息报告',
                blocks: [
                  { type: 'paragraph', text: [{ text: '公司24小时应急值班电话：0752-1234567。', bold: true }] },
                  ...P('其他各应急人员通过各部门值班电话及各有关人员手机，进行24小时有效的联络。'),
                  { type: 'figure', ...responseFlow(), caption: '图 3-1 应急响应流程图', placement: 'page' },
                  ...P('信息发布原则：跟踪事故发展动态，及时准确地向上级部门报告，同时向周边通报事故情况；正确引导媒体，避免不良社会影响。'),
                ],
                sections: [],
              },
            ],
          },
        ],
      },
      {
        id: 'specialty.fire',
        title: '二、火灾事故专项应急预案',
        blocks: [],
        sections: [
          {
            id: 'specialty.fire.1',
            title: '1. 适用范围',
            blocks: P('本预案适用于公司生产车间、仓库、办公区域发生的火灾事故的应急处置。'),
            sections: [],
          },
        ],
      },
      {
        id: 'attachments',
        title: '九、附件',
        blocks: [],
        childrenOnNewPage: true,
        sections: [
          {
            id: 'attachments.4',
            title: '附件4、应急物资装备的名录或清单',
            blocks: [
              {
                type: 'table',
                caption: '表 4-1 应急物资装备清单',
                header: [['序号', '名称', '规格型号', '数量', '存放地点', '保管人', '联系电话']],
                rows: [
                  ['1', '手提式干粉灭火器', 'MFZ/ABC4', '46 具', '冲压车间、仓库', '王某', '138****2601'],
                  ['2', '室内消火栓', 'SN65', '12 套', '各楼层', '王某', '138****2601'],
                  ['3', '急救药箱', '常规配置', '2 个', '办公室、门卫室', '李某', '139****3102'],
                  ['4', '应急照明灯', '—', '30 盏', '疏散通道', '王某', '138****2601'],
                ],
              },
              ...P('以上物资由保管人每月检查一次，发现缺失或失效及时补充。'),
            ],
            sections: [],
          },
          {
            id: 'attachments.7',
            title: '附件7、关键图纸',
            blocks: [
              ...P('本附件收录企业提供的总平面布置图与应急疏散图。'),
              { type: 'figure', ...drawing('总平面布置图'), caption: '附7.1 总平面布置图', placement: 'landscape' },
              { type: 'figure', ...drawing('应急疏散图'), caption: '附7.2 应急疏散图', placement: 'landscape' },
            ],
            sections: [],
          },
          {
            id: 'attachments.8',
            title: '附件8、应急资源调查报告',
            blocks: P('应急资源调查报告另册提供。'),
            sections: [],
          },
        ],
      },
    ],
  };
}
