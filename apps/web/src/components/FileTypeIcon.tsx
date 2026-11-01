import { FileExcelOutlined, FileImageOutlined, FileOutlined, FilePdfOutlined, FileWordOutlined } from '@ant-design/icons';

// 文件类型图标（Ant Design 自带图标），按上传时识别的文件格式区分；颜色沿用各类文件常见的识别色
const TYPES = [
  { match: /pdf/, Icon: FilePdfOutlined, color: '#C2410C', label: 'PDF' },
  { match: /word|msword/, Icon: FileWordOutlined, color: '#245BDB', label: 'Word' },
  { match: /sheet|excel/, Icon: FileExcelOutlined, color: '#237B4B', label: 'Excel' },
  { match: /^image\//, Icon: FileImageOutlined, color: '#5B4BB7', label: '图片' },
];

export function FileTypeIcon({ contentType }: { contentType: string }) {
  const t = TYPES.find((x) => x.match.test(contentType));
  const Icon = t?.Icon ?? FileOutlined;
  return <Icon aria-label={t?.label ?? '文件'} style={{ fontSize: 20, color: t?.color ?? '#6B7484', flexShrink: 0 }} />;
}
