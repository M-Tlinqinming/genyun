// SVG 转 PNG：体系图、流程图在网页和 Word 里用同一张图。不需要浏览器。
// 中文靠系统字体；服务器镜像里要装中文字体。
import { Resvg } from '@resvg/resvg-js';

/** 按 2 倍分辨率输出，打印清晰；返回的宽高是原尺寸，用来在 Word 里按比例排版 */
export function svgToPng(svg: string): { png: Uint8Array; width: number; height: number } {
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, background: '#FFFFFF', font: { loadSystemFonts: true } });
  const image = resvg.render();
  return { png: image.asPng(), width: image.width / 2, height: image.height / 2 };
}
