// Word 校对页（M2 第 12 项）用的 Word 转 PDF：正文改过后按当前稿重新转。
// 服务器镜像装了 LibreOffice（见 Dockerfile），本机用 SOFFICE_PATH 指定；都没有时为 null，校对页只能下载 Word 核对。
// 浏览器测试设 PDF_CONVERTER=fake：不装 LibreOffice，按 Word 大小出一份几页的假 PDF（正式环境不认）。
import { convertToPdf } from './pdf.ts';

export type PdfConverter = (docx: Buffer) => Promise<Buffer>;

export const PDF_CONVERTER = Symbol('PDF_CONVERTER');

export function defaultPdfConverter(): PdfConverter | null {
  const production = process.env.NODE_ENV === 'production';
  if (!production && process.env.PDF_CONVERTER === 'fake') return fakeConverter;
  if (production || process.env.SOFFICE_PATH) return (docx) => convertToPdf(docx);
  return null;
}

const fakeConverter: PdfConverter = async (docx) => {
  await new Promise((r) => setTimeout(r, 400));
  return simplePdf(['Genyun proofread copy', `Word ${docx.length} bytes`, 'Page 2', 'Page 3']);
};

/** 每行一页的最小 PDF（只用标准字体写 ASCII），测试和假转换用 */
export function simplePdf(lines: string[]): Buffer {
  const pages = lines.length;
  const objects: string[] = [];
  const pageIds = lines.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  lines.forEach((line, i) => {
    const text = line.replace(/[\\()]/g, (c) => `\\${c}`);
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    objects[pageIds[i]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
