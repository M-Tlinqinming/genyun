import type { RecognizedLicense } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { canEditOrganizationData } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { files } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { LICENSE_RECOGNIZER, type LicenseRecognizer } from './recognizer.ts';

export const LICENSE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const CACHE_SIZE = 500;

export type RecognitionStatus = 'recognized' | 'unrecognized' | 'unavailable' | 'failed';

// 读营业执照：找到本组织上传的文件并识别。同一份文件只识别一次（新建企业时先识别填表，
// 建档后挂到企业上不再重复调用识别服务，接入收费的识别服务后不会重复计费）
@Injectable()
export class LicenseReader {
  private readonly cache = new Map<string, RecognizedLicense>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Optional() @Inject(LICENSE_RECOGNIZER) private readonly recognizer: LicenseRecognizer | null,
  ) {}

  get available(): boolean {
    return Boolean(this.recognizer);
  }

  async read(orgId: string, fileId: string): Promise<{ status: RecognitionStatus; recognized: RecognizedLicense }> {
    const [file] = await this.db
      .select({ id: files.id, storageKey: files.storageKey, contentType: files.contentType })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.orgId, orgId), eq(files.kind, 'customer_material')))
      .limit(1);
    if (!file) throw new NotFoundException('找不到该文件');
    if (!LICENSE_TYPES.includes(file.contentType)) throw new BadRequestException('营业执照请上传 JPG、PNG 图片或 PDF');
    if (!this.recognizer) return { status: 'unavailable', recognized: {} };

    const cached = this.cache.get(file.id);
    if (cached) return { status: 'recognized', recognized: cached };
    try {
      const recognized = await this.recognizer.recognize(await this.storage.read(file.storageKey), file.contentType);
      if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(file.id, recognized);
      return { status: 'recognized', recognized };
    } catch (err) {
      console.warn('营业执照识别失败', err);
      return { status: 'failed', recognized: {} };
    }
  }
}

const fileIdSchema = z.object({ fileId: z.uuid('请选择文件') });

// 新建企业（12 页 P01）时先识别营业执照、填进表单；这里只识别，不保存任何内容
@Controller('orgs/:orgId/license-recognition')
export class LicenseRecognitionController {
  constructor(@Inject(LicenseReader) private readonly reader: LicenseReader) {}

  @Post()
  async recognize(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: unknown) {
    if (!canEditOrganizationData(user, orgId)) throw new ForbiddenException('只有客户可以上传营业执照');
    const parsed = fileIdSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择文件');
    return this.reader.read(orgId, parsed.data.fileId);
  }
}
