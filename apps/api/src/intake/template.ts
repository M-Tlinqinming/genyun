// 资料模板文件（客户在任务页下载的那份）。Docker 镜像会把 apps/api/content 整个打包进去。
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PATH = fileURLToPath(new URL('../../content/intake/intake-template-2026.11.xlsx', import.meta.url));
export const TEMPLATE_DOWNLOAD_NAME = '企业资料填报模板（2026.11）.xlsx';
