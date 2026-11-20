import {
  basicStepSchema,
  organizationStepSchema,
  productionStepSchema,
  resourcesStepSchema,
} from '@genyun/shared';
import ExcelJS from 'exceljs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { analyzeSheet, SheetRejectedError, TOO_LARGE_MESSAGE, type SheetAnalysis } from './analyze.ts';
import { cellText, formatNumber } from './cell-text.ts';
import { composeCheck, recheckDrawings } from './check.ts';
import { layoutFor, LAYOUT_OLD } from './layout.ts';
import * as S from './test-workbooks.ts';
import { isLandline, isMobile, isSameAsRegistered, parseNumber, phoneKind } from './values.ts';
import { checkZip, ZIP_MAX_ENTRIES, ZIP_MAX_UNCOMPRESSED } from './zip-guard.ts';

const enterprise = { id: 'e1', name: S.SAMPLE_NAME };
const analyze = (buf: Buffer, others = [enterprise]) => analyzeSheet(buf, { enterprise, others });
function read(a: SheetAnalysis) {
  if (a.kind !== 'read') throw new Error(`没读：${a.kind}`);
  return a;
}

describe('格子里的字', () => {
  const ws = new ExcelJS.Workbook().addWorksheet('t');
  const text = (v: ExcelJS.CellValue) => {
    ws.getCell('A1').value = v;
    return cellText(ws.getCell('A1'));
  };
  test('各种值都读成字', () => {
    expect(text('  天那水  ')).toBe('天那水');
    expect(text(0.1 + 0.2)).toBe('0.3');
    expect(text(1200)).toBe('1200');
    expect(text(true)).toBe('是');
    expect(text(new Date(Date.UTC(2026, 10, 20)))).toBe('2026-11-20');
    expect(text({ richText: [{ text: '* ' }, { text: '企业名称' }] })).toBe('* 企业名称');
    expect(text({ text: '网址', hyperlink: 'https://example.com' })).toBe('网址');
    expect(text({ formula: 'A2*2', result: 6 })).toBe('6');
    expect(text({ error: '#N/A' })).toBe('');
    expect(text(null)).toBe('');
    expect(formatNumber(12345678901)).toBe('12345678901');
  });
  test('合并格只认左上角那一格', () => {
    ws.getCell('B1').value = '合并';
    ws.mergeCells('B1:C1');
    expect(cellText(ws.getCell('B1'))).toBe('合并');
    expect(cellText(ws.getCell('C1'))).toBe('');
  });
});

describe('电话、数字、同注册地址', () => {
  test('手机和座机', () => {
    expect(isMobile('138 0000 0001')).toBe(true);
    expect(isMobile('138-0000-0001')).toBe(true);
    expect(isMobile('+86 13800000001')).toBe(true);
    expect(isMobile('12800000001')).toBe(false);
    expect(isLandline('0752-2345678')).toBe(true);
    expect(isLandline('2345678')).toBe(true);
    expect(isLandline('4001234567')).toBe(true);
    expect(phoneKind('0752-2345678')).toBe('landline');
    expect(phoneKind('找张总')).toBe('invalid');
  });
  test('数字可以带常见单位', () => {
    expect(parseNumber('1,200')).toBe(1200);
    expect(parseNumber('3 层')).toBe(3);
    expect(parseNumber('1200㎡')).toBe(1200);
    expect(parseNumber('约 500')).toBeNull();
    expect(parseNumber('三层')).toBeNull();
  });
  test('同注册地址', () => {
    expect(isSameAsRegistered('同注册地址')).toBe(true);
    expect(isSameAsRegistered(' 同注册地址 ')).toBe(true);
    expect(isSameAsRegistered('惠州市')).toBe(false);
  });
});

