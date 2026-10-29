// 第 2 项小样：Word 预览方式二选一。用飞宇样例生成应急预案，分别给出 .docx（浏览器直接渲染）和 PDF（后台转换）。
// 只在非正式环境注册；Martin 选定后删掉本文件，选中的方式接进第 12 项 Word 校对页。
import { Controller, Get, Res, ServiceUnavailableException } from '@nestjs/common';
import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import type { Response } from 'express';
import { FakeSlotDrafter } from './ai/drafter.ts';
import { generateDocuments } from './documents.ts';
import { convertToPdf } from './word/pdf.ts';
import { renderWord } from './word/render.ts';

let docx: Promise<Buffer> | undefined;
let pdf: Promise<{ bytes: Buffer; ms: number }> | undefined;

// 1.5 倍行距 Word 按仿宋四号算出来是 27.25 磅，LibreOffice 和浏览器算得矮一截，一百多页下来差十几页。
// 改成同样高度的固定行距，Word 里看起来不变，三种显示方式的分页就对得上。选定方式后再决定是否写进排版规范。
async function fixedLineHeight(bytes: Buffer): Promise<Buffer> {
  // jszip 只是开发依赖，用到时再加载，正式环境启动不受影响
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  zip.file('word/document.xml', xml.replaceAll('w:line="360"/>', 'w:line="545" w:lineRule="exact"/>'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function sampleDocx(): Promise<Buffer> {
  docx ??= generateDocuments(feiyuPlanInput, { drafter: new FakeSlotDrafter() })
    .then((d) => renderWord(d.plan))
    .then(fixedLineHeight);
  docx.catch(() => (docx = undefined));
  return docx;
}

function samplePdf() {
  pdf ??= sampleDocx().then(async (bytes) => {
    const start = Date.now();
    return { bytes: await convertToPdf(bytes), ms: Date.now() - start };
  });
  pdf.catch(() => (pdf = undefined));
  return pdf;
}

@Controller('preview-trial')
export class PreviewTrialController {
  @Get('plan.docx')
  async planDocx(@Res() res: Response) {
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(await sampleDocx());
  }

  @Get('plan.pdf')
  async planPdf(@Res() res: Response) {
    let result;
    try {
      result = await samplePdf();
    } catch (err) {
      console.warn('转 PDF 失败', err);
      throw new ServiceUnavailableException('本机没有可用的 LibreOffice，请在 apps/api/.env 设置 SOFFICE_PATH');
    }
    // 首次转换耗时给页面显示，用来估计正式环境的等待时间
    res.set('X-Convert-Ms', String(result.ms)).type('application/pdf').send(result.bytes);
  }
}
