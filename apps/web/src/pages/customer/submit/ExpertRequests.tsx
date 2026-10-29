import { CheckOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import { App, Button, Input, Upload } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useAnswerRequest, useCustomerRequests, type CustomerRequest } from '../../../api/contacts';
import { openFile } from '../../../api/documents';
import { uploadFile } from '../../../api/profile';
import { ApiError } from '../../../api/request';
import type { Task } from '../../../api/tasks';
import { panel } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';

const h2: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text };

// 还在等客户回答的补充请求有几条（阶段条「待补 N 项」用）
export function useOpenRequests(taskId: string) {
  const requests = useCustomerRequests(taskId);
  return (requests.data ?? []).filter((r) => !r.answeredAt);
}

// 专家在任务里请客户补充的问题（14 页 E18-00E「请客户在任务里补充」；样式参照 15 页 R00a）
export function ExpertRequests({ task }: { task: Task }) {
  const requests = useCustomerRequests(task.id);
  if (!requests.data || requests.data.length === 0) return null;
  const open = requests.data.filter((r) => !r.answeredAt);
  const answered = requests.data.filter((r) => r.answeredAt);
  return (
    <>
      {open.map((r) => (
        <OpenRequest key={r.id} task={task} request={r} />
      ))}
      {answered.length > 0 && (
        <section aria-label="已回答的补充请求" style={{ ...panel, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={h2}>已回答专家的问题</h2>
          {answered.map((r) => (
            <ul key={r.id} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {r.questions.map((q) => (
                <li key={q.id} style={{ display: 'flex', gap: 12, fontSize: 14, lineHeight: '22px' }}>
                  <CheckOutlined aria-hidden style={{ color: gy.success, fontSize: 12, marginTop: 5 }} />
                  <span style={{ width: 120, flexShrink: 0, color: gy.secondary }}>{q.label}</span>
                  <span style={{ flex: 1, minWidth: 0, color: gy.text }}>
                    {q.answer}
                    {q.fileIds?.map((id) => (
                      <FileLink key={id} id={id} name={r.files.find((f) => f.id === id)?.name ?? '附件'} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
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

interface Draft {
  text: string;
  files: { id: string; name: string }[];
}

function OpenRequest({ task, request }: { task: Task; request: CustomerRequest }) {
  const { message } = App.useApp();
  const answer = useAnswerRequest(task.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const draftOf = (id: string): Draft => drafts[id] ?? { text: '', files: [] };
  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...draftOf(id), ...patch } }));
  const missing = request.questions.find((q) => !draftOf(q.id).text.trim() && draftOf(q.id).files.length === 0);

  const upload = async (questionId: string, file: File) => {
    setUploading(questionId);
    try {
      const id = await uploadFile(task.orgId, file, 'material');
      set(questionId, { files: [...draftOf(questionId).files, { id, name: file.name }] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    if (missing) return;
    try {
      await answer.mutateAsync({
        contactId: request.id,
        answers: request.questions.map((q) => ({
          questionId: q.id,
          text: draftOf(q.id).text.trim() || undefined,
          fileIds: draftOf(q.id).files.map((f) => f.id),
        })),
      });
      message.success(`已提交，${request.createdByName}会尽快核实`);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '提交失败，请检查网络后重试');
    }
  };

  return (
    <section aria-label="专家想向您确认" style={{ ...panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={h2}>专家想向您确认 {request.questions.length} 项</h2>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
            负责专家{request.createdByName}整理资料时需要以下信息。写文字或上传文件都可以，其他已齐全的资料无需再次提交。
          </span>
        </div>
        <span style={{ padding: '1px 8px', borderRadius: 4, fontSize: 13, lineHeight: '22px', color: stage.action.color, background: stage.action.bg }}>
          待您回应
        </span>
      </div>
      {request.questions.map((q, i) => {
        const d = draftOf(q.id);
        return (
          <div key={q.id} data-testid={`request-question-${q.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>
              <span style={{ color: gy.error }}>* </span>
              {i + 1}. {q.label}
            </span>
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{q.question}</span>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={500}
              value={d.text}
              placeholder="请写下实际情况"
              aria-label={`回答：${q.label}`}
              onChange={(e) => set(q.id, { text: e.target.value })}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {d.files.map((f) => (
                <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 4, background: gy.neutralBg, fontSize: 13 }}>
                  <PaperClipOutlined /> {f.name}
                  <button
                    type="button"
                    aria-label={`移除${f.name}`}
                    onClick={() => set(q.id, { files: d.files.filter((x) => x.id !== f.id) })}
                    style={{ padding: 0, border: 'none', background: 'none', color: gy.tertiary, cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <Upload
                showUploadList={false}
                accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                beforeUpload={(file) => {
                  void upload(q.id, file);
                  return false;
                }}
              >
                <Button size="small" icon={<UploadOutlined />} loading={uploading === q.id}>
                  上传文件（可选）
                </Button>
              </Upload>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Button type="primary" size="large" onClick={submit} loading={answer.isPending} disabled={!!missing || uploading !== null}>
          提交回答
        </Button>
        {missing && <span style={{ fontSize: 13, color: gy.tertiary }}>请回答「{missing.label}」，写文字或上传文件都可以</span>}
      </div>
    </section>
  );
}
