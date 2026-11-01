import { DELIVERY_DOC_SUMMARY, deliveryLabel, type DeliveredVersion, type TaskDeliveries } from '@genyun/shared';
import { App, Button, Result, Tooltip } from 'antd';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { downloadBundle, downloadWord, useTaskDeliveries } from '../../../api/deliveries';
import { ContactLink } from '../../../components/ContactLink';
import { FeedbackModal } from '../../../components/FeedbackModal';
import { useWorkspace } from '../../../layouts/workspace';
import { Loading } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { card, MissingVersion, NOT_READABLE, pickVersion, stampFull, text14, textLink, textLinkDisabled, versionText } from './shared';

// R05 交付详情｜一个任务某个交付版本的三份 Word：在线阅读、单份下载、整套下载；下方是交付版本记录与反馈入口。
// ?v= 指定版本，不写就是最新
export function DeliveryPage() {
  const { taskId = '' } = useParams();
  const [params] = useSearchParams();
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
        subTitle="注安师审核并发布后，三份 Word 会出现在这里。"
        extra={<Link to={`/customer/tasks/${taskId}`}>查看任务进度</Link>}
      />
    );
  }
  const { current = latest, missing } = pickVersion(data.versions, params.get('v'));
  return <Delivery data={data} current={current} isLatest={current === latest} missing={missing} />;
}

function Delivery({ data, current, isLatest, missing }: { data: TaskDeliveries; current: DeliveredVersion; isLatest: boolean; missing: string | null }) {
  const { message } = App.useApp();
  const { orgId } = useWorkspace();
  const [bundling, setBundling] = useState(false);
  const v = versionText(current.version);
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
      {missing && <MissingVersion text={missing} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="位置" style={{ ...text14, color: gy.secondary }}>
          <Link to="/customer/documents" style={{ color: gy.secondary }}>
            成果文档
          </Link>{' '}
          / {data.enterpriseName} / {v}
        </nav>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '40px', fontWeight: 500, color: gy.text }}>{data.enterpriseName} · 编制成果</h1>
        <span style={{ ...text14, color: gy.text }}>
          {data.taskNumber} · {data.taskName} · {stampFull(current.publishedAt)} 发布
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
          background: isLatest ? gy.successBg : gy.neutralBg,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, color: isLatest ? gy.success : gy.text }}>
            {isLatest ? `三份文档已交付 · ${v} 当前版本` : `这是历史版本 ${v}`}
          </span>
          <span style={{ ...text14, color: gy.text }}>
            {isLatest ? (
              '注安师已审核通过，可直接阅读与下载。'
            ) : (
              <>
                已有更新的交付版本 {versionText(data.versions[0]!.version)}，请以最新版本为准。{' '}
                <Link to={`/customer/documents/${data.taskId}`} style={{ color: gy.primary }}>
                  查看最新版本
                </Link>
              </>
            )}
          </span>
        </div>
        <Button type="primary" size="large" loading={bundling} onClick={() => void bundle()} style={{ flexShrink: 0, padding: '10px 20px', height: 'auto' }}>
          下载整套 Word
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', padding: '12px 20px', borderBottom: `1px solid ${gy.split}`, ...text14, fontWeight: 500, color: gy.text }}>
          <span style={{ flex: 1, minWidth: 0 }}>交付文件</span>
          <span style={{ width: 200, flexShrink: 0 }}>版本</span>
          <span style={{ width: 340, flexShrink: 0 }}>操作</span>
        </div>
        {current.files.map((f) => (
          <div key={f.kind} style={{ ...card, display: 'flex', alignItems: 'center', padding: 20 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 500, color: gy.text, overflowWrap: 'anywhere' }}>{f.name}</span>
              <span style={{ ...text14, color: gy.secondary }}>{DELIVERY_DOC_SUMMARY[f.kind]}</span>
            </div>
            <span style={{ ...text14, width: 200, flexShrink: 0, color: gy.text }}>{v} · 同批交付</span>
            <div style={{ width: 340, flexShrink: 0, display: 'flex', gap: 32 }}>
              {f.readable ? (
                <Link to={`/customer/documents/${data.taskId}/read/${f.kind}?v=${current.version}`} style={textLink} aria-label={`在线阅读 ${f.name}`}>
                  在线阅读
                </Link>
              ) : (
                <Tooltip title={NOT_READABLE}>
                  <span style={textLinkDisabled} aria-disabled>
                    在线阅读
                  </span>
                </Tooltip>
              )}
              <button type="button" style={textLink} aria-label={`下载 ${f.name}`} onClick={() => void one(f.fileId, f.name)}>
                下载 Word
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'stretch' }}>
        <section aria-label="交付版本记录" style={{ ...card, flex: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 500, color: gy.text }}>交付版本记录</span>
          {data.versions.length === 1 ? (
            <>
              <span style={{ ...text14, color: gy.text }}>{v} 是本任务首次交付，当前暂无旧交付版本。</span>
              <span style={{ ...text14, color: gy.secondary }}>后续如发布新版本，这里会保留各批文档与发布时间，避免混用。</span>
            </>
          ) : (
            data.versions.map((item, i) => (
              <div key={item.version} style={{ display: 'flex', alignItems: 'center', gap: 12, ...text14 }}>
                <span style={{ width: 40, color: gy.text, fontWeight: item.version === current.version ? 500 : 400 }}>{versionText(item.version)}</span>
                <span style={{ flex: 1, color: gy.secondary }}>
                  {stampFull(item.publishedAt)} 发布{i === 0 ? ' · 最新' : ''}
                </span>
                {item.version === current.version ? (
                  <span style={{ color: gy.tertiary }}>正在查看</span>
                ) : (
                  <Link to={`/customer/documents/${data.taskId}${i === 0 ? '' : `?v=${item.version}`}`} style={textLink}>
                    查看
                  </Link>
                )}
              </div>
            ))
          )}
        </section>
        <section aria-label="反馈" style={{ ...card, flex: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 500, color: gy.text }}>发现文稿问题或企业情况变化？</span>
          <span style={{ ...text14, color: gy.text }}>文稿更正与新增企业事实分别处理；反馈不会影响当前成果下载。</span>
          <div style={{ display: 'flex', gap: 24 }}>
            <FeedbackModal
              orgId={orgId}
              source="delivery"
              title="反馈文稿问题"
              intro="请告诉耕云是哪份文档、哪一处需要更正。耕云受理后会安排注安师核实，需要更正时发布新的交付版本，当前版本照常可用。"
              context={{ taskId: data.taskId, deliveryVersion: current.version, label: `${data.enterpriseName} · ${data.taskNumber} · ${deliveryLabel(current.version)}` }}
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
