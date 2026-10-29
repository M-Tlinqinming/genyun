// Word 转 PDF（「后台转 PDF」预览方式，第 2 项小样）：用 LibreOffice 打开、更新目录页码后导出，见 soffice-pdf.py。
// 本机用 SOFFICE_PATH 指向 soffice 可执行文件，自动用同目录下 LibreOffice 自带的 Python；
// 服务器镜像装 libreoffice-writer、python3-uno 后直接用 soffice 和 python3。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT = join(import.meta.dirname, 'soffice-pdf.py');

function commands() {
  const soffice = process.env.SOFFICE_PATH || 'soffice';
  const bundled = join(dirname(soffice), process.platform === 'win32' ? 'python.exe' : 'python');
  return { soffice, python: process.env.SOFFICE_PATH && existsSync(bundled) ? bundled : 'python3' };
}

export async function convertToPdf(docx: Uint8Array): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'genyun-pdf-'));
  try {
    const input = join(dir, 'document.docx');
    const output = join(dir, 'document.pdf');
    await writeFile(input, docx);
    const { soffice, python } = commands();
    // 每次用独立的配置目录，几个转换同时进行时互不锁住
    await run(python, [SCRIPT, soffice, input, output, pathToFileURL(join(dir, 'profile')).href], {
      timeout: 180_000,
      windowsHide: true,
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
