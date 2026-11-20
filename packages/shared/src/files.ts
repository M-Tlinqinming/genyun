// 上传文件的类型与大小规则（Paper 12 页 P03、P01；16 页合同原件）。前后端共用。
// 类型按文件内容判断，不看扩展名。

export const FILE_TYPES = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  jpg: { mime: 'image/jpeg', label: 'JPG' },
  png: { mime: 'image/png', label: 'PNG' },
  webp: { mime: 'image/webp', label: 'WEBP' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'DOCX' },
  doc: { mime: 'application/msword', label: 'DOC' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'XLSX' },
  xls: { mime: 'application/vnd.ms-excel', label: 'XLS' },
  // CAD 图纸（准备资料的图纸与照片）
  dwg: { mime: 'image/vnd.dwg', label: 'DWG' },
  dxf: { mime: 'image/vnd.dxf', label: 'DXF' },
} as const;
export type FileType = keyof typeof FILE_TYPES;

const MB = 1024 * 1024;

// 不同上传入口接受的文件。老版本 Word / Excel 由 Martin 10-27 确认加入（业主资料多为 .doc）
export const UPLOAD_RULES = {
  // 企业已有资料、资料项附件
  material: { types: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'jpg', 'png', 'webp'], maxBytes: 10 * MB },
  // 营业执照、图纸、铭牌等只要图片或扫描件
  image_or_pdf: { types: ['pdf', 'jpg', 'png', 'webp'], maxBytes: 10 * MB },
  // 已签合同原件，仅运营上传和查看（M3）
  contract: { types: ['pdf'], maxBytes: 20 * MB },
  // 准备资料：填好的资料表格，只收 .xlsx
  intake_sheet: { types: ['xlsx'], maxBytes: 20 * MB },
  // 准备资料：总平面布置图、紧急疏散示意图、其他图纸与照片（手绘拍照、扫描件、CAD 都可以）
  intake_drawing: { types: ['pdf', 'jpg', 'png', 'webp', 'dwg', 'dxf'], maxBytes: 10 * MB },
} as const satisfies Record<string, { types: readonly FileType[]; maxBytes: number }>;
export type UploadRule = keyof typeof UPLOAD_RULES;

export function uploadRuleHint(rule: UploadRule): string {
  const { types, maxBytes } = UPLOAD_RULES[rule];
  return `${types.map((t) => FILE_TYPES[t].label).join('、')} · 单个文件不超过 ${maxBytes / MB} MB`;
}

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const contains = (buf: Uint8Array, needle: number[]) => {
  outer: for (let i = 0; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
// 老版本 Office 文件的内部目录名是 UTF-16 小端编码
const utf16le = (s: string) => [...s].flatMap((c) => [c.charCodeAt(0), 0]);

// 根据文件开头的特征字节判断类型；认不出返回 null
export function detectFileType(buf: Uint8Array): FileType | null {
  if (startsWith(buf, ascii('%PDF-'))) return 'pdf';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'webp';
  // DOCX / XLSX 是 zip 包，看里面的目录名
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && contains(buf, ascii('[Content_Types].xml'))) {
    if (contains(buf, ascii('word/'))) return 'docx';
    if (contains(buf, ascii('xl/workbook'))) return 'xlsx';
    return null;
  }
  // DOC / XLS 是 OLE 复合文档
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (contains(buf, utf16le('WordDocument'))) return 'doc';
    if (contains(buf, utf16le('Workbook')) || contains(buf, utf16le('Book'))) return 'xls';
    return null;
  }
  // CAD：DWG 开头是「AC10」加版本号；DXF 有文本和二进制两种
  if (startsWith(buf, ascii('AC10'))) return 'dwg';
  if (startsWith(buf, ascii('AutoCAD Binary DXF'))) return 'dxf';
  if (isTextDxf(buf)) return 'dxf';
  return null;
}

// 文本 DXF：头两个非空行是「0」「SECTION」
function isTextDxf(buf: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(buf.subarray(0, 64));
  const lines = head.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  return lines[0] === '0' && lines[1] === 'SECTION';
}

/** 压缩包（S02 原话）：zip（不是 Office 文件的）、rar、7z、gz 一律这么回 */
export const ARCHIVE_MESSAGE = '压缩包打不开。请解压后把里面的文件传上来。';

export function isArchive(buf: Uint8Array): boolean {
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    return !contains(buf, ascii('[Content_Types].xml'));
  }
  return (
    startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) ||
    startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) ||
    startsWith(buf, [0x1f, 0x8b])
  );
}

// 资料表格传错格式时的提示（我拟的）：老版 Excel 单说一句，其余统一一句
export const INTAKE_SHEET_XLS_MESSAGE = '这是老版 Excel（.xls）文件，读不了。请用下载的资料模板（.xlsx）填好再传；手上只有 .xls 的，用 Excel 或 WPS 另存为 .xlsx 也可以。';
export const INTAKE_SHEET_TYPE_MESSAGE = '资料表格只收 .xlsx 文件。请用下载的资料模板填好再传。';

// 校验上传文件；不通过时返回给客户看的原因
export function fileRejectionReason(rule: UploadRule, name: string, buf: Uint8Array): string | null {
  const { types, maxBytes } = UPLOAD_RULES[rule];
  if (buf.length > maxBytes) {
    return `${name} 为 ${(buf.length / MB).toFixed(1)} MB，超过单个文件 ${maxBytes / MB} MB 限制。请压缩后重新选择`;
  }
  if (buf.length === 0) return `${name} 是空文件，请重新选择`;
  const type = detectFileType(buf);
  if (!type && isArchive(buf)) return ARCHIVE_MESSAGE;
  if (rule === 'intake_sheet' && type !== 'xlsx') return type === 'xls' ? INTAKE_SHEET_XLS_MESSAGE : INTAKE_SHEET_TYPE_MESSAGE;
  if (!type || !(types as readonly FileType[]).includes(type)) {
    return `${name} 的格式不支持，请选择 ${types.map((t) => FILE_TYPES[t].label).join('、')}`;
  }
  return null;
}
