import { CheckOutlined, InfoCircleFilled, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import type { CustomerSupplement } from '@genyun/shared';
import { App, Button, Checkbox, Input, Upload } from 'antd';
import { useState, type CSSProperties } from 'react';
import { openFile } from '../../../api/documents';
import { uploadFile } from '../../../api/profile';
import { ApiError } from '../../../api/request';
import { useCustomerSupplements, useRespondSupplement } from '../../../api/supplements';
import type { Task } from '../../../api/tasks';
import { panel } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';

const h2: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text };
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };

// 客户回应事实补件（15 页 R00a）：专家请客户确认企业事实，客户提交文件或说明并勾选确认。
// 提交后由专家核实、明确采用后才改本任务用的企业事实
export function SupplementCard({ task }: { task: Task }) {
  const list = useCustomerSupplements(task.id);
  const rounds = list.data ?? [];
  const open = rounds.find((s) => s.status === 'awaiting_customer');
  const submitted = rounds.filter((s) => s.response);
  if (!open && submitted.length === 0) return null;
  return (
    <>
      {open && <OpenSupplement key={open.id} task={task} supplement={open} />}
      {submitted.length > 0 && (
        <section aria-label="已提交的事实补件" style={{ ...panel, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={h2}>已提交的事实补件</h2>
          {submitted.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 12, ...text14 }}>
              <CheckOutlined aria-hidden style={{ color: gy.success, fontSize: 12, marginTop: 5 }} />
              <span style={{ flex: 1, minWidth: 0, color: gy.text }}>
                第 {s.round} 轮 · {s.title}
                <span style={{ color: gy.secondary }}>
                  {'　'}
                  {s.status === 'adopted' ? '耕云已核实' : s.status === 'returned' ? '耕云还需要您补充，请看新一轮' : '等待耕云核实'}
                </span>
                {s.files.map((f) => (
                  <FileLink key={f.id} id={f.id} name={f.name} />
                ))}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function FileLink({ id, name }: { id: string; name: string }) {
  return (
    <button
      type="button"
      onClick={() => void openFile(id)}
      style={{ marginLeft: 8, padding: 0, border: 'none', background: 'none', color: gy.primary, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}
    >
      <PaperClipOutlined /> {name}
    </button>
  );
}

function OpenSupplement({ task, supplement: s }: { task: Task; supplement: CustomerSupplement }) {
  const { message } = App.useApp();
  const respond = useRespondSupplement(task.id);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const id = await uploadFile(task.orgId, file, 'material');
      setFiles((list) => [...list, { id, name: file.name }]);
      setError(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (s.needsFile && files.length === 0) return setError('请提供补充文件');
    if (files.length === 0 && !note.trim()) return setError('请上传文件或写补充说明');
    if (!confirmed) return setError('请勾选确认');
    setError(null);
    try {
      await respond.mutateAsync({ id: s.id, fileIds: files.map((f) => f.id), note: note.trim() || undefined, confirmed: true });
      message.success(`已提交，${s.createdByName}会尽快核实`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请检查网络后重试');
    }
  };

  return (
    <>
      <section
        aria-label="请确认企业事实"
        style={{ display: 'flex', gap: 12, padding: '20px 24px', borderRadius: 8, background: gy.selected, border: `1px solid ${gy.primary}` }}
      >
        <InfoCircleFilled aria-hidden style={{ color: gy.primary, fontSize: 20, marginTop: 2 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ ...h2, fontWeight: 400 }}>{s.title}</h2>
          <span style={{ ...text14, color: gy.text }}>{s.message}</span>
        </div>
      </section>
      <section aria-label="本次需要您提供" style={{ ...panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={h2}>本次需要您提供</h2>
            <span style={{ ...text14, color: gy.secondary }}>
              需要确认：{s.labels.join('、')}。其他已齐全资料无需再次提交。
            </span>
          </div>
          <span style={{ padding: '1px 8px', borderRadius: 4, fontSize: 13, lineHeight: '22px', color: stage.action.color, background: stage.action.bg }}>
            待您回应
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...text14, color: gy.text }}>
            {s.needsFile && <span style={{ color: gy.error }}>* </span>}
            补充文件{s.needsFile ? '' : '（选填）'}
          </span>
          {files.map((f) => (
            <div
              key={f.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 6, border: `1px solid ${gy.split}`, background: gy.canvas }}
            >
              <PaperClipOutlined aria-hidden style={{ color: gy.primary }} />
              <span style={{ flex: 1, minWidth: 0, ...text14, color: gy.text }}>{f.name}</span>
              <button
                type="button"
                aria-label={`移除${f.name}`}
                onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                style={{ padding: 0, border: 'none', background: 'none', color: gy.secondary, cursor: 'pointer', fontSize: 13 }}
              >
                移除
              </button>
            </div>
          ))}
          <div>
            <Upload
              showUploadList={false}
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
              beforeUpload={(file) => {
                void upload(file);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading} disabled={files.length >= 5}>
                上传补充文件
              </Button>
            </Upload>
          </div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...text14, color: gy.text }}>补充说明（选填）</span>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：应急联系人已调整为谁、联系方式是多少"
          />
        </label>
        <Checkbox
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked);
            if (e.target.checked && error === '请勾选确认') setError(null);
          }}
        >
          我已核对上述资料，确认其反映企业当前实际情况。
        </Checkbox>
        {error && (
          <span role="alert" style={{ ...text14, color: gy.error }}>
            {error}
          </span>
        )}
        <div>
          <Button type="primary" size="large" onClick={() => void submit()} loading={respond.isPending} disabled={uploading}>
            提交本轮补充
          </Button>
        </div>
      </section>
    </>
  );
}
