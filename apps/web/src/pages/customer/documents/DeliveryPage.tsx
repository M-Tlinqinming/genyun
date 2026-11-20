import { DELIVERY_DOC_SUMMARY, type DeliveredVersion, type TaskDeliveries } from '@genyun/shared';
import { App, Button, Result } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { downloadBundle, downloadWord, useTaskDeliveries } from '../../../api/deliveries';
import { ContactLink } from '../../../components/ContactLink';
import { FeedbackModal } from '../../../components/FeedbackModal';
import { useWorkspace } from '../../../layouts/workspace';
import { Loading } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { card, stampFull, text14, textLink } from './shared';

// R05 交付详情｜一个任务最新一次交付的三份 Word：单份下载、整套下载；下方是反馈入口。
// 客户只看最新一次交付，不显示版本号
export function DeliveryPage() {
  const { taskId = '' } = useParams();
  const query = useTaskDeliveries(taskId);

  if (query.isPending) return <Loading rows={6} />;
  if (query.isError) return <Result status="404" title="找不到这份成果" subTitle={query.error.message} extra={<Link to="/customer/documents">返回成果文档</Link>} />;
  const data = query.data;
  const latest = data.versions[0];
  if (!latest) {
    return (
      <Result
        status="info"
        title="这项任务还没有交付成果"
        subTitle="专家审核并交付后，三份 Word 会出现在这里。"
        extra={<Link to={`/customer/tasks/${taskId}`}>查看任务进度</Link>}
      />
    );
  }
  return <Delivery data={data} current={latest} />;
}

function Delivery({ data, current }: { data: TaskDeliveries; current: DeliveredVersion }) {
  const { message } = App.useApp();
  const { orgId } = useWorkspace();
  const [bundling, setBundling] = useState(false);
  const state = current.version > 1 ? '已更新' : '已交付';
  const bundle = async () => {
    setBundling(true);
    try {
      await downloadBundle(data.taskId, current.version, data.enterpriseName);
    } catch (err) {
      message.error(`整套 Word 没能下载：${err instanceof Error ? err.message : '请稍后重试'}`);
    } finally {
      setBundling(false);
    }
  };
  const one = async (fileId: string, name: string) => {
    try {
      await downloadWord(fileId, name);
    } catch (err) {
      message.error(`没能下载：${err instanceof Error ? err.message : '请稍后重试'}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="位置" style={{ ...text14, color: gy.secondary }}>
          <Link to="/customer/documents" style={{ color: gy.secondary }}>
            成果文档
          </Link>{' '}
          / {data.enterpriseName}
        </nav>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '40px', fontWeight: 500, color: gy.text }}>{data.enterpriseName} · 编制成果</h1>
        <span style={{ ...text14, color: gy.text }}>
          {data.taskNumber} · {data.taskName} · {stampFull(current.publishedAt)} {state === '已更新' ? '更新' : '交付'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          padding: 24,
          borderRadius: 8,
          background: gy.successBg,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.success }}>三份文档{state}</span>
          <span style={{ ...text14, color: gy.text }}>专家已审核通过，可直接下载。</span>
        </div>
        <Button type="primary" size="large" loading={bundling} onClick={() => void bundle()} style={{ flexShrink: 0, padding: '10px 20px', height: 'auto' }}>
          下载整套 Word
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', padding: '12px 20px', borderBottom: `1px solid ${gy.split}`, ...text14, fontWeight: 500, color: gy.text }}>
          <span style={{ flex: 1, minWidth: 0 }}>交付文件</span>
          <span style={{ width: 200, flexShrink: 0 }}>交付时间</span>
          <span style={{ width: 340, flexShrink: 0 }}>操作</span>
        </div>
        {current.files.map((f) => (
          <div key={f.kind} style={{ ...card, display: 'flex', alignItems: 'center', padding: 20 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 500, color: gy.text, overflowWrap: 'anywhere' }}>{f.name}</span>
              <span style={{ ...text14, color: gy.secondary }}>{DELIVERY_DOC_SUMMARY[f.kind]}</span>
            </div>
            <span style={{ ...text14, width: 200, flexShrink: 0, color: gy.text }}>{stampFull(current.publishedAt)}</span>
            <div style={{ width: 340, flexShrink: 0, display: 'flex', gap: 32 }}>
              <button type="button" style={textLink} aria-label={`下载 ${f.name}`} onClick={() => void one(f.fileId, f.name)}>
                下载 Word
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'stretch' }}>
        <section aria-label="反馈" style={{ ...card, flex: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 500, color: gy.text }}>发现文稿问题或企业情况变化？</span>
          <span style={{ ...text14, color: gy.text }}>文稿更正与新增企业事实分别处理；反馈不会影响当前成果下载。</span>
          <div style={{ display: 'flex', gap: 24 }}>
            <FeedbackModal
              orgId={orgId}
              source="delivery"
              title="反馈文稿问题"
              intro="请告诉耕云是哪份文档、哪一处需要更正。耕云受理后会安排专家核实，需要更正时会重新交付，当前文档照常可用。"
              context={{ taskId: data.taskId, deliveryVersion: current.version, label: `${data.enterpriseName} · ${data.taskNumber} · ${stampFull(current.publishedAt)} ${state}` }}
              trigger={(open) => (
                <button type="button" style={textLink} onClick={open}>
                  反馈文稿问题
                </button>
              )}
            />
            <ContactLink
              title="提交新的企业事实"
              hint="企业人员、设备、场所等情况有变化时，请联系耕云说明，耕云会安排补充资料并更新成果。"
              trigger={(open) => (
                <button type="button" style={textLink} onClick={open}>
                  提交新的企业事实
                </button>
              )}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
