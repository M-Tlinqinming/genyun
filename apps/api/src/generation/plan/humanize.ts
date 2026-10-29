// 交付物可读化（迁自旧仓库 md-generator/assemble.ts humanizeCanonical）：模板正文里的内部编号
// （P1、SP04/SP11…）换成预案名称，导则章节引用（§6.3.1…）换成本预案的章节号，去掉警示图标。
// 应急管理局和客户看不懂这些编号；安全要点句不含编号，可读化不会改动它们。
import { PLAN_TEMPLATES } from '@genyun/shared';

const ID_TITLE = new Map(PLAN_TEMPLATES.map((t) => [t.id, t.title]));
// 电梯（SP08a）与起重机（SP08b）10-29 合成一份，知识块里的旧编号仍指它
for (const old of ['SP08a', 'SP08b']) ID_TITLE.set(old, ID_TITLE.get('SP08')!);

// 导则章节 → 本预案结构里的 [章节号, 名称]：名称已紧跟其后时只留章节号，裸引用写「章节号 名称」
const SECTION_REF: Record<string, [string, string]> = {
  '§6.1': ['1', '总则'],
  '§6.1.2': ['1.2', '响应分级'],
  '§6.2': ['2', '应急组织机构及职责'],
  '§6.3': ['3', '应急响应'],
  '§6.3.1': ['3.1', '信息报告'],
  '§6.3.1.2': ['3.1', '信息报告'],
  '§6.3.2': ['3.2', '预警机制'],
  '§6.3.3': ['3.3', '响应启动'],
  '§6.3.4': ['3.4', '应急处置'],
  '§6.3.5': ['3.5', '应急支援'],
  '§6.3.6': ['3.6', '响应终止'],
  '§6.4': ['4', '后期处置'],
  '§6.5': ['5', '应急保障'],
  '§6.5.1': ['5.1', '通信与信息保障'],
  '§6.5.3': ['5.3', '物资装备保障'],
  '§6.5.4': ['5.4', '其他保障'],
  '§3.4': ['预案修订机制', ''],
  '§4.5': ['附件8', '应急资源调查报告'],
  '§9.1': ['附件1', ''],
  '§9.2': ['附件2', ''],
  '§9.3': ['附件3', ''],
  '§9.4': ['附件4', ''],
  '§9.5': ['附件5', ''],
  '§9.6': ['附件6', ''],
  '§9.7': ['附件7', ''],
  '§9.8': ['附件8', ''],
  '§2': ['本预案专项应急预案', ''],
  '§3': ['本预案现场处置方案', ''],
};

const ACCIDENT_HEAD =
  /^[ 　]?(火灾|粉尘|高温|管道|物体|高处|触电|机械|容器|灼烫|车辆|起重|泄漏|跌落|中毒|窒息|坍塌|淹溺|可燃|其他|事故|响应|预警|信息|后期|应急|通信|物资|资源|预案|《)/;

const REF_RE = new RegExp(
  `(${Object.keys(SECTION_REF)
    .sort((a, b) => b.length - a.length)
    .map((r) => r.replace(/[.$^]/g, '\\$&'))
    .join('|')})[ 　]?`,
  'g',
);

export function humanize(src: string): string {
  // 1) 内部编号（单个或用 / 、连起来的一组）→ 名称；名称已在后面时只去掉编号
  let out = src.replace(/[ 　]?\bS?P\d{1,2}[ab]?(?:[ 　]?[/、][ 　]?S?P\d{1,2}[ab]?)*\b[ 　]?/g, (m, offset: number, full: string) => {
    const ids = m.match(/S?P\d{1,2}[ab]?/g) ?? [];
    if (ids.length === 0 || !ids.every((id) => ID_TITLE.has(id))) return m;
    const titles = ids.map((id) => ID_TITLE.get(id)!);
    const pre = /^[ 　]/.test(m) ? m[0]! : '';
    const after = full.slice(offset + m.length, offset + m.length + 16);
    const nameFollows = titles.some((t) => after.includes(t.slice(0, 4))) || ACCIDENT_HEAD.test(after);
    return nameFollows ? pre : `${pre}${titles.join(' / ')}`;
  });
  // 2) 导则章节引用 → 本预案章节号（长的先匹配，免得 §6.1 被 §6 截断）
  out = out.replace(REF_RE, (m, ref: string, offset: number, full: string) => {
    const [num, name] = SECTION_REF[ref]!;
    const hadSpace = /[ 　]$/.test(m);
    if (!name) return hadSpace ? `${num} ` : num;
    const after = full.slice(offset + m.length, offset + m.length + name.length + 1);
    return after.replace(/^[ 　]/, '').startsWith(name) ? `${num} ` : `${num} ${name}${hadSpace ? ' ' : ''}`;
  });
  // 3) 没对上的 §x.y：§9 开头的写「本预案相关附件」，其余写「本预案相关章节」
  out = out.replace(/§(\d+)(?:\.\d+)*/g, (_w, head: string) => (head === '9' ? '本预案相关附件' : '本预案相关章节'));
  // 4) 正式报告不用警示图标，「严禁」「注意」等文字保留
  return out.replace(/🛑\s*|⚠️?\s*/g, '');
}
