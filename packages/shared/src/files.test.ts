import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_MESSAGE,
  INTAKE_SHEET_TYPE_MESSAGE,
  INTAKE_SHEET_XLS_MESSAGE,
  detectFileType,
  fileRejectionReason,
  isArchive,
  uploadRuleHint,
} from './files.ts';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const utf16 = (s: string) => [...s].flatMap((c) => [c.charCodeAt(0), 0]);
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const samples = {
  pdf: bytes('%PDF-1.7\n'),
  jpg: bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
  webp: bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '),
  docx: bytes([0x50, 0x4b, 0x03, 0x04], '....[Content_Types].xml....word/document.xml'),
  xlsx: bytes([0x50, 0x4b, 0x03, 0x04], '....[Content_Types].xml....xl/workbook.xml'),
  doc: bytes(OLE, [0, 0], utf16('WordDocument')),
  xls: bytes(OLE, [0, 0], utf16('Workbook')),
};

describe('按内容判断文件类型', () => {
  it.each(Object.entries(samples))('认出 %s', (type, buf) => {
    expect(detectFileType(buf)).toBe(type);
  });

  it('改了扩展名的文本文件认不出', () => {
    expect(detectFileType(bytes('hello, not a pdf'))).toBeNull();
  });

  it('普通 zip 包不当作 Word / Excel', () => {
    expect(detectFileType(bytes([0x50, 0x4b, 0x03, 0x04], 'readme.txt'))).toBeNull();
  });
});

describe('上传校验', () => {
  it('资料上传接受老版本 Word 和 Excel', () => {
    expect(fileRejectionReason('material', '资料清单.doc', samples.doc)).toBeNull();
    expect(fileRejectionReason('material', '物资.xls', samples.xls)).toBeNull();
  });

  it('营业执照入口不接受 Word', () => {
    expect(fileRejectionReason('image_or_pdf', '执照.docx', samples.docx)).toMatch(/格式不支持/);
  });

  it('超过 10 MB 时提示文件名、大小和限制', () => {
    const big = new Uint8Array(12 * 1024 * 1024);
    big.set(samples.pdf);
    expect(fileRejectionReason('material', '总平面图.pdf', big)).toBe(
      '总平面图.pdf 为 12.0 MB，超过单个文件 10 MB 限制。请压缩后重新选择',
    );
  });

  it('合同原件只收 PDF，最大 20 MB', () => {
    expect(fileRejectionReason('contract', '合同.jpg', samples.jpg)).toMatch(/格式不支持/);
    expect(uploadRuleHint('contract')).toBe('PDF · 单个文件不超过 20 MB');
  });
});

describe('准备资料的上传规则', () => {
  it('认得 DWG、文本和二进制 DXF', () => {
    expect(detectFileType(bytes('AC1032', [0, 0, 0]))).toBe('dwg');
    expect(detectFileType(bytes('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'))).toBe('dxf');
    expect(detectFileType(bytes('AutoCAD Binary DXF\r\n', [0x1a, 0]))).toBe('dxf');
    expect(detectFileType(bytes('0\nLINE\n'))).toBeNull();
  });

  it('xlsx 要有 xl/workbook', () => {
    expect(detectFileType(bytes([0x50, 0x4b, 0x03, 0x04], '[Content_Types].xml xl/styles.xml'))).toBeNull();
  });

  it('压缩包：不是 Office 的 zip、rar、7z、gz', () => {
    expect(isArchive(bytes([0x50, 0x4b, 0x03, 0x04], 'photos/a.jpg'))).toBe(true);
    expect(isArchive(samples.xlsx)).toBe(false);
    expect(isArchive(bytes([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01]))).toBe(true);
    expect(isArchive(bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe(true);
    expect(isArchive(bytes([0x1f, 0x8b, 0x08]))).toBe(true);
    expect(fileRejectionReason('intake_drawing', '图.zip', bytes([0x50, 0x4b, 0x03, 0x04], 'a.png'))).toBe(ARCHIVE_MESSAGE);
    expect(fileRejectionReason('material', '资料.7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe(ARCHIVE_MESSAGE);
  });

  it('资料表格只收 xlsx，20 MB；图纸收 PDF、图片、CAD，10 MB', () => {
    expect(fileRejectionReason('intake_sheet', '表.xlsx', samples.xlsx)).toBeNull();
    expect(fileRejectionReason('intake_sheet', '表.xls', samples.xls)).toBe(INTAKE_SHEET_XLS_MESSAGE);
    expect(fileRejectionReason('intake_sheet', '表.docx', samples.docx)).toBe(INTAKE_SHEET_TYPE_MESSAGE);
    expect(uploadRuleHint('intake_sheet')).toBe('XLSX · 单个文件不超过 20 MB');
    expect(fileRejectionReason('intake_drawing', '图.dwg', bytes('AC1027'))).toBeNull();
    expect(fileRejectionReason('intake_drawing', '图.docx', samples.docx)).toMatch(/格式不支持/);
    expect(uploadRuleHint('intake_drawing')).toBe('PDF、JPG、PNG、WEBP、DWG、DXF · 单个文件不超过 10 MB');
  });
});
