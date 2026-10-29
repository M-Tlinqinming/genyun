import { describe, expect, it } from 'vitest';
import {
  awaitingAdoption,
  contactAnswerError,
  contactCreateError,
  defaultQuestion,
  maskPhone,
  reachedCustomer,
  type ContactRecord,
} from './contact.ts';
import { workupFacts } from './workup.ts';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';

const record = (over: Partial<ContactRecord>): ContactRecord => ({
  id: 'c1',
  method: 'request',
  questions: [],
  target: null,
  result: null,
  createdAt: '2026-10-29T02:00:00.000Z',
  createdByName: '周工',
  answeredAt: null,
  answeredByName: null,
  ...over,
});

describe('联系客户 · 要问的问题', () => {
  it('按企业事实类型给出默认问法', () => {
    expect(defaultQuestion('技术人员数', 'count')).toBe('公司现在有多少技术人员？');
    expect(defaultQuestion('总指挥', 'person')).toBe('总指挥是谁？请提供姓名、职位和手机。');
    expect(defaultQuestion('值班电话', 'text')).toBe('请提供值班电话。');
  });

  it('电话问清时每个问题都要有回答，企业事实要有回填的值；未接通不用', () => {
    const target = { name: '陈志刚', role: '总指挥', phone: '13800002071' };
    const q = { factKey: 'technicalManagementCount', label: '技术人员数', question: '有多少？' };
    expect(contactCreateError({ method: 'phone', target, result: 'clarified', questions: [q] })).toBe('请填写「技术人员数」的回答');
    expect(contactCreateError({ method: 'phone', target, result: 'clarified', questions: [{ ...q, value: 6 }] })).toBeNull();
    expect(contactCreateError({ method: 'phone', target, result: 'unreachable', questions: [q] })).toBeNull();
    expect(contactCreateError({ method: 'request', questions: [q] })).toBeNull();
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

describe('联系客户 · 2 个工作日倒计时', () => {
  const since = new Date('2026-10-29T01:00:00.000Z');
  it('电话联系上客户（已问清、客户稍后补）才停止；未接通、任务内补充不停', () => {
    expect(reachedCustomer([record({ method: 'phone', result: 'unreachable' })], since)).toBe(false);
    expect(reachedCustomer([record({ method: 'request' })], since)).toBe(false);
    expect(reachedCustomer([record({ method: 'phone', result: 'later' })], since)).toBe(true);
    expect(reachedCustomer([record({ method: 'phone', result: 'clarified' })], since)).toBe(true);
  });

  it('客户请求联系之前的电话不算', () => {
    expect(reachedCustomer([record({ method: 'phone', result: 'clarified', createdAt: '2026-10-28T01:00:00.000Z' })], since)).toBe(false);
  });
});

describe('联系客户 · 客户的回答由专家采用', () => {
  const answered = record({
    answeredAt: '2026-10-29T03:00:00.000Z',
    answeredByName: '陈志刚',
    questions: [
      { id: 'q1', factKey: 'technicalManagementCount', label: '技术人员数', question: '有多少？', answer: '6 位：工程师 2、技术员 4' },
      { id: 'q2', label: '其他', question: '有没有夜班？', answer: '没有' },
    ],
  });

  it('回答了还没采用的企业事实进待采用；自定义问题不进', () => {
    const waiting = awaitingAdoption([answered], { overrides: {} });
    expect([...waiting.keys()]).toEqual(['technicalManagementCount']);
    expect(waiting.get('technicalManagementCount')).toEqual({ contactId: 'c1', answer: '6 位：工程师 2、技术员 4' });
  });

  it('采用以后不再提示，来源记为「客户确认 · 任务内补充」', () => {
    const data = {
      overrides: {
        technicalManagementCount: { value: 6, source: 'customer' as const, via: 'request' as const, contactId: 'c1', by: 'u', byName: '周工', at: '' },
      },
    };
    expect(awaitingAdoption([answered], data).size).toBe(0);
    const fact = workupFacts(feiyuSnapshot, data).find((f) => f.key === 'technicalManagementCount')!;
    expect([fact.source, fact.sourceNote, fact.status]).toEqual(['customer', '任务内补充', 'done']);
  });

  it('还没回答的请求不进待采用', () => {
    expect(awaitingAdoption([record({ questions: answered.questions.map((q) => ({ ...q, answer: undefined })) })], { overrides: {} }).size).toBe(0);
  });
});
