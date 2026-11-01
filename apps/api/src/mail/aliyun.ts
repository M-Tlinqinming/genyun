import { createHmac, randomUUID } from 'node:crypto';
import type { Mailer, MailMessage } from './mailer.ts';

// 阿里云邮件推送（DirectMail）的 SingleSendMail 接口。用阿里云通用的 RPC 签名（HMAC-SHA1，签名版本 1.0），
// 只用 Node 自带的 crypto 和 fetch，不引入阿里云 SDK。

// 阿里云要求的百分号编码：RFC 3986，空格编码为 %20，「*」编码为 %2A，「~」不编码
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// 待签名字符串：请求方法 & 编码后的「/」& 编码后的规范化参数（按参数名排序）
export function stringToSign(method: 'GET' | 'POST', params: Record<string, string>): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join('&');
  return `${method}&${percentEncode('/')}&${percentEncode(canonical)}`;
}

// 签名：以 AccessKeySecret 加「&」为密钥做 HMAC-SHA1，结果 Base64
export function sign(method: 'GET' | 'POST', params: Record<string, string>, accessKeySecret: string): string {
  return createHmac('sha1', `${accessKeySecret}&`).update(stringToSign(method, params)).digest('base64');
}

export interface AliyunMailConfig {
  accessKeyId: string;
  accessKeySecret: string;
  // 在邮件推送控制台配置好的发信地址，例如 noreply@mail.gengyun.net.cn
  accountName: string;
  // 收件人看到的发件人名称
  fromAlias: string;
  // 接口地址，默认杭州；新加坡等地域换成对应地址
  endpoint: string;
  regionId: string;
}

// 从环境变量读配置；缺任何一项凭据返回 null（调用方改用模拟发信，不报错）
export function aliyunConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AliyunMailConfig | null {
  const accessKeyId = env.ALIYUN_DM_ACCESS_KEY_ID;
  const accessKeySecret = env.ALIYUN_DM_ACCESS_KEY_SECRET;
  const accountName = env.ALIYUN_DM_ACCOUNT_NAME;
  if (!accessKeyId || !accessKeySecret || !accountName) return null;
  return {
    accessKeyId,
    accessKeySecret,
    accountName,
    fromAlias: env.ALIYUN_DM_FROM_ALIAS || '耕云',
    endpoint: env.ALIYUN_DM_ENDPOINT || 'https://dm.aliyuncs.com/',
    regionId: env.ALIYUN_DM_REGION_ID || 'cn-hangzhou',
  };
}

// 发信失败时抛出；message 只含阿里云返回的错误码和说明，不含邮件内容
export class MailSendError extends Error {}

export class AliyunMailer implements Mailer {
  constructor(
    private readonly config: AliyunMailConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // 生成一次请求的全部参数（含签名）；拆出来方便测试
  params(message: MailMessage, nonce: string = randomUUID()): Record<string, string> {
    const c = this.config;
    const params: Record<string, string> = {
      Action: 'SingleSendMail',
      AccountName: c.accountName,
      AddressType: '1',
      ReplyToAddress: 'false',
      ToAddress: message.to,
      Subject: message.subject,
      TextBody: message.text,
      FromAlias: c.fromAlias,
      Format: 'JSON',
      Version: '2015-11-23',
      AccessKeyId: c.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: this.now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      RegionId: c.regionId,
    };
    if (message.html) params.HtmlBody = message.html;
    params.Signature = sign('POST', params, c.accessKeySecret);
    return params;
  }

  async send(message: MailMessage): Promise<void> {
    // 用 POST 表单提交：邮件内容不出现在网址里，出错时也不会被打进日志
    const body = new URLSearchParams(this.params(message)).toString();
    let res: Response;
    try {
      res = await this.fetchFn(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new MailSendError(`连不上邮件推送服务：${err instanceof Error ? err.name : 'unknown'}`);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { Code?: string; Message?: string };
      throw new MailSendError(`邮件推送返回 ${res.status}：${data.Code ?? ''} ${data.Message ?? ''}`.trim());
    }
  }
}
