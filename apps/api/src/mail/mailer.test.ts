import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultMailer, SimulatedMailer } from './mailer.ts';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});

describe('选用发信方式', () => {
  it('正式环境没配发信方式时启动就报错，不悄悄只写日志', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MAIL_DRIVER;
    expect(() => defaultMailer()).toThrow(/MAIL_DRIVER/);
  });

  it('正式环境显式设 MAIL_DRIVER=mock 时用模拟发信（预览环境）', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_DRIVER = 'mock';
    expect(defaultMailer()).toBeInstanceOf(SimulatedMailer);
  });

  it('不认识的发信方式报错', () => {
    process.env.MAIL_DRIVER = 'smtp';
    expect(() => defaultMailer()).toThrow(/MAIL_DRIVER/);
  });

  it('本机和测试默认模拟发信', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.MAIL_DRIVER;
    expect(defaultMailer()).toBeInstanceOf(SimulatedMailer);
  });
});

describe('模拟发信', () => {
  it('正式环境只记收件人和标题，不把正文和链接打进日志', async () => {
    process.env.NODE_ENV = 'production';
    const dir = await mkdtemp(join(tmpdir(), 'genyun-mail-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new SimulatedMailer(dir).send({ to: 'a@b.cn', subject: '邀请', text: '链接 https://x/invite/secret-token' });
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).toContain('a@b.cn');
    expect(printed).not.toContain('secret-token');
    // 正文仍写进发件箱文件，供预览环境在服务器上查
    expect(await readdir(dir)).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });
});
