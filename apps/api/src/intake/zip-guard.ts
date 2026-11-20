// 防压缩炸弹：交给 exceljs 之前，自己读 zip 的中央目录，数文件个数、加总解压后的大小。
// 只看目录里写的数，不解压。目录本身读不通的，交给后面当「打不开」处理。

export const ZIP_MAX_ENTRIES = 1000;
export const ZIP_MAX_UNCOMPRESSED = 200 * 1024 * 1024;

export type ZipCheck = { ok: true; entries: number; uncompressed: number } | { ok: false; reason: 'not_zip' | 'too_large' };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export function checkZip(buf: Buffer): ZipCheck {
  if (buf.length < 22) return { ok: false, reason: 'not_zip' };
  // 中央目录结尾记录在文件最后，后面最多跟 65535 字节的注释
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: 'not_zip' };
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64：正常的资料表格（20 MB 以内）用不到，出现了就当内容异常
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, reason: 'too_large' };
  if (total > ZIP_MAX_ENTRIES) return { ok: false, reason: 'too_large' };
  if (cdOffset + cdSize > eocd) return { ok: false, reason: 'not_zip' };
  let pos = cdOffset;
  let entries = 0;
  let uncompressed = 0;
  while (pos < cdOffset + cdSize) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL) return { ok: false, reason: 'not_zip' };
    const size = buf.readUInt32LE(pos + 24);
    if (size === 0xffffffff) return { ok: false, reason: 'too_large' };
    entries += 1;
    uncompressed += size;
    if (entries > ZIP_MAX_ENTRIES || uncompressed > ZIP_MAX_UNCOMPRESSED) return { ok: false, reason: 'too_large' };
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  if (entries !== total) return { ok: false, reason: 'not_zip' };
  return { ok: true, entries, uncompressed };
}
