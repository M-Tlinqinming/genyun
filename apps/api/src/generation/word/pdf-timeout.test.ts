import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runConverter } from './pdf.ts';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// 转换卡住超时：连同转换脚本拉起的子进程（相当于 soffice）一起结束，不留孤儿进程
describe('Word 转 PDF 超时', () => {
  it('杀掉整个进程树', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genyun-pdf-timeout-'));
    const pidFile = join(dir, 'child.pid');
    try {
      const script = [
        "const { spawn } = require('node:child_process');",
        "const fs = require('node:fs');",
        "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));`,
        'setTimeout(() => {}, 60000);',
      ].join('\n');
      const started = Date.now();
      await expect(runConverter(process.execPath, ['-e', script], 1500)).rejects.toThrow('超时');
      expect(Date.now() - started).toBeLessThan(10_000);
      const grandchild = Number(readFileSync(pidFile, 'utf8'));
      // 杀进程树是异步的：等一会儿再看
      for (let i = 0; i < 40 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
      expect(alive(grandchild)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('脚本出错时带上错误输出', async () => {
    await expect(runConverter(process.execPath, ['-e', "console.error('坏了'); process.exit(3)"], 5000)).rejects.toThrow(/失败（3）：坏了/);
  });
});