describe('防压缩炸弹', () => {
  // 拼一份完整的 zip：本地头 + 数据 + 中央目录 + 结尾记录。declared 是目录里声明的解压后大小，
  // actual 是每个条目真实解开的字节数（全是 0，压缩后很小）；method 8 = deflate、0 = stored
  function fakeZip(entries: number, declared: number, actual = declared, method = 8): Buffer {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    const raw = Buffer.alloc(actual);
    const data = method === 0 ? raw : deflateRawSync(raw);
    for (let i = 0; i < entries; i++) {
      const name = Buffer.from(`f${i}.xml`);
      const l = Buffer.alloc(30);
      l.writeUInt32LE(0x04034b50, 0);
      l.writeUInt16LE(0x08, 6); // 带 data descriptor：本地头里的大小写 0
      l.writeUInt16LE(method, 8);
      l.writeUInt16LE(name.length, 26);
      locals.push(l, name, data);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(method, 10);
      h.writeUInt32LE(data.length, 20);
      h.writeUInt32LE(declared, 24);
      h.writeUInt16LE(name.length, 28);
      h.writeUInt32LE(offset, 42);
      central.push(h, name);
      offset += l.length + name.length + data.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(entries, 0xffff), 8);
    end.writeUInt16LE(Math.min(entries, 0xffff), 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  }
  test('正常的表格过得去', async () => {
    const r = await checkZip(await S.newNormal());
    expect(r.ok).toBe(true);
  });
  test('不是 zip', async () => {
    expect(await checkZip(Buffer.from('就是一段字'))).toEqual({ ok: false, reason: 'not_zip' });
  });
  test('文件太多、解开太大都拦', async () => {
    expect(await checkZip(fakeZip(ZIP_MAX_ENTRIES + 1, 1))).toEqual({ ok: false, reason: 'too_large' });
    expect(await checkZip(fakeZip(3, 100 * 1024 * 1024))).toEqual({ ok: false, reason: 'too_large' });
    expect(await checkZip(fakeZip(3, 1024))).toEqual({ ok: true, entries: 3, uncompressed: 3072 });
    expect(await checkZip(fakeZip(3, 1024, 1024, 0))).toEqual({ ok: true, entries: 3, uncompressed: 3072 });
    }, 60_000);
  test('目录里声明得很小、实际解开很大的，按真解开的字节数拦', async () => {
    const bomb = fakeZip(1, 10, ZIP_MAX_UNCOMPRESSED + 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await checkZip(bomb)).toEqual({ ok: false, reason: 'too_large' });
    await expect(analyze(bomb)).rejects.toThrow(TOO_LARGE_MESSAGE);
  }, 60_000);
  test('解压出错、不认识的压缩方式都当打不开', async () => {
    const broken = fakeZip(1, 1024);
    broken.fill(0xff, 36, 40); // 弄坏压缩数据（本地头 30 字节 + 文件名 6 字节之后）
    expect(await checkZip(broken)).toEqual({ ok: false, reason: 'not_zip' });
    expect(await checkZip(fakeZip(1, 1024, 1024, 12))).toEqual({ ok: false, reason: 'not_zip' });
  });
  test('打不开的表格直接拒收', async () => {
    await expect(analyze(Buffer.from('not a zip'))).rejects.toBeInstanceOf(SheetRejectedError);
    const broken = fakeZip(1, 1024);
    broken.fill(0xff, 36, 40);
    await expect(analyze(broken)).rejects.toBeInstanceOf(SheetRejectedError);
    // 压缩包本身没毛病、只是里面不是表格的，按「不是资料模板」处理
    expect((await analyze(fakeZip(3, 1024))).kind).toBe('not_template');
  });
});

describe('员工 100 人以上，5 个组都要有组长（只提醒，不拦）', () => {
  const leaders = (a: ReturnType<typeof read>) => a.sheet.optional.filter((o) => o.field === 'organization.medical' || o.field === 'organization.evacuation');
  test('99 人不提醒', async () => {
    expect(leaders(read(await analyze(await S.newWithEmployees(99))))).toEqual([]);
  });
  test('100 人：医疗救护组、警戒疏散组组长都空，放进选填，带提示', async () => {
    const a = read(await analyze(await S.newWithEmployees(100)));
    expect(a.sheet.missing).toEqual([]);
    expect(leaders(a)).toEqual([
      expect.objectContaining({ label: '医疗救护组组长', sheet: '应急组织', row: 21, cell: 'C21', note: '员工 100 人以上，5 个组都要有组长。不清楚的可以留空，专家核对时补。' }),
      expect.objectContaining({ label: '警戒疏散组组长', sheet: '应急组织', row: 25, cell: 'C25' }),
    ]);
  });
  test('组长填了（只填姓名也算）就不提醒', async () => {
    expect(leaders(read(await analyze(await S.newWithEmployees(150, true))))).toEqual([]);
  });
});

describe('认版本', () => {
  test('B2 的版本号', () => {
    expect(layoutFor('模板版本 2026.11').version).toBe('2026.11');
    expect(layoutFor('')).toBe(LAYOUT_OLD);
    // 不认识的版本按最新版读，不当旧版
    expect(layoutFor('模板版本 2027.3').old).toBe(false);
  });
  test('不认识的版本按最新版读，不提示旧版', async () => {
    const a = read(await analyze(await S.newWithVersion('2027.3')));
    expect(a.parse.templateVersion).toBe('2027.3');
    expect(a.warnings).toEqual([]);
  });
});

describe('新版：正常的一份', () => {
  test('读进企业资料，各步都过 schema', async () => {
    const a = read(await analyze(await S.newNormal()));
    expect(a.warnings).toEqual([]);
    expect(a.rename).toBeNull();
    expect(a.sheet.missing).toEqual([]);
    const { identity, profile } = a.parse;
    expect(identity).toEqual({
      name: S.SAMPLE_NAME,
      socialCreditCode: '91441300MA5ABCD01X',
      legalRepresentative: '林测试',
      registeredAddress: '广东省惠州市惠城区测试路 1 号',
    });
    const basic = profile.basicStep!.basic;
    expect(basicStepSchema.parse(basic)).toEqual(basic);
    expect(basic.siteAddress).toBe('广东省惠州市惠城区测试路 1 号');
    expect(profile.basicStep!.sources.siteAddress).toBe('registered_address');
    expect(basic.industry).toBeDefined();
    expect(basic.inPark).toBe('yes');
    expect(basic.employeeCount).toBe(45);

    const org = profile.organizationStep!.step;
    expect(organizationStepSchema.parse(org)).toEqual(org);
    expect(org.dutyPhone).toBe('0752-2345678');
    expect(org.commander).toMatchObject({ name: '张总', position: '总经理', phone: '13800000002' });
    expect(org.groups.map((g) => g.kind)).toEqual(['rescue', 'logistics', 'communication']);
    expect(org.groups[0]!.members).toHaveLength(1);

    const prod = profile.productionStep!.step;
    expect(productionStepSchema.parse(prod)).toEqual(prod);
    expect(prod.leasesPremises).toBe(false);
    expect(prod.sites).toEqual(['workshop', 'warehouse']);
    expect(prod.customSites).toEqual(['模具间', '样品间']);
    expect(prod.equipment[0]).toMatchObject({ name: '冲床', spec: 'J23-40', quantity: '6 台' });
    expect(prod.materials[0]).toMatchObject({ annualUsage: '2 吨', maxStorage: '0.5 吨', kind: 'material' });
    expect(prod.materials[1]).toMatchObject({ kind: 'cylinder', cylinderSpec: '40L' });
    expect(prod.specialEquipment.storageTanks.answer).toBe('no');
    expect(prod.specialEquipment.pressureVessels.items[0]).toMatchObject({ maxWorkingPressureMPa: 0.8, volumeM3: 1 });
    expect(prod.otherSpecialEquipment?.[0]?.description).toContain('叉车');
    expect(prod.process.description).toBe('购入钢材→冲压成型→焊接→装配入库');

    const res = profile.resourcesStep!.step;
    expect(resourcesStepSchema.parse(res)).toEqual(res);
    expect(res.supplies[0]).toMatchObject({ catalogKey: 'fire_ext_portable', name: '灭火器', quantity: 20, keeper: '王安全' });
    expect(res.firstAidKit.mode).toBe('manual');
    expect(res.firePool).toMatchObject({ answer: 'yes', volumeM3: 200, location: '厂区东侧' });
    expect(res.buildings.map((b) => b.fireRating)).toEqual(['2', 'expert']);
    expect(res.hospital?.name).toBe('测试市人民医院');
    expect(res.neighbors.items[0]?.name).toBe('测试邻居塑胶厂');

    // 来源记到格子
    expect(a.parse.sources!['basic.employeeCount']).toEqual({ sheet: '企业信息', cell: 'B22', row: 22 });
    // 写「不清楚」的耐火等级交给专家，不算放不进去
    expect(a.parse.unplaced).toEqual([]);
  });

  test('选填没填的列出来；「是」才算的几格跟着走', async () => {
    const a = read(await analyze(await S.newNormal()));
    const labels = a.sheet.optional.map((o) => o.label);
    expect(labels).toContain('注册资本');
    expect(labels).toContain('园区值班电话');
    // 厂中厂选「否」，承租企业名称不算
    expect(labels).not.toContain('承租企业名称');
    expect(a.sheet.optional.find((o) => o.label === '结构类型')).toMatchObject({ count: 1, unitWord: '栋' });
  });
});

describe('新版：缺项', () => {
  test('和缺项清单那块板一致：行号、顺序、提示', async () => {
    const a = read(await analyze(await S.newMissing()));
    expect(a.sheet.missing.map((m) => [m.label, m.cell, m.note])).toEqual([
      ['第 1 栋建筑的建筑面积', 'C5', '没填。大概数就行，可以看租赁合同。'],
      ['24 小时值班电话', 'B2', '没填。座机或手机都可以。'],
      ['总指挥手机', 'E7', '填的是座机。这里要 24 小时能打通的手机。'],
    ]);
  });

  test('图放在最后；说明没有疏散图的不算缺；改图只换图那两项', async () => {
    const a = read(await analyze(await S.newMissing()));
    const check = composeCheck(a.sheet, { sitePlan: false, evacuationPlan: false, noEvacuationMap: false })!;
    expect(check.missing.slice(-2).map((m) => m.label)).toEqual(['总平面布置图', '紧急疏散示意图']);
    const again = recheckDrawings(check, { sitePlan: true, evacuationPlan: false, noEvacuationMap: true })!;
    expect(again.missing.map((m) => m.label)).toEqual(['第 1 栋建筑的建筑面积', '24 小时值班电话', '总指挥手机']);
    expect(composeCheck(null, { sitePlan: true, evacuationPlan: true, noEvacuationMap: false })).toBeNull();
  });

  test('整块空只出一项；一个人姓名手机都空只出一项', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await S.newNormal()) as unknown as ArrayBuffer);
    const blank = (sheet: string, addrs: string[]) => addrs.forEach((x) => (wb.getWorksheet(sheet)!.getCell(x).value = null));
    blank('建筑与场所', ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'A6', 'B6', 'C6', 'E6']);
    blank('应急组织', ['C8', 'E8']);
    const a = read(await analyze(Buffer.from(await wb.xlsx.writeBuffer())));
    expect(a.sheet.missing.map((m) => [m.label, m.cell, m.note])).toEqual([
      ['建筑', 'A5', '一栋都没填。至少填 1 栋：名称、层数、建筑面积。'],
      ['副总指挥', 'C8', '没填。姓名和手机都要填。'],
    ]);
  });
});

