import { describe, expect, it } from 'vitest';
import { AliyunMailer, aliyunConfigFromEnv, percentEncode, sign, stringToSign } from './aliyun.ts';

describe('阿里云 RPC 签名', () => {
  // 阿里云文档「RPC 风格接口的签名机制」里的示例（邮件推送用同一套签名）：
  // AccessKeyId=testid，AccessKeySecret=testsecret，GET 请求 DescribeRegions
  const docParams = {
    Timestamp: '2016-02-23T12:46:24Z',
    Format: 'XML',
    AccessKeyId: 'testid',
    Action: 'DescribeRegions',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf',
    Version: '2014-05-26',
    SignatureVersion: '1.0',
  };

  it('待签名字符串和文档一致', () => {
    expect(stringToSign('GET', docParams)).toBe(
      'GET&%2F&AccessKeyId%3Dtestid%26Action%3DDescribeRegions%26Format%3DXML%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3D3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf%26SignatureVersion%3D1.0%26Timestamp%3D2016-02-23T12%253A46%253A24Z%26Version%3D2014-05-26',
    );
  });

  it('签名和文档一致', () => {
    expect(sign('GET', docParams, 'testsecret')).toBe('OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
  });

  it('百分号编码：空格 %20、星号 %2A、波浪号不编码、中文按 UTF-8', () => {
    expect(percentEncode('a b*c~d')).toBe('a%20b%2Ac~d');
    expect(percentEncode("!'()")).toBe('%21%27%28%29');
    expect(percentEncode('耕')).toBe('%E8%80%95');
  });
});

describe('阿里云邮件推送', () => {
  const config = {
    accessKeyId: 'testid',
    accessKeySecret: 'testsecret',
    accountName: 'noreply@mail.example.cn',
    fromAlias: '耕云',
    endpoint: 'https://dm.aliyuncs.com/',
    regionId: 'cn-hangzhou',
  };
  const message = { to: 'a@example.cn', subject: '主题', text: '正文', html: '<p>正文</p>', kind: 'invitation' as const };

  it('SingleSendMail 的参数齐全，签名可复算', () => {
    const mailer = new AliyunMailer(config, fetch, () => new Date('2026-11-01T01:02:03.456Z'));
    const params = mailer.params(message, 'nonce-1');
    expect(params).toMatchObject({
      Action: 'SingleSendMail',
      AccountName: 'noreply@mail.example.cn',
      AddressType: '1',
      ReplyToAddress: 'false',
      ToAddress: 'a@example.cn',
      Subject: '主题',
      TextBody: '正文',
      HtmlBody: '<p>正文</p>',
      FromAlias: '耕云',
      Version: '2015-11-23',
      Timestamp: '2026-11-01T01:02:03Z',
      SignatureNonce: 'nonce-1',
    });
    const { Signature, ...rest } = params;
    expect(Signature).toBe(sign('POST', rest, 'testsecret'));
  });

  it('用 POST 表单提交，网址里没有邮件内容；接口报错时抛出错误码，不带正文', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ Code: 'InvalidMailAddress.NotFound', Message: 'The specified mail address is not found.' }), { status: 404 });
    }) as unknown as typeof fetch;
    const mailer = new AliyunMailer(config, fakeFetch);
    const err = await mailer.send({ ...message, text: '验证码：123456' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('邮件推送返回 404：InvalidMailAddress.NotFound The specified mail address is not found.');
    expect((err as Error).message).not.toContain('123456');
    expect(calls[0]!.url).toBe('https://dm.aliyuncs.com/');
    expect(calls[0]!.init.method).toBe('POST');
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('TextBody')).toBe('验证码：123456');
  });

  it('凭据没配齐时返回 null（改用模拟发信）', () => {
    expect(aliyunConfigFromEnv({})).toBeNull();
    expect(aliyunConfigFromEnv({ ALIYUN_DM_ACCESS_KEY_ID: 'x', ALIYUN_DM_ACCESS_KEY_SECRET: 'y' })).toBeNull();
    expect(
      aliyunConfigFromEnv({ ALIYUN_DM_ACCESS_KEY_ID: 'x', ALIYUN_DM_ACCESS_KEY_SECRET: 'y', ALIYUN_DM_ACCOUNT_NAME: 'n@m.cn' }),
    ).toMatchObject({ fromAlias: '耕云', endpoint: 'https://dm.aliyuncs.com/', regionId: 'cn-hangzhou' });
  });
});
