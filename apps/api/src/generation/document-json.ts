// 生成时的文档结构存成 JSON 文件（正文编辑在它上面按节修订，之后重新出 Word）。
// 图片是二进制，存成 base64 字符串，读回时还原。
import type { DeliveryDocument } from '@genyun/shared';

const TAG = '__base64__';

export function serializeDocument(doc: DeliveryDocument): Buffer {
  return Buffer.from(
    JSON.stringify(doc, (_key, value: unknown) => (value instanceof Uint8Array ? { [TAG]: Buffer.from(value).toString('base64') } : value)),
  );
}

export function parseDocument(data: Buffer): DeliveryDocument {
  return JSON.parse(data.toString('utf8'), (_key, value: unknown) =>
    value && typeof value === 'object' && TAG in value
      ? new Uint8Array(Buffer.from((value as Record<string, string>)[TAG]!, 'base64'))
      : value,
  ) as DeliveryDocument;
}
