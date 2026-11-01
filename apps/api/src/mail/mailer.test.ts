import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AliyunMailer } from './aliyun.ts';
import { defaultMailer, type Mailer, type MailMessage, outboxEnabled, RetryingMailer, SimulatedMailer } from './mailer.ts';
import { invitationMail, passwordResetMail, recoveryCodeMail } from './templates.ts';

const AT = new Date('2026-11-01T01:30:00Z');

describe('邮件模板', () => {
  const mails = {
    invitation: invitationMail({
      to: 'lin@example.cn',
      name: '林管理员',
      inviterName: '耕云运营',
      orgName: '示例安全咨询机构',
      roleLabel: '机构管理员',
      link: 'https://preview.example.cn/invite/abc?x=1&y=2',
      expiresAt: new Date('2026-11-08T01:30:00Z'),
    }),
    recoveryCode: recoveryCodeMail({ to: 'lin@example.cn', name: '林管理员', code: '482913', validMinutes: 10 }),
    passwordReset: passwordResetMail({ to: 'lin@example.cn', name: '林管理员', at: AT }),
  };

  for (const [name, mail] of Object.entries(mails)) {
    it(`${name}：纯文本和 HTML 两版`, () => {
      expect(mail.text).toMatchSnapshot('text');
      expect(mail.html).toMatchSnapshot('html');
    });

    it(`${name}：有称呼和落款；主题里没有验证码和链接；没有内部编码`, () => {
      expect(mail.text.startsWith('林管理员，您好：')).toBe(true);
      expect(mail.text.endsWith('耕云 · 0752-5200831')).toBe(true);
      expect(mail.html).toContain('耕云 · 0752-5200831');
      expect(mail.subject).not.toMatch(/\d{6}|https?:/);
      expect(`${mail.subject}${mail.text}`).not.toMatch(/customer_admin|recovery_code|password_reset|\bE[1-6]\b|\bS1\b|\bR1\b|\bSP\d/);
    });
  }

  it('有效期写清楚', () => {
    expect(mails.invitation.text).toContain('链接有效期至 2026 年 11 月 8 日 09:30（北京时间），只能使用一次');
    expect(mails.invitation.text).not.toContain('最新一封');
    expect(mails.recoveryCode.text).toContain('验证码 10 分钟内有效，只能使用一次');
    expect(mails.passwordReset.text).toContain('2026 年 11 月 1 日 09:30（北京时间）');
  });

  it('重新发送的邀请写明以最新一封为准', () => {
    const m = invitationMail({ to: 'a@b.cn', name: '张三', inviterName: '耕云运营', orgName: 'A', roleLabel: '机构管理员', link: 'https://x.cn/i', expiresAt: AT, resend: true });
    expect(m.text).toContain('之前的邀请链接已作废，请以最新一封为准');
  });

  it('HTML 里转义收件人能控制的内容', () => {
    const m = invitationMail({ ...{ to: 'a@b.cn', inviterName: '耕云运营', roleLabel: '成员', link: 'https://x.cn/i', expiresAt: AT }, name: '<b>张三</b>', orgName: 'A&B' });
    expect(m.html).toContain('&lt;b&gt;张三&lt;/b&gt;');
    expect(m.html).toContain('A&amp;B');
    expect(m.html).not.toContain('<b>张三');
  });
});

describe('发信失败重试', () => {
  afterEach(() => vi.restoreAllMocks());
  const message: MailMessage = { to: 'lin@example.cn', subject: '重设耕云登录密码的验证码', text: '验证码：482913\nhttps://x.cn/invite/secret', kind: 'recovery_code' };

  function flaky(failures: number): Mailer & { calls: number } {
    return {
      calls: 0,
      async send() {
        this.calls++;
        if (this.calls <= failures) throw new Error('邮件推送返回 503：ServiceUnavailable');
      },
    };
  }

  it('失败一次后重试成功；日志里没有验证码和链接', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const inner = flaky(1);
    await new RetryingMailer(inner, 1).send(message);
    expect(inner.calls).toBe(2);
    expect(logs.join('\n')).toContain('li****@example.cn');
    expect(logs.join('\n')).not.toMatch(/482913|https?:|secret|lin@/);
  });

  it('重试也失败时抛出，只重试一次', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const inner = flaky(5);
    await expect(new RetryingMailer(inner, 1).send(message)).rejects.toThrow('ServiceUnavailable');
    expect(inner.calls).toBe(2);
    expect(logs.join('\n')).not.toMatch(/482913|https?:|secret/);
  });
});

