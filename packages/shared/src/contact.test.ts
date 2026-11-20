import { describe, expect, it } from 'vitest';
import { contactAnswerError, defaultQuestion, maskPhone } from './contact.ts';
import { workupFacts } from './workup.ts';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';

describe('联系客户 · 要问的问题', () => {
  it('按企业事实类型给出默认问法', () => {
    expect(defaultQuestion('技术人员数', 'count')).toBe('公司现在有多少技术人员？');
    expect(defaultQuestion('总指挥', 'person')).toBe('总指挥是谁？请提供姓名、职位和手机。');
    expect(defaultQuestion('值班电话', 'text')).toBe('请提供值班电话。');
  });

  it('客户回答：每个问题写文字或附文件', () => {
    const questions = [
      { id: 'q1', label: '技术人员数', question: '有多少？' },
      { id: 'q2', label: '值班电话', question: '是多少？' },
    ];
    expect(contactAnswerError(questions, { answers: [{ questionId: 'q1', text: '6 位', fileIds: [] }] })).toBe(
      '请回答「值班电话」，写文字或附文件都可以',
    );
    expect(
      contactAnswerError(questions, {
        answers: [
          { questionId: 'q1', text: '6 位', fileIds: [] },
          { questionId: 'q2', fileIds: ['00000000-0000-4000-8000-000000000001'] },
        ],
      }),
    ).toBeNull();
  });

  it('号码只露前三后四', () => {
    expect(maskPhone('138-0000-2071')).toBe('138 **** 2071');
    expect(maskPhone('12345')).toBe('12345');
  });
});

describe('联系客户 · 任务内补充的来源', () => {
  it('专家采用了客户的回答：来源记为「客户确认 · 任务内补充」', () => {
    const data = {
      overrides: {
        technicalManagementCount: { value: 6, source: 'customer' as const, via: 'request' as const, contactId: 'c1', by: 'u', byName: '周工', at: '' },
      },
    };
    const fact = workupFacts(feiyuSnapshot, data).find((f) => f.key === 'technicalManagementCount')!;
    expect([fact.source, fact.sourceNote, fact.status]).toEqual(['customer', '任务内补充', 'done']);
  });
});
