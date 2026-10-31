// 测试用：拼一份几页的 PDF，每页画几条线（像 CAD 导出的图纸，没有文字层）。页面尺寸用点（1/72 英寸）。
export function testPdf(pages: { width: number; height: number }[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((p, i) => {
    const id = pageIds[i]!;
    const content = `2 w 0 0 1 RG 20 20 ${p.width - 40} ${p.height - 40} re S 1 0 0 RG 20 20 m ${p.width - 20} ${p.height - 20} l S`;
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// A4 横、A4 竖、A3 横
export const LANDSCAPE = { width: 842, height: 595 };
export const PORTRAIT = { width: 595, height: 842 };
export const A3 = { width: 1191, height: 842 };
