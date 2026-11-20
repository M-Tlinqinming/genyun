// 测试用：生成各种资料表格样例（接口单元测试和浏览器测试共用），不提交 xlsx 文件。
// 新版以仓库里的模板为底往格子里填；旧版按旧模板的样子从零生成。数据都是编的。
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { TEMPLATE_PATH } from './template.ts';

export const SAMPLE_NAME = '耕云测试五金制品有限公司';

type Cells = Record<string, string | number>;
type SheetCells = Partial<Record<string, Cells>>;

function setProps(wb: ExcelJS.Workbook) {
  wb.creator = '耕云测试';
  wb.lastModifiedBy = '耕云测试';
}

async function fromTemplate(fill: SheetCells, edit?: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  setProps(wb);
  edit?.(wb);
  for (const [sheet, cells] of Object.entries(fill)) {
    const ws = wb.getWorksheet(sheet)!;
    for (const [addr, v] of Object.entries(cells!)) ws.getCell(addr).value = v;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 新版、必填全齐的一份 */
export function normalFill(name = SAMPLE_NAME): SheetCells {
  return {
    企业信息: {
      B3: name,
      B4: '91441300MA5ABCD01X',
      B5: '林测试',
      B6: '有限责任公司',
      B7: '金属制品业',
      B11: '广东省惠州市惠城区测试路 1 号',
      B12: '同注册地址',
      B14: '是',
      B15: '测试工业园管理处',
      B19: '否',
      B21: '五金冲压件',
      B22: 45,
      B25: '王安全',
      B26: '李联系',
      B27: '13800000001',
    },
    建筑与场所: {
      A5: '1 号厂房', B5: 3, C5: 1200, D5: '钢结构', E5: '二级', F5: '生产',
      A6: '宿舍楼', B6: 4, C6: '800', E6: '不清楚',
      B21: '有', B24: '有', B32: '有', C32: '模具间；样品间',
    },
    生产与设备: {
      B2: '购入钢材→冲压成型→焊接→装配入库',
      A7: '冲床', B7: 'J23-40', C7: 6, D7: '台', E7: '冲压车间',
      A8: '焊机', C8: 2, D8: '台',
      B30: '没有', B32: '有', C32: '压缩空气', D32: 1, E32: '台', F32: '0.8MPa 1m³', G32: '空压机房',
      B35: '有', C35: '叉车', D35: 2, E35: '台',
    },
    原辅料与危化品: {
      B5: '天那水', C5: '108-88-3', D5: 2, E5: 0.5, F5: '吨', G5: '危化品仓库',
      A6: '气瓶', B6: '氧气', E6: 4, F6: '瓶', G6: '气瓶间', H6: 40,
    },
    应急组织: {
      B2: '0752-2345678',
      C7: '张总', D7: '总经理', E7: '13800000002',
      C8: '赵副总', E8: '13800000003',
      C9: '钱组长', E9: '13800000004', C10: '孙组员', E10: '13800000005',
      C13: '周组长', E13: '13800000006',
      C17: '吴组长', E17: '13800000007',
      B33: '测试市人民医院', C33: '0752-1234567',
      B34: '测试邻居塑胶厂', C34: '13800000008',
    },
    应急资源: {
      B4: 20, C4: '各车间', D4: '王安全', E4: '13800000001',
      B6: 10,
      A22: '纱布绷带', B22: 2, C22: '卷',
      B35: '有', B36: 200, B37: '厂区东侧',
      B38: '没有',
    },
  };
}

export const newNormal = () => fromTemplate(normalFill());

/** 新版、必填全齐，改员工人数；leaders = true 时医疗救护组、警戒疏散组的组长也填上 */
export function newWithEmployees(count: number, leaders = false): Promise<Buffer> {
  const fill = normalFill();
  fill.企业信息!.B22 = count;
  if (leaders) Object.assign(fill.应急组织!, { C21: '郑组长', E21: '13800000009', C25: '冯组长' });
  return fromTemplate(fill);
}

/** 新版、缺三项（对上缺项清单那块板）：第 5 行建筑面积空、值班电话空、总指挥手机填座机 */
export function newMissing(name = SAMPLE_NAME): Promise<Buffer> {
  const fill = normalFill(name);
  delete fill.建筑与场所!.C5;
  delete fill.应急组织!.B2;
  fill.应急组织!.E7 = '0752-2345679';
  return fromTemplate(fill);
}

/** 新版、在建筑、设备、抢险救灾组各插一行（插在第 1 行数据后面），后面的行号都往下挪 */
export function newInserted(): Promise<Buffer> {
  return fromTemplate({}, (wb) => {
    const fill = normalFill();
    const write = (sheet: string, cells: Cells) => {
      const ws = wb.getWorksheet(sheet)!;
      for (const [addr, v] of Object.entries(cells)) ws.getCell(addr).value = v;
    };
    for (const [sheet, cells] of Object.entries(fill)) write(sheet, cells!);
    // 从下往上插，前面插的不影响后面的行号
    wb.getWorksheet('应急组织')!.spliceRows(10, 0, ['', '组员', '插行组员', '', '13800000009']);
    wb.getWorksheet('生产与设备')!.spliceRows(8, 0, ['折弯机', '', 1, '台']);
    // 插在第 1 栋后面，原来第 6 行的宿舍楼挪到第 7 行
    wb.getWorksheet('建筑与场所')!.spliceRows(6, 0, ['2 号仓库', 1, '']);
  });
}

/** 不是耕云模板：随便一份 xlsx */
export async function notTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  setProps(wb);
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = '资料清单';
  ws.getCell('A2').value = '营业执照';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 企业名称写的是另一家 */
export const otherEnterprise = (otherName: string) => fromTemplate(normalFill(otherName));

/** 新版、企业名称和任务的企业不一样（同一家改了名） */
export const renamed = (newName: string) => fromTemplate(normalFill(newName));

/** 新版、不改别的，只把「填写说明」B2 换成别的版本号 */
export const newWithVersion = (version: string) =>
  fromTemplate({ 填写说明: { B2: `模板版本 ${version}` } });

// —— 旧版 ——

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };

function rows(ws: ExcelJS.Worksheet, start: number, data: (string | number | null)[][]) {
  data.forEach((r, i) => {
    r.forEach((v, j) => {
      if (v !== null && v !== '') ws.getCell(start + i, j + 1).value = v;
    });
  });
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[]) {
  labels.forEach((l, j) => {
    const c = ws.getCell(row, j + 1);
    c.value = l;
    c.fill = HEADER_FILL;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
}

/** 旧版模板的空表（按旧模板的样子），fill 往里填 */
async function oldTemplate(fill: SheetCells): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  setProps(wb);
  const guide = wb.addWorksheet('填写说明');
  guide.getCell('B1').value = '耕云应急预案编制 · 企业资料填报模板';
  guide.getCell('B3').value = '使用步骤：';

  const info = wb.addWorksheet('企业信息');
  info.getCell('A1').value = '企业基本资料';
  header(info, 2, ['字段', '填写内容', '填写说明']);
  const infoLabels = [
    '企业名称', '统一社会信用代码', '法定代表人', '企业类型', '所属行业', '登记机关', '注册资本（万元）', '经营范围',
    '注册地址', '生产场所地址', '其他生产地址', '是否位于园区', '园区管理方名称', '园区值班电话', '厂区占地面积（m2）',
    '总建筑面积（m2）', '是否出租厂房', '主要产品', '员工人数', '技术管理人员', '专职或兼职安全管理人员', '联系人',
    '联系人电话', '电子邮箱',
  ];
  rows(info, 3, infoLabels.map((l) => [l]));

  const bld = wb.addWorksheet('建筑与场所');
  bld.getCell('A1').value = '建（构）筑物与涉及场所';
  bld.getCell('A2').value = '一、建（构）筑物一览';
  header(bld, 3, ['建筑或构筑物名称', '层数', '建筑面积（㎡）', '结构类型', '耐火等级', '主要用途']);
  bld.getCell('A17').value = '二、涉及场所勾选（下拉选择"有 / 没有 / 不清楚"）';
  header(bld, 18, ['场所', '有无', '补充说明（名称、位置）']);
  const sites = [
    '生产车间', '喷涂', '焊接 / 切割', '仓库', '配电房', '危化品仓库', '空压机房', '锅炉房', '有限空间（污水池、罐体等）',
    '食堂', '员工宿舍', '其他场所',
  ];
  rows(bld, 19, sites.map((s) => [s]));
  bld.getCell('B30').value = '有';
  bld.getCell('C30').value = '在左侧填写其他场所名称，最多 10 个，用分号；分隔';

  const prod = wb.addWorksheet('生产与设备');
  prod.getCell('A1').value = '生产工艺与设备';
  prod.getCell('A2').value = '生产工艺流程（一句话描述，用"→"箭头符号隔开）';
  prod.getCell('B2').value = '例：购入钢材→冲压成型→焊接→喷涂→装配入库';
  prod.mergeCells('B2:F2');
  prod.getCell('A4').value = '一、生产设备设施（主要设备，行不够可加行）';
  header(prod, 5, ['设备名称', '规格型号', '数量', '使用部门 / 地点', '使用状况', '备注']);
  prod.getCell('A27').value = '二、特种设备与储存设施（企业没有的无需填写）';
  header(prod, 28, ['类别', '名称或编号', '规格参数', '数量', '安装位置', '备注']);
  rows(prod, 29, [['压力容器'], ['锅炉'], ['压力管道'], ['其他']]);

  const mat = wb.addWorksheet('原辅料与危化品');
  mat.getCell('A1').value = '原辅材料与危险化学品';
  mat.getCell('A2').value = '类型可下拉选择"原料"或"气瓶"，年用量与最大存放量单位为吨';
  header(mat, 4, ['类型', '名称', 'CAS 号', '年用量/t', '最大存放量/t', '存放位置', '气瓶规格（气瓶填，单位为L）']);
  rows(mat, 5, [['原辅料'], ['原辅料'], ['原辅料'], ['气瓶']]);

  const org = wb.addWorksheet('应急组织');
  org.getCell('A1').value = '应急组织与联系人';
  rows(org, 2, [['总指挥姓名'], ['总指挥手机'], ['副总指挥姓名'], ['副总指挥手机'], ['24 小时值班电话']]);
  org.getCell('A8').value = '一、各应急小组成员（企业人数100人以下或者中小型企业的填写此表格，小组名称已预置，人名按实际填；行不够可加行）';
  header(org, 9, ['小组名称', '应急职务', '姓名', '手机']);
  const small = ['抢险救灾组', '综合保障组', '通讯联络组'];
  rows(org, 10, small.flatMap((g) => [[g, '组长'], [g, '组员'], [g, '组员']]));
  org.getCell('A19').value = '二、各应急小组成员（企业人数100人以上或者中大型企业的填写此表格）';
  header(org, 20, ['小组名称', '应急职务', '姓名', '手机']);
  const big = [...small, '医疗救护组', '警戒疏散组'];
  rows(org, 21, big.flatMap((g) => [[g, '组长', '组长', '组长'], [g, '组员', '组长', '组长'], [g, '组员', '组长', '组长']]));
  org.getCell('A36').value = '二、外部应急队伍与资源';
  header(org, 37, ['类型', '名称', '联系电话', '备注（签有协议的写明协议单位）']);
  rows(org, 38, [['属地消防救援站'], ['就近医院'], ['园区管理方'], ['协议救援单位'], ['周围企业'], ['其他']]);

  const res = wb.addWorksheet('应急资源');
  res.getCell('A2').value = '一、应急物资及装备（常见项已预置，按实际数量填写；行不够可加行）';
  header(res, 3, ['物资名称', '数量', '存放位置', '状态']);
  const supplies = ['灭火器', '室内消防栓', '应急照明灯', '疏散指示标志', '急救药箱', '防毒面具 / 空气呼吸器', '安全绳', '应急沙袋'];
  rows(res, 4, supplies.map((s) => [s]));
  res.getCell('A19').value = '二、消防水池与急救药箱（没有的填"没有"）';
  rows(res, 20, [['消防水池'], ['消防水池容量（m³）'], ['消防水池位置']]);

  for (const [sheet, cells] of Object.entries(fill)) {
    const ws = wb.getWorksheet(sheet)!;
    for (const [addr, v] of Object.entries(cells!)) ws.getCell(addr).value = v;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 旧版样例：B19 选「不清楚」；单位按吨；工艺格还是「例：…」；只填了第一张小组表 */
export function oldSample(name = SAMPLE_NAME): Promise<Buffer> {
  return oldTemplate({
    企业信息: {
      B3: name,
      B5: '林测试',
      B11: '广东省惠州市惠城区测试路 1 号',
      B12: '同注册地址',
      B14: '没有',
      B19: '不清楚',
      B20: '五金冲压件',
      B21: 45,
      B24: '李联系',
      B25: '13800000001',
    },
    建筑与场所: { A4: '1 号厂房', B4: 3, C4: 1200, E4: '二级', B19: '有' },
    生产与设备: { A6: '冲床', C6: '3 台', D6: '冲压车间', B29: '储气罐', C29: '0.8MPa', D29: 1 },
    原辅料与危化品: { B5: '天那水', D5: 2, E5: 0.5, F5: '危化品仓库' },
    应急组织: {
      B2: '张总', B3: '13800000002', B4: '赵副总', B5: '13800000003', B6: '0752-2345678',
      C10: '钱组长', D10: '13800000004', C13: '周组长', D13: '13800000006', C16: '吴组长', D16: '13800000007',
      B39: '测试市人民医院', C39: '0752-1234567',
    },
    应急资源: { B4: 20, C4: '各车间', B20: '没有' },
  });
}

/** 浏览器测试用：把几份样例写到临时目录，返回各自的路径 */
export async function writeSamples(dir: string, otherName = '耕云测试另一家有限公司') {
  await mkdir(dir, { recursive: true });
  const files = {
    normal: ['资料表格-正常.xlsx', await newNormal()],
    missing: ['资料表格-缺项.xlsx', await newMissing()],
    old: ['资料表格-旧版.xlsx', await oldSample()],
    notTemplate: ['别的表格.xlsx', await notTemplate()],
    other: ['资料表格-别家.xlsx', await otherEnterprise(otherName)],
  } as const;
  const out = {} as Record<keyof typeof files, string>;
  for (const [k, [name, buf]] of Object.entries(files) as [keyof typeof files, readonly [string, Buffer]][]) {
    const p = join(dir, name);
    await writeFile(p, buf);
    out[k] = p;
  }
  return out;
}
