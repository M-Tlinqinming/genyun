import { chinaToday, DELIVERY_DOC_SUMMARY, type DeliveredVersion, type TaskDeliveries } from '@genyun/shared';
import { App, Button, Result } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { downloadBundle, downloadWord, useTaskDeliveries } from '../../../api/deliveries';
import { ContactLink } from '../../../components/ContactLink';
import { FeedbackModal } from '../../../components/FeedbackModal';
import { FileTypeIcon } from '../../../components/FileTypeIcon';
import { StatusTag } from '../../../components/StatusTag';
import { useWorkspace } from '../../../layouts/workspace';
import { Loading } from '../../../components/ui';
import { gy, stage, type, weight } from '../../../theme/tokens';
import { card, lockText, stampFull, textLink, WORD_TYPE } from './shared';

// U4 成果页｜一个任务最新一次交付的三份 Word：单份下载、整套下载；再次交付时写一行更新说明；下面是反馈入口。
// 客户只看最新一次交付，不显示版本号。
// 编制次数用完或年度服务到期时成果先锁住（U4b 管理员 / U4c 成员）：上面一条琥珀色提醒，下载都置灰，不放反馈
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
  const { orgId, role } = useWorkspace();
  const [bundling, setBundling] = useState(false);
  const state = current.version > 1 ? '已更新' : '已交付';
  const lock = data.lock ? lockText(data.lock, role === 'customer_admin') : null;
  const bundle = async () => {
    setBundling(true);
    try {
      await downloadBundle(data.taskId, current.version, data.enterpriseName, current.publishedAt);
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

  const isAdmin = role === 'customer_admin';
  const note = current.version > 1 && current.updateNote ? `${monthDay(current.publishedAt)}更新：${current.updateNote}` : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="位置" style={{ ...type.body, color: gy.secondary }}>
          <Link to="/customer/documents" style={{ color: gy.secondary }}>
            成果文档
          </Link>{' '}
          / {data.enterpriseName}
        </nav>
        <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>{data.enterpriseName} · 编制成果</h1>
        <span style={{ ...type.body, color: gy.text }}>
          {data.taskNumber} · {data.taskName} · {stampFull(current.publishedAt)} {lock ? '专家已完成' : state === '已更新' ? '更新' : '交付'}
        </span>
        {note && <span style={{ ...type.body, color: gy.secondary }}>{note}</span>}
      </div>

      {lock && (
        <div
          role="status"
          aria-label="成果暂时不能下载"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: isAdmin ? '12px 16px 12px 24px' : '12px 24px',
            borderRadius: 8,
            background: stage.action.bg,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{lock.title}</span>
            <span style={{ ...type.body, color: gy.secondary }}>{lock.body}</span>
          </div>
          {isAdmin ? (
            <ContactLink
              title="联系耕云续约"
              hint="续约或开通年度服务，请直接联系耕云。"
              trigger={(open) => (
                <Button type="primary" onClick={open} style={{ flexShrink: 0 }}>
                  联系耕云续约
                </Button>
              )}
            />
          ) : (
            <ContactLink
              title="联系客服"
              trigger={(open) => (
                <button type="button" style={{ ...textLink, flexShrink: 0 }} onClick={open}>
                  联系客服
                </button>
              )}
            />
          )}
        </div>
      )}

      <section aria-label="交付文件" style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: `1px solid ${gy.split}` }}>
          <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>交付文件</h2>
          <StatusTag tone={lock ? 'action' : 'done'}>{lock ? lock.tag : state}</StatusTag>
          <span style={{ flex: 1 }} />
          {!lock && (
            <Button type="primary" loading={bundling} onClick={() => void bundle()} style={{ flexShrink: 0 }}>
              下载整套 Word
            </Button>
          )}
        </div>
        {current.files.map((f, i) => (
          <div
            key={f.kind}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 24px',
              ...(i < current.files.length - 1 ? { borderBottom: `1px solid ${gy.split}` } : {}),
            }}
          >
            <FileTypeIcon contentType={WORD_TYPE} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{f.name}</span>
              <span style={{ ...type.caption, color: gy.secondary }}>{DELIVERY_DOC_SUMMARY[f.kind]}</span>
            </div>
            <Button
              disabled={Boolean(lock)}
              aria-label={`下载 ${f.name}`}
              onClick={() => void one(f.fileId, f.name)}
              style={{ width: 88, flexShrink: 0, paddingInline: 0, ...(lock ? {} : { borderColor: gy.controlLine }) }}
            >
              下载
            </Button>
          </div>
        ))}
      </section>

      {!lock && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...type.body }}>
          <span style={{ color: gy.secondary }}>文稿有问题，或企业情况变了？</span>
          <FeedbackModal
            orgId={orgId}
            source="delivery"
            title="反馈文稿问题"
            intro="请告诉耕云是哪份文档、哪一处需要更正。耕云受理后会安排专家核实，需要更正时会重新交付，当前文档照常可用。"
            context={{ taskId: data.taskId, deliveryVersion: current.version, label: `${data.enterpriseName} · ${data.taskNumber} · ${stampFull(current.publishedAt)} ${state}` }}
            trigger={(open) => (
              <button type="button" style={textLink} onClick={open}>
                联系客服
              </button>
            )}
          />
        </div>
      )}
    </div>
  );
}

// 「11 月 27 日」（北京时间）
function monthDay(iso: string) {
  const [, m, d] = chinaToday(new Date(iso)).split('-').map(Number);
  return `${m} 月 ${d} 日`;
}
