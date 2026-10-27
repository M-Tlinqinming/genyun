import { App, Button, Input, Modal, Select, Table } from 'antd';
import { useState } from 'react';
import {
  selectTaskDocuments,
  useEnterpriseDocuments,
  type EnterpriseDocument,
  type TaskDocument,
} from '../../api/documents';
import type { Task } from '../../api/tasks';
import { gy } from '../../theme/tokens';

// 从企业资料中选用并确认版本（12 页 P03B）。默认勾上任务已关联的资料、用任务当前的版本；
// 有新版本时需要客户明确改选，不会自动替换。确认前不改变任务资料
export function LibraryPickerModal({
  task,
  linked,
  open,
  onClose,
  onSaved,
  onUploadLocal,
}: {
  task: Task;
  linked: TaskDocument[];
  open: boolean;
  onClose: () => void;
  onSaved: (list: TaskDocument[]) => void;
  onUploadLocal: () => void;
}) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} destroyOnHidden title="从企业资料中选用">
      <PickerBody task={task} linked={linked} onClose={onClose} onSaved={onSaved} onUploadLocal={onUploadLocal} />
    </Modal>
  );
}

function PickerBody({
  task,
  linked,
  onClose,
  onSaved,
  onUploadLocal,
}: {
  task: Task;
  linked: TaskDocument[];
  onClose: () => void;
  onSaved: (list: TaskDocument[]) => void;
  onUploadLocal: () => void;
}) {
  const library = useEnterpriseDocuments(task.enterpriseId);
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [saving, setSaving] = useState(false);
  // documentId → 选中的 versionId
  const [chosen, setChosen] = useState<Map<string, string>>(
    () => new Map(linked.map((d) => [d.documentId, d.versionId])),
  );

  const docs = library.data ?? [];
  const shown = docs.filter((d) => d.name.includes(keyword.trim()));
  const linkedOf = (id: string) => linked.find((l) => l.documentId === id);

  const summary = (() => {
    const added = [...chosen.keys()].filter((id) => !linkedOf(id)).length;
    const removed = linked.filter((l) => !chosen.has(l.documentId)).length;
    const changed = linked.filter((l) => chosen.has(l.documentId) && chosen.get(l.documentId) !== l.versionId).length;
    const parts = [added && `新增 ${added} 份`, changed && `改版本 ${changed} 份`, removed && `取消关联 ${removed} 份`].filter(
      Boolean,
    );
    return `已选择 ${chosen.size} 份，${parts.length > 0 ? `确认后${parts.join('、')}` : '与当前关联一致'}。`;
  })();

  const toggle = (d: EnterpriseDocument, on: boolean) =>
    setChosen((m) => {
      const next = new Map(m);
      if (on) next.set(d.id, linkedOf(d.id)?.versionId ?? d.latest.versionId);
      else next.delete(d.id);
      return next;
    });

  const confirm = async () => {
    setSaving(true);
    try {
      const selections = [...chosen].map(([documentId, versionId]) => ({ documentId, versionId }));
      onSaved(await selectTaskDocuments(task.id, { selections }));
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
        {task.enterpriseName} · {task.number}
        <br />
        选用明确的文件版本。确认前不会改变当前任务资料。
      </p>
      <Input
        allowClear
        aria-label="搜索文件名称"
        placeholder="输入关键词"
        onChange={(e) => setKeyword(e.target.value)}
      />
      <Table<EnterpriseDocument>
        rowKey="id"
        size="middle"
        loading={library.isPending}
        dataSource={shown}
        pagination={false}
        scroll={{ y: 320 }}
        locale={{ emptyText: docs.length === 0 ? '企业资料库还没有文件' : '没有符合条件的文件' }}
        rowSelection={{
          selectedRowKeys: [...chosen.keys()],
          onSelect: (d, on) => toggle(d, on),
          onSelectAll: (on, _rows, changed) => changed.forEach((d) => toggle(d, on)),
          getCheckboxProps: (d) => ({ 'aria-label': `选用${d.name}` }),
        }}
        columns={[
          { title: '文件', dataIndex: 'name' },
          {
            title: '版本',
            width: 190,
            render: (_, d) => {
              const current = linkedOf(d.id);
              // 任务在用旧版本时，可在旧版本与最新版本之间明确选择
              if (current && current.versionId !== d.latest.versionId) {
                return (
                  <Select
                    size="small"
                    aria-label={`${d.name}的版本`}
                    style={{ width: 170 }}
                    disabled={!chosen.has(d.id)}
                    value={chosen.get(d.id) ?? current.versionId}
                    onChange={(v) => setChosen((m) => new Map(m).set(d.id, v))}
                    options={[
                      { value: current.versionId, label: `V${current.version}（任务在用）` },
                      { value: d.latest.versionId, label: `V${d.latest.version}（最新）` },
                    ]}
                  />
                );
              }
              return `V${d.latest.version}`;
            },
          },
          {
            title: '当前任务',
            width: 110,
            render: (_, d) => (
              <span style={{ color: linkedOf(d.id) ? gy.text : gy.tertiary }}>{linkedOf(d.id) ? '已关联' : '未关联'}</span>
            ),
          },
        ]}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
        <span role="status">{summary}</span>
        <span>确认后仅更新本任务的关联；取消保留原选择。移除关联不会删除企业资料库原件。</span>
        <Button
          type="link"
          style={{ alignSelf: 'flex-start', padding: 0, height: 'auto' }}
          onClick={() => {
            onClose();
            onUploadLocal();
          }}
        >
          找不到所需资料？从本地上传
        </Button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 16, borderTop: `1px solid ${gy.split}` }}>
        <Button size="large" onClick={onClose}>
          取消
        </Button>
        <Button size="large" type="primary" loading={saving} onClick={() => void confirm()}>
          确认选用版本
        </Button>
      </div>
    </div>
  );
}
