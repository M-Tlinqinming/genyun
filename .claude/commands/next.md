---
description: 开始一个工作会话：读进度、确认现状、挑下一件事做
---

按顺序执行，不要跳步：

1. **读背景**：`CLAUDE.md`、`docs/PROGRESS.md`；按需读 `docs/TECH-PLAN.md` 相关章节。不要重新讨论已确认的决定。
2. **确认现状**：`git status`、`git log --oneline -5`、`git fetch` 后看 main 是否有新提交；工作区不干净或不在 main 时，先向 Martin 说明再继续。然后跑 `npm run typecheck` 和 `npm test`，有失败先修或报告，不要在坏的基础上开新功能。
3. **挑一件事**：
   - Martin 在 `/next` 后面写了具体要求（$ARGUMENTS），以它为准。
   - 否则取 `docs/PROGRESS.md` 当前里程碑里第一项未完成的任务。
   - 当前里程碑「待拆分」时，这次会话的任务就是拆分：读 TECH-PLAN 和 Paper 对应画板，写出任务清单（格式见 PROGRESS），**交 Martin 确认后**再写进 PROGRESS，然后停下。
   - 预览环境等「阻塞」任务：只有 Martin 给出解除阻塞所需的信息时才做；用 worktree 隔离（分支名见 PROGRESS），不和主线开发抢同一个工作区。
4. **说清计划再动手**：用业务语言告诉 Martin 这次做什么、做完他能看到什么、大约改哪些地方。小任务直接开工；涉及数据模型、对外操作或范围变化，先等确认。
5. **开发**：从 main 开分支（任务清单里写了分支名就用它）。UI 以 Paper 10–16 页为准，用 `get_jsx` / `get_computed_styles` 取精确值。每完成一个可验证的小块就提交一次。
6. **验收**：跑 `npm run typecheck`、`npm test`、`npm run e2e`；页面类任务给出与 Paper 画板的并排截图。全部通过再说「完成」，失败如实报告。
7. **收尾**：执行 `/wrap` 的步骤。
