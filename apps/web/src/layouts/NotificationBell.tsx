import { BellOutlined } from '@ant-design/icons';
import { Badge, Button, Empty, Popover } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMarkRead, useNotifications, type Notification } from '../api/notifications';
import { gy } from '../theme/tokens';

// 北京时间 MM.DD HH:mm
function dateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

// 顶栏铃铛：站内提醒（补充请求、客户回答等），点一条进对应页面并标为已读
export function NotificationBell() {
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const data = notifications.data;

  const go = (n: Notification) => {
    setOpen(false);
    if (!n.readAt) markRead.mutate([n.id]);
    navigate(n.link);
  };

  const content = (
    <div style={{ width: 340, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px', borderBottom: `1px solid ${gy.split}` }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>提醒</span>
        {data && data.unread > 0 && (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => markRead.mutate(undefined)}>
            全部标为已读
          </Button>
        )}
      </div>
      {!data || data.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂时没有提醒" />
      ) : (
        <ul aria-label="提醒列表" style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 400, overflowY: 'auto' }}>
          {data.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => go(n)}
                style={{
                  display: 'flex',
                  gap: 10,
                  width: '100%',
                  padding: '10px 4px',
                  border: 'none',
                  borderBottom: `1px solid ${gy.split}`,
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 6, height: 6, marginTop: 8, flexShrink: 0, borderRadius: 3, background: n.readAt ? 'transparent' : gy.error }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text, fontWeight: n.readAt ? 400 : 500 }}>{n.title}</span>
                  {/* 正文最多 3 行；运营说明等要紧的话放在正文第一句 */}
                  <span
                    data-role="notification-body"
                    title={n.body}
                    style={{
                      fontSize: 13,
                      lineHeight: '20px',
                      color: gy.secondary,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      wordBreak: 'break-all',
                    }}
                  >
                    {n.body}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>{dateTime(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} arrow={false}>
      <Badge count={data?.unread ?? 0} size="small" offset={[-6, 6]}>
        <Button type="text" icon={<BellOutlined />} aria-label={data?.unread ? `提醒，${data.unread} 条未读` : '提醒'} style={{ color: gy.text }} />
      </Badge>
    </Popover>
  );
}
