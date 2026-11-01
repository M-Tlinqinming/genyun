// Word 转 PDF，给专家的 Word 校对页预览（Martin 2026-10-29 选定后台转 PDF）：
// 用 LibreOffice 打开、更新目录页码后导出，见 soffice-pdf.py。
// 本机用 SOFFICE_PATH 指向 soffice 可执行文件，自动用同目录下 LibreOffice 自带的 Python；
// 服务器镜像已装 LibreOffice 和 python3-uno（见 Dockerfile），直接用 soffice 和 python3。
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT = join(import.meta.dirname, 'soffice-pdf.py');
const TIMEOUT_MS = 180_000;

function commands() {
  const soffice = process.env.SOFFICE_PATH || 'soffice';
  const bundled = join(dirname(soffice), process.platform === 'win32' ? 'python.exe' : 'python');
  return { soffice, python: process.env.SOFFICE_PATH && existsSync(bundled) ? bundled : 'python3' };
}

// 超时时连同 python 拉起的 soffice 一起结束，不留孤儿进程：
// Linux 上子进程自成一个进程组，杀整组；Windows 上用 taskkill /T 杀整棵进程树
function killTree(pid: number) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // 进程组已经退出
  }
}

export function runConverter(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      if (child.pid) killTree(child.pid);
      reject(new Error(`Word 转 PDF 超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Word 转 PDF 失败（${signal ?? code}）${stderr ? `：${stderr.trim()}` : ''}`));
    });
  });
}

export async function convertToPdf(docx: Uint8Array, timeoutMs = TIMEOUT_MS): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'genyun-pdf-'));
  try {
    const input = join(dir, 'document.docx');
    const output = join(dir, 'document.pdf');
    await writeFile(input, docx);
    const { soffice, python } = commands();
    // 每次用独立的配置目录，几个转换同时进行时互不锁住
    await runConverter(python, [SCRIPT, soffice, input, output, pathToFileURL(join(dir, 'profile')).href], timeoutMs);
    return await readFile(output);
  } finally {
    // Windows 上 soffice 刚退出时文件可能还被占用：删不掉只记日志，不影响这次转换的结果
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch((err: unknown) => {
      console.warn(`[pdf] 临时目录没有删掉：${dir}`, err instanceof Error ? err.message : err);
    });
  }
}
