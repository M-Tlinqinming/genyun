// 草稿生成队列（M2 第 10 项）。正式与预览环境配 REDIS_URL 用 BullMQ，服务重启后没跑完的任务还在；
// 本机开发和测试没有 Redis，用进程内队列，接口相同。三份草稿各是一个任务，一次只跑一个（转 PDF 很占资源）。
import type { DraftKind } from '@genyun/shared';
import { Queue, Worker } from 'bullmq';

export interface DraftJob {
  batchId: string;
  kind: DraftKind;
}

export type DraftHandler = (job: DraftJob) => Promise<void>;

export interface DraftQueue {
  // 重启后队列里还在的任务（BullMQ）会继续跑；进程内队列重启即丢，由调用方把中断的标为失败
  readonly durable: boolean;
  add(job: DraftJob): Promise<void>;
  start(handler: DraftHandler): void;
  // 测试用：等队列里的任务都跑完
  idle(): Promise<void>;
  close(): Promise<void>;
}

export const DRAFT_QUEUE = Symbol('DRAFT_QUEUE');

export class InProcessQueue implements DraftQueue {
  readonly durable = false;
  private handler: DraftHandler | null = null;
  private pending: DraftJob[] = [];
  private running: Promise<void> = Promise.resolve();

  async add(job: DraftJob): Promise<void> {
    this.pending.push(job);
    this.drain();
  }

  start(handler: DraftHandler): void {
    this.handler = handler;
    this.drain();
  }

  idle(): Promise<void> {
    return this.running;
  }

  async close(): Promise<void> {
    this.handler = null;
    await this.running;
  }

  private drain() {
    const handler = this.handler;
    if (!handler) return;
    this.running = this.running.then(async () => {
      for (let job = this.pending.shift(); job && this.handler; job = this.pending.shift()) {
        // 出错由 handler 自己记到草稿上，这里不让一份的失败挡住后面的
        await handler(job).catch((err) => console.error('草稿生成出错', job, err));
      }
    });
  }
}

const QUEUE_NAME = 'draft-generation';

export class BullQueue implements DraftQueue {
  readonly durable = true;
  private readonly queue: Queue<DraftJob>;
  private worker: Worker<DraftJob> | null = null;
  private readonly connection: { url: string };

  constructor(url: string) {
    this.connection = { url };
    this.queue = new Queue<DraftJob>(QUEUE_NAME, { connection: this.connection });
  }

  async add(job: DraftJob): Promise<void> {
    // 重试由我们按草稿状态重新排队，这里不让 BullMQ 自己再试
    await this.queue.add(job.kind, job, { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
  }

  start(handler: DraftHandler): void {
    this.worker = new Worker<DraftJob>(QUEUE_NAME, (job) => handler(job.data), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => console.error('草稿生成出错', job?.data, err));
  }

  async idle(): Promise<void> {
    const left = async () => Object.values(await this.queue.getJobCounts('waiting', 'active', 'delayed')).reduce((a, b) => a + b, 0);
    while ((await left()) > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

export function defaultQueue(): DraftQueue {
  const url = process.env.REDIS_URL?.trim();
  if (url) return new BullQueue(url);
  if (process.env.NODE_ENV === 'production') throw new Error('正式环境需要配置 REDIS_URL（草稿生成队列）');
  return new InProcessQueue();
}
