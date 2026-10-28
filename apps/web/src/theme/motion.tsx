import { useAutoAnimate } from '@formkit/auto-animate/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { gy } from './tokens';

// 动效规范（Martin 2026-10-28 在动效选型页选定）：只用来说明「发生了什么变化」，都很短；
// 系统设置了「减少动态效果」时一律不动。时长与曲线只在这里定义，全站共用
export const MOTION = {
  // 状态文字切换、弹窗与抽屉进出
  fast: 0.15,
  // 列表增删、状态标签换色
  mid: 0.2,
  // 资料项变为已满足时整行淡绿一闪后褪去
  flash: 0.9,
  ease: [0.2, 0, 0, 1] as const,
};

// 列表增删：新行展开并淡入，删除时收起（AutoAnimate）。把返回的 ref 挂到列表的父元素上
export function useListMotion<T extends HTMLElement>() {
  const [ref] = useAutoAnimate<T>({ duration: MOTION.mid * 1000, easing: 'ease-out' });
  return ref;
}

// 状态文字切换：旧文字淡出、新文字淡入（如「保存中…」→「已自动保存 10:24」）
export function FadeSwap({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={id}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduce ? undefined : { opacity: 0 }}
        transition={{ duration: MOTION.fast, ease: MOTION.ease }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

// 某个值变成「完成」时让一块区域淡绿一闪后褪去；第一次显示时不闪，只在之后变化时闪
export function FlashOnDone({
  done,
  as = 'div',
  children,
  style,
  ...rest
}: { done: boolean; as?: 'div' | 'li'; children: ReactNode; style?: CSSProperties } & Record<`data-${string}`, string>) {
  const reduce = useReducedMotion();
  const prev = useRef(done);
  const flash = !reduce && done && !prev.current;
  useEffect(() => {
    prev.current = done;
  }, [done]);
  const Comp = as === 'li' ? motion.li : motion.div;
  return (
    <Comp
      {...rest}
      style={style}
      animate={flash ? { backgroundColor: [gy.successBg, 'rgba(0,0,0,0)'] } : undefined}
      transition={{ duration: MOTION.flash, ease: 'easeOut' }}
    >
      {children}
    </Comp>
  );
}
