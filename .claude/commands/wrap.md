---
description: 结束一个工作会话：更新进度、提交、准备 PR
---

1. **更新 `docs/PROGRESS.md`**：勾掉完成的任务；里程碑状态如有变化一并改；在「会话记录」最上面加一条（日期 · 做了什么 · 分支/PR · 留给下一个会话的话）。没做完的写清楚停在哪、下一步是什么。
2. **新的决定**：Martin 这次确认的业务规则写进 `CLAUDE.md`，技术决定写进 `docs/TECH-PLAN.md`；只记结论，不记讨论过程。
3. **提交**：确认 `git status` 只有本任务相关的改动，提交到当前分支。不要提交到 main。
4. **推送与 PR**：本机已有 `gh`。Martin 说推送后，Claude 推送分支并用 `gh pr create` 开 PR（标题和说明用业务语言：做了什么、怎么验收、还剩什么），把 PR 链接给 Martin，Martin 在网页上合并。
   - 自动模式不允许 Claude 删除 GitHub 上的分支：合并后给 Martin 清理命令 `! git -C D:/001-Project/genyun push origin --delete <分支名>`（路径用正斜杠；GitHub 若在合并时已自动删除分支，就不用这步）
   - 本机已合并的分支和工作区由 Claude 清理（`git branch -d` 只删已合并的）
5. 最后一句话告诉 Martin：下一个会话输入 `/next` 即可接着做。
