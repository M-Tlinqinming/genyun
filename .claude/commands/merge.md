---
description: 合并 PR：改代码的等 CI 变绿，只改文档的直接合并；同步工作区、清理本地分支
argument-hint: "[PR 号，不写就用当前分支的 PR]"
---

本地开发阶段（2026-11-20 起）由 Claude 在审查通过后执行；Martin 输入 `/merge` 也按这里做，不再问他确认：

1. **找 PR**：有 $ARGUMENTS 就用这个号；否则 `gh pr view --json number,headRefName,state` 取当前分支的 PR。已经合并的直接跳到第 4 步；已关闭的停下来说明。
2. **等 CI**（只改文档的 PR 跳过这一步）：
   - 先确认分支包含最新 main：`git fetch` 后 `git merge-base --is-ancestor origin/main origin/<分支>`。不包含就到这个分支所在的工作区 `git rebase origin/main`，重跑测试，`git push --force-with-lease`。
   - 然后 `gh pr checks <号> --watch --interval 20`，放后台运行（`run_in_background`），完成后会通知，不要轮询。
   - 全绿 → 第 3 步。
   - 有红的 → **不合并**。用 `gh run view <run> --log-failed` 找原因：是测试写法或环境问题就在该分支修好、本机按 CI 条件复现通过（CI 没有百炼：本机跑浏览器测试时加 `AI_DRAFTER=`）、提交推送，回到第 2 步；是页面或功能真有问题，先用业务语言告诉 Martin 再改。
3. **合并**：`gh pr merge <号> --merge`（远端分支由 GitHub 合并后自动删除，不用提醒 Martin 清理）。
4. **同步本地**：在当前工作区 `git fetch --prune`，再 `git switch --detach origin/main` 或从 `origin/main` 开下一项的分支。main 被 Martin 的 `genyun` 目录占着，别的工作区不 checkout main。**不要在 `genyun` 目录里切分支或拉代码**；Martin 要在本机看新代码时，先问他是不是正在测试，再在 `genyun` 里 `git pull --ff-only`。
5. **清理本地**：
   - `git branch --merged origin/main` 里的分支用 `git branch -d` 删除（只删已合并的；还有工作区停在上面的，先按第 4 步把那个工作区切走）。
   - 固定的工作区 `genyun`、`genyun-dev`、`genyun-design`、`genyun-w1`、`genyun-w2`、`genyun-w3` 不删。
   - 别的已合并且干净的工作区用 `git worktree remove` 删除；被正在运行的 Claude 会话锁住的（`.git/worktrees/<名>/locked` 里写了 pid，且该进程还在）不动。
6. **一句话汇报**：合并了哪个 PR、CI 结果、清理了什么、下一项是什么。
