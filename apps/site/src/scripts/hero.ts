// 首页 Hero：一次编排好的入场 + 产品界面轮播。
// 全站只有这一处自动动效；其余章节不做淡入。用户要求减少动态时，不做入场、不自动轮播。
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

function carousel() {
  const box = document.querySelector<HTMLElement>('[data-carousel]');
  if (!box) return;
  const tabs = [...box.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const screens = [...box.querySelectorAll<HTMLElement>('[data-slide]')];
  const url = box.querySelector<HTMLElement>('[data-win-url]');
  let current = tabs.findIndex((t) => t.classList.contains('is-active'));
  let progress: ReturnType<typeof animate> | null = null;
  let paused = false;

  function show(index: number, focus = false) {
    current = (index + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      const active = i === current;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const fill = tab.querySelector<HTMLElement>('.tab__fill');
      if (fill) fill.style.width = active && reduceMotion ? '100%' : '0%';
    });
    screens.forEach((s, i) => s.classList.toggle('is-active', i === current));
    if (url) url.textContent = screens[current]?.dataset.url ?? '';
    if (focus) tabs[current]?.focus();
    run();
  }

  function run() {
    progress?.stop();
    progress = null;
    if (reduceMotion) return;
    const fill = tabs[current]?.querySelector<HTMLElement>('.tab__fill');
    if (!fill) return;
    const anim = animate(fill, { width: ['0%', '100%'] }, { duration: SLIDE_MS / 1000, ease: 'linear' });
    progress = anim;
    if (paused) anim.pause();
    anim.finished.then(() => {
      // 被切走的旧进度条不触发翻页
      if (progress === anim && !paused) show(current + 1);
    });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => show(i));
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') show(current + 1, true);
      else if (event.key === 'ArrowLeft') show(current - 1, true);
      else return;
      event.preventDefault();
    });
  });

  // 鼠标停在轮播上、或键盘焦点在标签上时暂停，方便看清
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
