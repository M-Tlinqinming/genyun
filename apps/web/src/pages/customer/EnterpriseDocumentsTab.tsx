import { CATEGORIES, documentCategoryLabel, TASK_STATUSES, uploadRuleHint, type Category } from '@genyun/shared';
import { UploadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Input, Select, Table, Upload } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  addDocumentVersion,
  documentDetailKey,
  enterpriseDocumentsKey,
  formatSize,
  openFile,
  shortDateTime,
  uploadEnterpriseDocument,
  useDocumentDetail,
  useEnterpriseDocuments,
  type DocumentDetail,
  type EnterpriseDocument,
} from '../../api/documents';
import { uploadFile } from '../../api/profile';
import { ApiError } from '../../api/request';
import { FileTypeIcon } from '../../components/FileTypeIcon';
import { gy } from '../../theme/tokens';
import { Loading, panel } from '../../components/ui';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';
const PENDING = 'pending';

// 上传了新版本、但还有任务在用旧版本时的提示
interface NewVersionNotice {
  name: string;
  version: number;
  tasks: { taskId: string; number: string }[];
}

// C03 企业详情 · 企业资料：企业原始资料与版本，可在编制任务中重复选用（11 页）
export function EnterpriseDocumentsTab({ enterpriseId, orgId }: { enterpriseId: string; orgId: string }) {
  const docs = useEnterpriseDocuments(enterpriseId);
  const client = useQueryClient();
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<Category | typeof PENDING | 'all'>('all');
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NewVersionNotice | null>(null);

  const upload = async (files: File[]) => {
    setUploading(true);
    let failed = 0;
    for (const file of files) {
      try {
        const fileId = await uploadFile(orgId, file, 'material');
        client.setQueryData(enterpriseDocumentsKey(enterpriseId), await uploadEnterpriseDocument(enterpriseId, fileId));
      } catch (err) {
        failed++;
        message.error(err instanceof ApiError ? err.message : `${file.name} 上传时连接中断，请重试`);
      }
    }
    setUploading(false);
    if (failed < files.length) message.success('已保存到企业资料');
  };

  const all = docs.data ?? [];
  const shown = all.filter(
    (d) =>
      d.name.includes(keyword.trim()) &&
      (category === 'all' || (category === PENDING ? d.category === null : d.category === category)),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px' }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 500, color: gy.text }}>资料库</h2>
          <span style={{ flex: 1, fontSize: 14, color: gy.secondary }}>{all.length} 份文件</span>
          <Input.Search
            allowClear
            placeholder="搜索文件名称"
            aria-label="搜索文件名称"
            style={{ width: 230 }}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            aria-label="资料分类"
            style={{ width: 184 }}
            value={category}
            onChange={setCategory}
            options={[
              { value: 'all', label: '全部分类' },
              ...(Object.keys(CATEGORIES) as Category[]).map((c) => ({ value: c, label: CATEGORIES[c] })),
              { value: PENDING, label: '待整理' },
            ]}
          />
          <Upload
            accept={ACCEPT}
            multiple
            showUploadList={false}
            disabled={uploading}
            beforeUpload={(file, list) => {
              if (file === list[0]) void upload(list);
              return false;
            }}
          >
            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
              上传企业资料
            </Button>
          </Upload>
        </div>
        <Table<EnterpriseDocument>
          rowKey="id"
          loading={docs.isPending}
          dataSource={shown}
          pagination={false}
          locale={{ emptyText: all.length === 0 ? '还没有企业资料。上传的资料可在以后的编制任务中直接选用' : '没有符合条件的文件' }}
          columns={[
            {
              title: '文件名称',
              render: (_, d) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <FileTypeIcon contentType={d.latest.contentType} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{d.name}</span>
                    <span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>
                      {formatSize(d.latest.sizeBytes)} · 原始资料
                    </span>
                  </div>
                </div>
              ),
            },
            {
              title: '资料分类',
              width: 200,
              render: (_, d) => (
                <span style={{ color: d.category ? gy.text : gy.tertiary }}>{documentCategoryLabel(d.category)}</span>
              ),
            },
            {
              title: '当前版本',
              width: 100,
              render: (_, d) => <VersionTag version={d.latest.version} />,
            },
            { title: '更新时间', width: 150, render: (_, d) => shortDateTime(d.updatedAt) },
            {
              title: '操作',
              width: 200,
              render: (_, d) => (
                <span style={{ display: 'flex', gap: 24 }}>
                  <Button
                    type="link"
                    style={{ padding: 0 }}
                    aria-label={`预览${d.name}`}
                    onClick={() => openFile(d.latest.fileId).catch((err: Error) => message.error(err.message))}
                  >
                    预览
                  </Button>
                  <Button type="link" style={{ padding: 0 }} aria-label={`${d.name}的版本与使用记录`} onClick={() => setOpenId(d.id)}>
                    版本与使用记录
                  </Button>
                </span>
              ),
            },
          ]}
        />
        <div style={{ padding: '14px 24px', borderTop: `1px solid ${gy.split}`, fontSize: 13, color: gy.secondary }}>
          显示当前文件版本；历史版本和任务使用记录保留在各文件中。
          <span style={{ marginLeft: 16, color: gy.tertiary }}>{uploadRuleHint('material')}</span>
        </div>
      </section>

      {notice && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setNotice(null)}
          title="新版本已保存，任务里仍用原来的版本"
          description={
            <span>
              {notice.name}已更新至 V{notice.version}。如需用于当前编制，请到任务里「从企业资料中选择」改选新版本；已提交的任务保留原提交版本。
              {notice.tasks.map((t) => (
                <Link key={t.taskId} to={`/customer/tasks/${t.taskId}`} style={{ marginLeft: 12 }}>
                  前往 {t.number}
                </Link>
              ))}
            </span>
          }
        />
      )}

      <VersionsDrawer
        enterpriseId={enterpriseId}
        orgId={orgId}
        documentId={openId}
        onClose={() => setOpenId(null)}
        onNewVersion={(detail) => {
          const top = detail.versions[0]!;
          const older = detail.versions.slice(1).flatMap((v) => v.tasks.filter((t) => t.status === 'preparing'));
          setNotice(older.length > 0 ? { name: detail.name, version: top.version, tasks: older } : null);
        }}
      />
    </div>
  );
}

