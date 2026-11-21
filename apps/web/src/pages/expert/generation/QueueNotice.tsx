import { ClockCircleFilled } from '@ant-design/icons';
import { ContactLink } from '../../../components/ContactLink';
import { gy, type, weight } from '../../../theme/tokens';
import type { QueueNoticeText } from './generationText';

// 排队很久的琥珀提示：满 10 分钟出，满 30 分钟右边放「联系耕云客服」
export function QueueNotice({ notice }: { notice: QueueNoticeText }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 16px',
        borderRadius: 8,
        background: gy.warningBg,
      }}
    >
      <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
        <ClockCircleFilled aria-hidden style={{ fontSize: 16, color: gy.warning, flexShrink: 0, marginTop: 3 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{notice.title}</span>
          <span style={{ ...type.body, color: gy.secondary }}>{notice.body}</span>
        </div>
      </div>
      {notice.contact && (
        <span style={{ flexShrink: 0, ...type.body }}>
          <ContactLink title="耕云客服">联系耕云客服</ContactLink>
        </span>
      )}
    </div>
  );
}
