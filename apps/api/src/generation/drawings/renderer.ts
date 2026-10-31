// 客户图纸转图片：一个工作线程，一次只转一页（转一页占几百 MB 内存）；超时就换一个线程。
import { Worker } from 'node:worker_threads';
import type { RenderedPage, RenderRequest, RenderResponse } from './render-worker.ts';

export type { RenderedPage };

// 放进 Word 的图长边像素：横版 A4 版心约 25 厘米，约 240 dpi
export const FULL_SIDE = 2400;
// 图件页缩略图长边
export const THUMB_SIDE = 480;
// 测试集最重的一页（捷美奇疏散图，61 万条线）本机约 30 秒
const TIMEOUT_MS = 3 * 60_000;

// 去掉 id 后仍按 op 区分两种请求
type Request = RenderRequest extends infer R ? (R extends RenderRequest ? Omit<R, 'id'> : never) : never;
type Job = { req: Request; resolve: (r: RenderResponse) => void; reject: (e: Error) => void };

export class DrawingRenderer {
  private worker: Worker | null = null;
  private readonly jobs: Job[] = [];
  private busy = false;
  private seq = 0;

  constructor(private readonly timeoutMs = TIMEOUT_MS) {}

  async count(data: Uint8Array, contentType: string): Promise<number> {
    const res = await this.run({ op: 'count', data, contentType });
    if (!res.ok) throw new Error(res.error);
    return (res as { pageCount: number }).pageCount;
  }

  async render(data: Uint8Array, contentType: string, page: number): Promise<RenderedPage> {
    const res = await this.run({ op: 'render', data, contentType, page, fullSide: FULL_SIDE, thumbSide: THUMB_SIDE });
    if (!res.ok) throw new Error(res.error);
    return (res as { page: RenderedPage }).page;
  }

  async close() {
    const w = this.worker;
    this.worker = null;
    await w?.terminate();
  }

  private run(req: Request): Promise<RenderResponse> {
    return new Promise((resolve, reject) => {
      this.jobs.push({ req, resolve, reject });
      void this.next();
    });
  }

  private spawn(): Worker {
    // 编译后是 .js；开发和测试直接跑 .ts（Node 24 自带去类型）
    const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    const w = new Worker(new URL(`./render-worker${ext}`, import.meta.url));
    // 没有活儿时不拖住进程退出
    w.unref();
    return w;
  }

  private async next() {
    if (this.busy) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.busy = true;
    const worker = (this.worker ??= this.spawn());
    const id = ++this.seq;
    try {
      job.resolve(
        await new Promise<RenderResponse>((resolve, reject) => {
          const done = () => {
            clearTimeout(timer);
            worker.off('message', onMessage);
            worker.off('error', onError);
            worker.off('exit', onExit);
          };
          const onMessage = (res: RenderResponse) => {
            if (res.id !== id) return;
            done();
            resolve(res);
          };
          const onError = (err: Error) => {
            done();
            reject(err);
          };
          const onExit = () => {
            done();
            reject(new Error('转换图纸的线程意外退出'));
          };
          const timer = setTimeout(() => {
            done();
            reject(new Error('图纸太复杂，转换超时'));
          }, this.timeoutMs);
          worker.on('message', onMessage);
          worker.once('error', onError);
          worker.once('exit', onExit);
          worker.postMessage({ ...job.req, id });
        }),
      );
    } catch (err) {
      // 超时或线程出错：丢掉这个线程，下一页用新的
      if (this.worker === worker) this.worker = null;
      void worker.terminate();
      job.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.busy = false;
      void this.next();
    }
  }
}
