import type { DeliveryDocument } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './document-json.ts';

describe('文档结构存取', () => {
  it('图片原样还原', () => {
    const doc: DeliveryDocument = {
      kind: 'plan',
      title: 't',
      cover: { company: 'c', name: 'n', lines: [], dates: [] },
      frontPages: [],
      sections: [{ id: 's', title: '1', blocks: [{ type: 'figure', png: new Uint8Array([0, 255, 7]), width: 1, height: 1 }], sections: [] }],
    };
    const fig = parseDocument(serializeDocument(doc)).sections[0]!.blocks[0]!;
    expect(fig.type === 'figure' && fig.png).toBeInstanceOf(Uint8Array);
    expect(fig.type === 'figure' && Array.from(fig.png)).toEqual([0, 255, 7]);
  });

  it('画图出来的是 Node 的 Buffer（自带 toJSON）也能还原', () => {
    const doc: DeliveryDocument = {
      kind: 'plan',
      title: 't',
      cover: { company: 'c', name: 'n', lines: [], dates: [] },
      frontPages: [],
      sections: [{ id: 's', title: '1', blocks: [{ type: 'figure', png: Buffer.from([9, 8, 7]), width: 1, height: 1 }], sections: [] }],
    };
    const fig = parseDocument(serializeDocument(doc)).sections[0]!.blocks[0]!;
    expect(fig.type === 'figure' && Array.from(fig.png)).toEqual([9, 8, 7]);
  });
});
