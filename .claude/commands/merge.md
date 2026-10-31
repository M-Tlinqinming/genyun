---
description: Martin 看完 PR 后：等 CI 变绿再合并，同步本地 main，清理本地分支
argument-hint: "[PR 号，不写就用当前分支的 PR]"
---

Martin 输入 `/merge` 表示 PR 已经看过、同意合并。按顺序执行，不再问他确认：

1. **找 PR**：有 $ARGUMENTS 就用这个号；否则 `gh pr view --json number,headRefName,state` 取当前分支的 PR。已经合并的直接跳到第 4 步；已关闭的停下来说明。
2. **等 CI**：`gh pr checks <号> --watch --interval 20`，放后台运行（`run_in_background`），完成后会通知，不要轮询。
   - 全绿 → 第 3 步。
   - 有红的 → **不合并**。用 `gh run view <run> --log-failed` 找原因：是测试写法或环境问题就在该分支修好、本机按 CI 条件复现通过（CI 没有百炼：本机跑浏览器测试时加 `AI_DRAFTER=`）、提交推送，回到第 2 步；是页面或功能真有问题，先用业务语言告诉 Martin 再改。
3. **合并**：`gh pr merge <号> --merge`（远端分支由 GitHub 合并后自动删除，不用提醒 Martin 清理）。
4. **同步本地**：`git checkout main`、`git pull --ff-only`、`git fetch --prune`。
5. **清理本地**：`git branch --merged origin/main` 里除 main 外的分支用 `git branch -d` 删除（只删已合并的）；`git worktree list` 里已合并且干净的工作区用 `git worktree remove` 删除，但被正在运行的 Claude 会话锁住的（`.git/worktrees/<名>/locked` 里写了 pid，且该进程还在）不动，告诉 Martin 关掉那个会话后再清。
6. **一句话汇报**：合并了哪个 PR、CI 结果、清理了什么；最后提示下一个会话输入 `/next`。