describe('新版：插了行', () => {
  test('行号跟着变', async () => {
    const a = read(await analyze(await S.newInserted()));
    // 插进来的第 2 栋没填面积
    expect(a.sheet.missing.map((m) => [m.label, m.cell])).toEqual([['第 2 栋建筑的建筑面积', 'C6']]);
    const p = a.parse.profile;
    expect(p.resourcesStep!.step.buildings.map((b) => b.id)).toEqual(['b-5', 'b-6', 'b-7']);
    expect(p.productionStep!.step.equipment.map((e) => e.name)).toEqual(['冲床', '折弯机', '焊机']);
    // 插进来的组员 A 列是空的，算上一组
    const rescue = p.organizationStep!.step.groups.find((g) => g.kind === 'rescue')!;
    expect(rescue.members.map((m) => m.name)).toEqual(['插行组员', '孙组员']);
    // 后面的组长都往下挪了一行
    expect(a.parse.sources!['organization.groups.1.leader.name']).toMatchObject({ cell: 'C14' });
  });
});

describe('不是模板、别家企业、改名', () => {
  test('不是模板什么都不读', async () => {
    const a = await analyze(await S.notTemplate());
    expect(a).toEqual({ kind: 'not_template', warnings: [{ kind: 'not_template' }] });
  });
  test('同组织另一家：拦住，不读', async () => {
    const other = { id: 'e2', name: '耕云测试另一家有限公司' };
    const a = await analyze(await S.otherEnterprise('耕云测试 另一家有限公司'), [enterprise, other]);
    expect(a.kind).toBe('other_enterprise');
    if (a.kind === 'other_enterprise') expect(a.target).toEqual(other);
  });
  test('名称不一样、也不是别家：按表格改名', async () => {
    const a = read(await analyze(await S.renamed('耕云测试新名字有限公司')));
    expect(a.rename).toEqual({ previousName: S.SAMPLE_NAME, newName: '耕云测试新名字有限公司' });
    expect(a.warnings).toEqual([{ kind: 'enterprise_renamed', previousName: S.SAMPLE_NAME, newName: '耕云测试新名字有限公司' }]);
  });
  test('规范化后一样的不算改名', async () => {
    const a = read(await analyze(await S.renamed(` ${S.SAMPLE_NAME.replace('五金', '五金 ')}`)));
    expect(a.rename).toBeNull();
  });
});