function VersionTag({ version }: { version: number }) {
  return (
    <span
      style={{
        padding: '1px 8px',
        borderRadius: 4,
        border: `1px solid ${gy.split}`,
        background: gy.canvas,
        fontSize: 12,
        lineHeight: '20px',
        color: gy.text,
      }}
    >
      V{version}
    </span>
  );
}

// 版本与使用记录：每个版本、哪些任务在用；上传新版本不替换任务里用的版本
function VersionsDrawer({
  enterpriseId,
  orgId,
  documentId,
  onClose,
  onNewVersion,
}: {
  enterpriseId: string;
  orgId: string;
  documentId: string | null;
  onClose: () => void;
  onNewVersion: (detail: DocumentDetail) => void;
}) {
  const detail = useDocumentDetail(enterpriseId, documentId);
  const client = useQueryClient();
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);

  const addVersion = async (file: File) => {
    if (!documentId) return;
    setUploading(true);
    try {
      const fileId = await uploadFile(orgId, file, 'material');
      const next = await addDocumentVersion(enterpriseId, documentId, fileId);
      client.setQueryData(documentDetailKey(enterpriseId, documentId), next);
      void client.invalidateQueries({ queryKey: enterpriseDocumentsKey(enterpriseId), exact: true });
      onNewVersion(next);
      message.success(`已保存为 V${next.versions[0]!.version}`);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '上传时连接中断，请重试');
    } finally {
      setUploading(false);
    }
  };

  const d = detail.data;
  return (
    <Drawer
      open={documentId !== null}
      onClose={onClose}
      size={520}
      title={d ? d.name : '版本与使用记录'}
      extra={
        <Upload
          accept={ACCEPT}
          showUploadList={false}
          disabled={uploading || !d}
          beforeUpload={(file) => {
            void addVersion(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading}>
            上传新版本
          </Button>
        </Upload>
      }
    >
      {!d ? (
        <Loading rows={6} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: '21px', color: gy.secondary }}>
            分类：{documentCategoryLabel(d.category)}。上传新版本后，正在进行的任务仍用原来的版本，需要时在任务里改选；已提交的任务保留原提交版本。
          </p>
          <ol aria-label="版本" style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
            {d.versions.map((v, i) => (
              <li
                key={v.versionId}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: 16,
                  borderRadius: 8,
                  border: `1px solid ${i === 0 ? '#C9D7F6' : gy.split}`,
                  background: i === 0 ? gy.selected : gy.surface,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <VersionTag version={v.version} />
                  {i === 0 && <span style={{ fontSize: 12, color: gy.primary }}>当前版本</span>}
                  <span style={{ flex: 1, fontSize: 12, color: gy.tertiary, textAlign: 'right' }}>
                    {shortDateTime(v.createdAt)} · {formatSize(v.sizeBytes)}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    aria-label={`预览 V${v.version}`}
                    onClick={() => openFile(v.fileId).catch((err: Error) => message.error(err.message))}
                  >
                    预览
                  </Button>
                </div>
                <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{v.originalName}</span>
                <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
                  {v.tasks.length === 0
                    ? '没有任务在用'
                    : `使用中：${v.tasks.map((t) => `${t.number} ${t.name}（${TASK_STATUSES[t.status]}）`).join('；')}`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Drawer>
  );
}
