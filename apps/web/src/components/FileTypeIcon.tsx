import { FileExcelOutlined, FileImageOutlined, FileOutlined, FilePdfOutlined, FileWordOutlined } from '@ant-design/icons';
import { fileType, gy, source } from '../theme/tokens';

// 文件类型图标（Ant Design 自带图标），按上传时识别的文件格式区分；颜色沿用各类文件常见的识别色
const TYPES = [
  { match: /pdf/, Icon: FilePdfOutlined, color: fileType.pdf, label: 'PDF' },
  { match: /word|msword/, Icon: FileWordOutlined, color: gy.primary, label: 'Word' },
  { match: /sheet|excel/, Icon: FileExcelOutlined, color: gy.success, label: 'Excel' },
  { match: /^image\//, Icon: FileImageOutlined, color: source.expert.color, label: '图片' },
];

export function FileTypeIcon({ contentType }: { contentType: string }) {
  const t = TYPES.find((x) => x.match.test(contentType));
  const Icon = t?.Icon ?? FileOutlined;
  return <Icon aria-label={t?.label ?? '文件'} style={{ fontSize: 20, color: t?.color ?? gy.tertiary, flexShrink: 0 }} />;
}
