import { EXPERT_AVATARS, type ExpertAvatar as AvatarCode } from '@genyun/shared';
import gy1 from '../assets/expert-avatars/gy1.svg';
import gy2 from '../assets/expert-avatars/gy2.svg';
import gy3 from '../assets/expert-avatars/gy3.svg';
import gy4 from '../assets/expert-avatars/gy4.svg';
import gy5 from '../assets/expert-avatars/gy5.svg';
import gy6 from '../assets/expert-avatars/gy6.svg';
import gy7 from '../assets/expert-avatars/gy7.svg';
import gy8 from '../assets/expert-avatars/gy8.svg';
import { gy } from '../theme/tokens';

// 专家的系统头像（8 选 1，图是 CC0 的 Notionists）
const SRC: Record<AvatarCode, string> = { gy1, gy2, gy3, gy4, gy5, gy6, gy7, gy8 };

const isAvatarCode = (v: string | null | undefined): v is AvatarCode => !!v && (EXPERT_AVATARS as readonly string[]).includes(v);

// 专家头像：选了系统头像就显示那张图，没选（或认不出）显示名字的第一个字。都是圆形。
// 分配弹窗、以后的专家入驻和客户选专家共用
export function ExpertAvatar({
  avatar,
  name,
  size = 32,
  muted = false,
}: {
  /** 头像代码 gy1–gy8，没选传 null */
  avatar: string | null | undefined;
  /** 专家名字，没头像时取第一个字 */
  name: string;
  /** 直径，默认 32 */
  size?: number;
  /** 置灰（如暂停接单） */
  muted?: boolean;
}) {
  const box = { width: size, height: size, borderRadius: '50%', flexShrink: 0 } as const;
  if (isAvatarCode(avatar)) {
    return (
      <img
        src={SRC[avatar]}
        alt=""
        aria-hidden
        width={size}
        height={size}
        style={{ ...box, display: 'block', background: gy.avatarBg, opacity: muted ? 0.5 : 1 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        ...box,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: gy.avatarBg,
        color: muted ? gy.tertiary : gy.secondary,
        fontSize: size >= 32 ? 14 : 12,
        lineHeight: 1,
      }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
