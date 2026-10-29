import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// 文件存储接口按阿里云对象存储设计：私有读写，只能通过短时效链接下载。
// 本机开发与测试用 LocalDiskStorage；预览与正式环境换成对象存储实现，业务代码不变。
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  // 后台自己读取内容（如识别营业执照），不经过下载链接
  read(key: string): Promise<Buffer>;
  // 生成短时效下载链接；filename 是客户看到的原文件名。inline = 在页面里直接显示（专家对照原件），不另存
  downloadUrl(key: string, opts: DownloadOptions): Promise<string>;
}

export interface DownloadOptions {
  filename: string;
  contentType: string;
  ttlSeconds: number;
  inline?: boolean;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

// 下载链接默认有效期
export const DOWNLOAD_TTL_SECONDS = 5 * 60;

// 存储路径只由系统生成的 ID 组成：组织 ID/文件 ID
const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export interface SignedDownload {
  key: string;
  filename: string;
  contentType: string;
  expires: number;
  inline: boolean;
}

/**
 * 存在本机磁盘，没有公开地址。下载链接形如 /api/files/blob?k=…&n=…&t=…&e=…&s=…，
 * 签名覆盖全部参数，改动任何一个或过期都无法下载。
 */
export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(
    root: string,
    private readonly secret: string,
  ) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`invalid storage key ${key}`);
    return join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async downloadUrl(key: string, opts: DownloadOptions): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
    const params = new URLSearchParams({ k: key, n: opts.filename, t: opts.contentType, e: String(expires) });
    if (opts.inline) params.set('d', 'inline');
    params.set('s', this.sign(params));
    return `/api/files/blob?${params}`;
  }

  // 校验下载链接；不通过返回 null
  verify(query: Record<string, unknown>): SignedDownload | null {
    const { k, n, t, e, d, s } = query;
    if (![k, n, t, e, s].every((v) => typeof v === 'string')) return null;
    const params = new URLSearchParams({ k: k as string, n: n as string, t: t as string, e: e as string });
    if (d === 'inline') params.set('d', 'inline');
    const expected = Buffer.from(this.sign(params));
    const given = Buffer.from(s as string);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const expires = Number(e);
    if (!(expires > Date.now() / 1000) || !KEY_PATTERN.test(k as string)) return null;
    return { key: k as string, filename: n as string, contentType: t as string, expires, inline: d === 'inline' };
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  private sign(params: URLSearchParams): string {
    return createHmac('sha256', this.secret).update(params.toString()).digest('base64url');
  }
}

// 签名密钥：正式环境必须配置 FILE_URL_SECRET；本机开发每次启动随机生成（重启后旧链接失效）
export function defaultStorage(): FileStorage {
  const secret = process.env.FILE_URL_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('请配置 FILE_URL_SECRET');
  return new LocalDiskStorage(process.env.FILE_STORAGE_DIR ?? '.data/files', secret ?? randomBytes(32).toString('hex'));
}
