// 首页 Hero：一次编排好的入场 + 产品界面轮播。
// 全站只有这一处自动动效；其余章节不做淡入。用户要求减少动态时，不做入场、不自动轮播。
// 大标题不参与入场（手机上它是最大内容元素，见 Hero.astro）。
import { animate, stagger } from 'motion';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

function enter() {
  const items = document.querySelectorAll<HTMLElement>('.hero [data-enter]');
  if (!root.classList.contains('js-enter') || items.length === 0) return;
  animate(
    items,
    { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0)'] },
    { duration: 0.7, delay: stagger(0.09), ease: [0.22, 1, 0.36, 1] },
  );
  root.classList.remove('js-enter');
}

const SLIDE_MS = 6000;

// 自动播放只转一轮（4 屏 × 6 秒）后停在开始的第二屏（WCAG 2.2.2）；
// 用户点选或按键切换过，就不再自动翻页。
function carousel() {
  const box = document.querySelector<HTMLElement>('[data-carousel]');
  if (!box) return;
  const buttons = [...box.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const screens = [...box.querySelectorAll<HTMLElement>('[data-slide]')];
  const url = box.querySelector<HTMLElement>('[data-win-url]');
  let current = buttons.findIndex((b) => b.classList.contains('is-active'));
  let autoLeft = reduceMotion ? 0 : buttons.length;
  let progress: ReturnType<typeof animate> | null = null;
  let paused = false;

  function show(index: number) {
    current = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => {
      const active = i === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      const fill = button.querySelector<HTMLElement>('.tab__fill');
      // 不再自动翻页时，当前这一屏的进度条直接画满
      if (fill) fill.style.width = active && autoLeft === 0 ? '100%' : '0%';
    });
    screens.forEach((s, i) => s.classList.toggle('is-active', i === current));
    if (url) url.textContent = screens[current]?.dataset.url ?? '';
    run();
  }

  function stop() {
    autoLeft = 0;
    progress?.stop();
    progress = null;
  }

  function run() {
    progress?.stop();
    progress = null;
    if (autoLeft === 0) return;
    const fill = buttons[current]?.querySelector<HTMLElement>('.tab__fill');
    if (!fill) return;
    const anim = animate(fill, { width: ['0%', '100%'] }, { duration: SLIDE_MS / 1000, ease: 'linear' });
    progress = anim;
    if (paused) anim.pause();
    anim.finished.then(() => {
      // 被切走的旧进度条不触发翻页
      if (progress !== anim || paused) return;
      autoLeft--;
      show(current + 1);
    });
  }

  buttons.forEach((button, i) => {
    button.addEventListener('click', () => {
      stop();
      show(i);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      stop();
      show(current + (event.key === 'ArrowRight' ? 1 : -1));
      buttons[current]?.focus();
    });
  });

  // 鼠标停在轮播上、或键盘焦点在里面时暂停，方便看清
  const pause = () => {
    paused = true;
    progress?.pause();
  };
  const resume = () => {
    paused = false;
    progress?.play();
  };
  box.addEventListener('mouseenter', pause);
  box.addEventListener('mouseleave', resume);
  box.addEventListener('focusin', pause);
  box.addEventListener('focusout', resume);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));

  show(current);
}

enter();
carousel();