describe('选用发信方式', () => {
  afterEach(() => vi.restoreAllMocks());
  const creds = { ALIYUN_DM_ACCESS_KEY_ID: 'x', ALIYUN_DM_ACCESS_KEY_SECRET: 'y', ALIYUN_DM_ACCOUNT_NAME: 'n@m.cn' };

  it('MAIL_DRIVER=aliyun 且凭据齐全：阿里云（带重试），正式环境和本机都一样', () => {
    for (const NODE_ENV of ['production', 'development']) {
      const m = defaultMailer({ NODE_ENV, MAIL_DRIVER: 'aliyun', ...creds });
      expect(m).toBeInstanceOf(RetryingMailer);
      expect(m.simulated).toBeUndefined();
      expect((m as unknown as { inner: unknown }).inner).toBeInstanceOf(AliyunMailer);
    }
  });

  it('正式环境没设 MAIL_DRIVER：启动报错，不悄悄模拟发信', () => {
    expect(() => defaultMailer({ NODE_ENV: 'production' })).toThrow(/MAIL_DRIVER/);
  });

  it('不认识的 MAIL_DRIVER：正式环境和本机都报错', () => {
    expect(() => defaultMailer({ NODE_ENV: 'production', MAIL_DRIVER: 'smtp' })).toThrow(/MAIL_DRIVER=smtp/);
    expect(() => defaultMailer({ NODE_ENV: 'development', MAIL_DRIVER: 'smtp' })).toThrow(/MAIL_DRIVER=smtp/);
  });

  it('正式环境 MAIL_DRIVER=aliyun 缺任何一项凭据：启动报错', () => {
    for (const missing of Object.keys(creds)) {
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', MAIL_DRIVER: 'aliyun', ...creds };
      delete env[missing];
      expect(() => defaultMailer(env)).toThrow(/凭据没配齐/);
    }
  });

  it('本机和测试 MAIL_DRIVER=aliyun 但没有凭据：模拟发信，发件箱不开放', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const NODE_ENV of ['development', 'test']) {
      expect(defaultMailer({ NODE_ENV, MAIL_DRIVER: 'aliyun' })).toBeInstanceOf(SimulatedMailer);
      expect(outboxEnabled({ NODE_ENV, MAIL_DRIVER: 'aliyun' })).toBe(false);
    }
  });

  it('本机和测试不设 MAIL_DRIVER：模拟发信', () => {
    expect(defaultMailer({ NODE_ENV: 'development' })).toBeInstanceOf(SimulatedMailer);
    expect(defaultMailer({ NODE_ENV: 'test' })).toBeInstanceOf(SimulatedMailer);
  });

  it('正式环境显式设 MAIL_DRIVER=mock（预览环境）：模拟发信', () => {
    expect(defaultMailer({ NODE_ENV: 'production', MAIL_DRIVER: 'mock' })).toBeInstanceOf(SimulatedMailer);
  });

  it('发件箱只在模拟发信时开放；正式环境不设 MAIL_DRIVER 也不开放', () => {
    expect(outboxEnabled({})).toBe(true);
    expect(outboxEnabled({ MAIL_DRIVER: 'mock' })).toBe(true);
    expect(outboxEnabled({ MAIL_DRIVER: 'mock', NODE_ENV: 'production' })).toBe(true);
    expect(outboxEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(outboxEnabled({ NODE_ENV: 'production', MAIL_DRIVER: 'aliyun', ...creds })).toBe(false);
  });
});

describe('模拟发信', () => {
  let dir: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('写进发件箱，新的在前；服务日志只有打码的收件人和主题', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gy-outbox-'));
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const mailer = new SimulatedMailer(dir);
    await mailer.send(recoveryCodeMail({ to: 'lin@example.cn', name: '林管理员', code: '482913', validMinutes: 10 }));
    await mailer.send(passwordResetMail({ to: 'lin@example.cn', name: '林管理员', at: AT }));
    const mails = await mailer.list();
    expect(mails.map((m) => m.kind)).toEqual(['password_reset', 'recovery_code']);
    expect(mails[1]!.text).toContain('482913');
    expect(mails[1]!.html).toContain('482913');
    expect(logs.join('\n')).toContain('li****@example.cn');
    expect(logs.join('\n')).not.toContain('482913');
  });

  it('正式环境（预览）也只记打码的收件人和主题，不把正文和链接打进日志', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gy-outbox-'));
    vi.stubEnv('NODE_ENV', 'production');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const mailer = new SimulatedMailer(dir);
    await mailer.send({ to: 'a@b.cn', subject: '邀请', text: '链接 https://x/invite/secret-token' });
    expect(logs.join('\n')).toContain('a****@b.cn');
    expect(logs.join('\n')).not.toMatch(/secret-token|https?:/);
    // 正文仍写进发件箱，预览环境在「模拟发件箱」查看
    expect((await mailer.list())[0]!.text).toContain('secret-token');
    vi.unstubAllEnvs();
  });

  it('发件箱目录还不存在时是空的', async () => {
    expect(await new SimulatedMailer(join(tmpdir(), 'gy-outbox-none-' + Date.now())).list()).toEqual([]);
  });
});
