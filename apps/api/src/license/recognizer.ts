import type { RecognizedLicense } from '@genyun/shared';

// 营业执照文字识别。具体用哪家服务（如阿里云文字识别）待定，接入时只需新写一个实现，
// 并在 defaultRecognizer 里按环境变量选用；业务代码不变。
export interface LicenseRecognizer {
  // 认不出（不是营业执照、太模糊）时返回空对象；服务本身出错时抛异常
  recognize(data: Buffer, contentType: string): Promise<RecognizedLicense>;
}

export const LICENSE_RECOGNIZER = Symbol('LICENSE_RECOGNIZER');

/**
 * 开发与自动测试用的模拟识别：不看图片内容，总是返回飞宇样例。
 * 只在明确设置 LICENSE_OCR=fake 时启用，正式环境拒绝启用，避免把假数据填进客户资料。
 */
export class FakeLicenseRecognizer implements LicenseRecognizer {
  async recognize(): Promise<RecognizedLicense> {
    return {
      name: '惠阳飞宇电器有限公司',
      socialCreditCode: '91441303MA4W12345X',
      legalRepresentative: '李文聪',
      registeredAddress: '惠州市惠阳区淡水街道金惠大道 18 号',
      companyType: '有限责任公司（自然人投资或控股）',
      registeredCapital: '1000 万元',
      registrationAuthority: '惠州市惠阳区市场监督管理局',
      businessScope: '生产、销售：电热水壶、电饭煲及其配件；货物进出口。',
    };
  }
}

// 没配置识别服务时为 null：页面提示「暂时无法自动识别，请手动填写」
export function defaultRecognizer(): LicenseRecognizer | null {
  const kind = process.env.LICENSE_OCR;
  if (!kind) return null;
  if (kind === 'fake') {
    if (process.env.NODE_ENV === 'production') throw new Error('正式环境不能使用模拟的营业执照识别');
    return new FakeLicenseRecognizer();
  }
  throw new Error(`未知的营业执照识别服务 LICENSE_OCR=${kind}`);
}