describe('旧版', () => {
  test('提示旧版；第 1 条是厂中厂；单位按吨；预置字不算填了', async () => {
    const a = read(await analyze(await S.oldSample()));
    expect(a.warnings).toEqual([{ kind: 'old_template', templateVersion: null }]);
    expect(a.parse.templateVersion).toBe('old');
    const first = a.sheet.missing[0]!;
    expect(first).toMatchObject({ label: '是否把厂房分租给其他企业（厂中厂）', cell: 'B19', mismatch: true });
    expect(first.note).toContain('您填的是「不清楚」');
    // 工艺格还是「例：…」，算没填
    expect(a.sheet.missing.map((m) => m.label)).toEqual(['是否把厂房分租给其他企业（厂中厂）', '生产工艺']);

    const p = a.parse.profile;
    const prod = p.productionStep!.step;
    expect(prod.leasesPremises).toBeUndefined();
    expect(prod.materials).toHaveLength(1);
    expect(prod.materials[0]).toMatchObject({ annualUsage: '2 吨', maxStorage: '0.5 吨' });
    expect(prod.specialEquipment.pressureVessels.answer).toBe('yes');
    // 只填了第一张小组表，三个组都读到；第二张的占位「组长」不算
    const groups = p.organizationStep!.step.groups;
    expect(groups.map((g) => g.leader?.name)).toEqual(['钱组长', '周组长', '吴组长']);
    // 旧版没有安全生产主管负责人，按法定代表人
    expect(p.basicStep!.basic.responsiblePerson).toBe('林测试');
    expect(p.basicStep!.sources.responsiblePerson).toBe('legal_rep');
    expect(p.resourcesStep!.step.firstAidKit.mode).toBe('standard');
    for (const [schema, v] of [
      [basicStepSchema, p.basicStep!.basic],
      [organizationStepSchema, p.organizationStep!.step],
      [productionStepSchema, prod],
      [resourcesStepSchema, p.resourcesStep!.step],
    ] as const) {
      expect(schema.safeParse(v).success).toBe(true);
    }
  });
});

