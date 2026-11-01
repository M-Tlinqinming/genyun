import { ReloadOutlined } from '@ant-design/icons';
import { Button, Empty, Segmented, Table, Typography } from 'antd';
import { useState } from 'react';
import { type OutboxMail, useOutbox } from '../../api/outbox';
import { ApiError } from '../../api/request';
import { PageHeader } from '../../components/PageHeader';
import { Loading, panel } from '../../components/ui';
import { gy } from '../../theme/tokens';

// 模拟发件箱：预览环境不真的发邮件，邀请链接、找回密码的验证码在这里看。只有运营能进；正式环境没有这个页面。
// 地址 /operator/mail-outbox。平时不在侧栏菜单里（正式环境用不上），打开时侧栏才出现「模拟发件箱」并高亮。

const KIND_LABEL: Record<NonNullable<OutboxMail['kind']>, string> = {
  invitation: '邀请',
  recovery_code: '找回密码验证码',
  password_reset: '密码已重设',
};

// 2026-11-01T01:30:00Z → 11.01 09:30（北京时间）
function shortTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

// 正文里最要紧的一项：验证码或链接
function keyOf(mail: OutboxMail): { label: string; value: string; href?: string } | null {
  // 「验证码：123456」「验证码是：123456」都认
  const code = mail.text.match(/验证码[^\d\n]{0,4}(\d{6})/)?.[1];
  if (code) return { label: '验证码', value: code };
  const link = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (link) return { label: '链接', value: link, href: link };
  return null;
}

// 纯文本正文：链接可以点
function TextBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'inherit', fontSize: 14, lineHeight: '22px', color: gy.text }}>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </pre>
  );
}

// 邮件样式预览：高度跟着内容走，不出现框内滚动条。
// 不允许脚本（没有 allow-scripts），所以可以放开同源，好让外面量出内容高度；链接在新窗口打开
function MailFrame({ mail }: { mail: OutboxMail }) {
  const [height, setHeight] = useState(480);
  return (
    <iframe
      title={`${mail.subject}（邮件样式）`}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={mail.html!.replace('<head>', '<head><base target="_blank">')}
      onLoad={(e) => {
        const doc = e.currentTarget.contentDocument;
        if (doc) setHeight(doc.documentElement.scrollHeight);
      }}
      style={{ width: '100%', maxWidth: 640, height, border: `1px solid ${gy.frameLine}`, borderRadius: 8, background: '#fff', display: 'block' }}
    />
  );
}

function MailDetail({ mail }: { mail: OutboxMail }) {
  const [view, setView] = useState<'html' | 'text'>(mail.html ? 'html' : 'text');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
      {mail.html && (
        <Segmented
          value={view}
          onChange={(v) => setView(v as 'html' | 'text')}
          options={[
            { value: 'html', label: '邮件样式' },
            { value: 'text', label: '纯文本' },
          ]}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
      {view === 'html' && mail.html ? (
        <MailFrame mail={mail} />
      ) : (
        <TextBody text={mail.text} />
      )}
    </div>
  );
}

export function MailOutboxPage() {
  const outbox = useOutbox();
  const closed = outbox.error instanceof ApiError && outbox.error.status === 404;

  return (
    <>
      <PageHeader
        eyebrow="耕云运营"
        title="模拟发件箱"
        description="预览环境不真的发邮件：邀请、找回密码的邮件都在这里，最近 100 封。正式环境没有这个页面。"
        extra={
          !closed && (
            <Button icon={<ReloadOutlined />} onClick={() => outbox.refetch()} loading={outbox.isFetching}>
              刷新
            </Button>
          )
        }
      />
      <div style={{ ...panel, padding: '8px 24px 16px' }}>
        {outbox.isPending ? (
          <Loading card={false} />
        ) : closed ? (
          <Empty description="这里发的是真实邮件，不开放模拟发件箱" style={{ padding: '48px 0' }} />
        ) : outbox.isError ? (
          // 不把服务端的英文报错原样给人看
          <Empty description="发件箱暂时打不开，请点刷新重试" style={{ padding: '48px 0' }} />
        ) : (
          <Table<OutboxMail>
            rowKey="id"
            dataSource={outbox.data}
            pagination={false}
            locale={{ emptyText: <Empty description="还没有发出过邮件" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            expandable={{ expandedRowRender: (m) => <MailDetail mail={m} />, expandRowByClick: true }}
            columns={[
              { title: '时间', dataIndex: 'at', width: 120, render: shortTime },
              { title: '收件人', dataIndex: 'to', width: 240, render: (to: string) => <span style={{ wordBreak: 'break-all' }}>{to}</span> },
              { title: '种类', dataIndex: 'kind', width: 140, render: (k?: OutboxMail['kind']) => (k ? KIND_LABEL[k] : '其他') },
              { title: '主题', dataIndex: 'subject' },
              {
                title: '验证码 / 链接',
                key: 'key',
                width: 260,
                render: (_, m) => {
                  const key = keyOf(m);
                  if (!key) return null;
                  return (
                    <Typography.Text
                      copyable={{ text: key.value, tooltips: ['复制', '已复制'] }}
                      style={key.href ? { fontSize: 13 } : { fontSize: 16, fontWeight: 600, letterSpacing: 2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {key.href ? '复制链接' : key.value}
                    </Typography.Text>
                  );
                },
              },
            ]}
          />
        )}
      </div>
    </>
  );
}
