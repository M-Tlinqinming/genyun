// 防压缩炸弹：交给 exceljs 之前，按中央目录逐个条目真解压一遍，边解边数字节，输出直接丢掉。
// 目录里写的解压后大小可以伪造，不信它；压缩数据的长度以中央目录为准（本地头带 data descriptor 时那里是 0）。
// 文件太多、解开太大记 too_large；目录读不通、解压出错、不认识的压缩方式记 not_zip，交给后面当「打不开」处理。
import { createInflateRaw } from 'node:zlib';

export const ZIP_MAX_ENTRIES = 1000;
export const ZIP_MAX_UNCOMPRESSED = 200 * 1024 * 1024;

export type ZipCheck = { ok: true; entries: number; uncompressed: number } | { ok: false; reason: 'not_zip' | 'too_large' };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATE = 8;

interface Entry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

class Bad extends Error {
  constructor(readonly reason: 'not_zip' | 'too_large') {
    super(reason);
  }
}

export async function checkZip(buf: Buffer): Promise<ZipCheck> {
  try {
    const entries = readDirectory(buf);
    let uncompressed = 0;
    for (const e of entries) {
      uncompressed += await entrySize(buf, e, ZIP_MAX_UNCOMPRESSED - uncompressed);
    }
    return { ok: true, entries: entries.length, uncompressed };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, reason: e.reason };
    throw e;
  }
}

function readDirectory(buf: Buffer): Entry[] {
  if (buf.length < 22) throw new Bad('not_zip');
  // 中央目录结尾记录在文件最后，后面最多跟 65535 字节的注释
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Bad('not_zip');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64：正常的资料表格（20 MB 以内）用不到，出现了就当内容异常
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Bad('too_large');
  if (total > ZIP_MAX_ENTRIES) throw new Bad('too_large');
  if (cdOffset + cdSize > eocd) throw new Bad('not_zip');
  const entries: Entry[] = [];
  let pos = cdOffset;
  while (pos < cdOffset + cdSize) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL) throw new Bad('not_zip');
    const compressedSize = buf.readUInt32LE(pos + 20);
    const localOffset = buf.readUInt32LE(pos + 42);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff || buf.readUInt32LE(pos + 24) === 0xffffffff) {
      throw new Bad('too_large');
    }
    entries.push({ method: buf.readUInt16LE(pos + 10), compressedSize, localOffset });
    if (entries.length > ZIP_MAX_ENTRIES) throw new Bad('too_large');
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  if (entries.length !== total) throw new Bad('not_zip');
  return entries;
}

// 解开一个条目实际有多少字节；超过 budget 就停（too_large）
async function entrySize(buf: Buffer, e: Entry, budget: number): Promise<number> {
  const h = e.localOffset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== LOCAL) throw new Bad('not_zip');
  // 本地头只用来找数据从哪开始：名字和扩展字段的长度
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const end = start + e.compressedSize;
  if (end > buf.length) throw new Bad('not_zip');
  const data = buf.subarray(start, end);
  if (e.method === STORED) {
    if (data.length > budget) throw new Bad('too_large');
    return data.length;
  }
  if (e.method !== DEFLATE) throw new Bad('not_zip');
  return new Promise<number>((resolve, reject) => {
    const inflate = createInflateRaw();
    let count = 0;
    let done = false;
    const finish = (err: Bad | null) => {
      if (done) return;
      done = true;
      if (err) {
        inflate.destroy();
        reject(err);
      } else resolve(count);
    };
    inflate.on('data', (chunk: Buffer) => {
      count += chunk.length;
      if (count > budget) finish(new Bad('too_large'));
    });
    inflate.on('error', () => finish(new Bad('not_zip')));
    inflate.on('end', () => finish(null));
    inflate.end(data);
  });
}