describe('放不进去的值', () => {
  test('格式不对的记进 unplaced，不悄悄丢', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await S.newNormal()) as unknown as ArrayBuffer);
    wb.getWorksheet('企业信息')!.getCell('B4').value = '不是代码';
    wb.getWorksheet('企业信息')!.getCell('B23').value = '若干';
    wb.getWorksheet('建筑与场所')!.getCell('E5').value = '甲级';
    const a = read(await analyze(Buffer.from(await wb.xlsx.writeBuffer())));
    expect(a.parse.unplaced.map((u) => u.cell)).toEqual(expect.arrayContaining(['B4', 'B23', 'E5']));
    expect(a.parse.identity.socialCreditCode).toBeNull();
    expect(a.parse.profile.basicStep!.basic.technicalManagementCount).toBeUndefined();
  });

  test('企业名称超过 100 个字：照常读完，按没填处理，原文进 unplaced，缺项里有一条', async () => {
    const long = `${S.SAMPLE_NAME}${'第一分厂'.repeat(25)}`;
    const a = read(await analyze(await S.renamed(long)));
    expect(a.parse.identity.name).toBe(S.SAMPLE_NAME);
    expect(a.rename).toBeNull();
    expect(a.parse.unplaced).toContainEqual({ sheet: '企业信息', cell: 'B3', label: '企业名称', text: long });
    expect(a.sheet.missing.filter((m) => m.field === 'enterprise.name')).toEqual([
      { field: 'enterprise.name', label: '企业名称', sheet: '企业信息', row: 3, cell: 'B3', note: '超过 100 个字。按营业执照上的全称填。' },
    ]);
  });
});
