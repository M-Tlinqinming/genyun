import { describe, expect, it } from 'vitest';
import { generationRetrySchema } from './generation.ts';

describe('单份重新生成的请求体', () => {
  it('不带 kind、带三种 kind 都可以；不认识的 kind 不行', () => {
    expect(generationRetrySchema.safeParse({}).success).toBe(true);
    for (const kind of ['plan', 'risk', 'resource']) expect(generationRetrySchema.safeParse({ kind }).data).toEqual({ kind });
    expect(generationRetrySchema.safeParse({ kind: 'nope' }).success).toBe(false);
    expect(generationRetrySchema.safeParse({ kind: 1 }).success).toBe(false);
  });
});
