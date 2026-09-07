# 个人 fork 工程与交付规则

本文件面向 Alex 的个人版；上游说明仅作工程参考，与本文件或用户当前指令冲突时不适用。

## 边界与 Git
- GitHub 写入只允许 `Alex-ghost599/dashi-taskboard`；禁止向 `chuspeeism/dashi-taskboard` push、Issue、PR、评论或发布。
- `origin` 是唯一写 remote；`upstream` 仅 fetch/比较，push URL 必须为 `DISABLED`。仓库级 `remote.pushDefault=origin`、`push.default=simple`；不改全局 Git 配置。
- gh 命令设置 `GH_PROMPT_DISABLED=1`，支持 --repo 时明确 fork；API 同样绑定 owner/repo。每次写前核对目标，写后读回。
- main 为默认/发布分支，develop 为长期集成分支；从最新 develop 创建 `feat--`/`fix--`/`refactor--`/`docs--`/`chore--` 分支，不直接开发 main/develop。
- 选择性 staging，提交前检查 staged diff，小提交使用 `type: description`。所有 PR base 为 develop，gh squash merge；保留本地及远端分支、worktree 和会话。不 force push，不重写 main/develop。
- develop 通过发布验收后，main 仅 fast-forward 到已验收的 develop 提交并 push origin/main；不得创建 base=main PR。无法 fast-forward 时诊断，不覆盖。
- squash 遗留审计结合 PR merged 状态、head SHA 和内容，不只依赖 branch --merged。

## 工程约定
保留上游适用原则：先写明真实路径（入口 → 动作 → API/文件/副作用 → 可观察结果），实现最小直接修复；复用已有架构，不做无关重构或推测性扩展。按变化层验证，不重复无关打包。共享运行时串行操作，停止进程必须证明所有权。

## 运行与验收
- 正式运行版本对应已提交源码，记录上游 tag/commit、fork commit 和安装清单；版本号相同不代表稳定版源码相同。
- 凭据、数据库、附件、日志、构建产物、机器绝对路径配置不得提交。运行数据放 checkout 外，切换源码不切换正式数据库。
- 独立看板必须可用；Codex 集成可选。禁止修改官方 App、app.asar、内部数据库；不得因测试关闭、重启或重配置现有 Codex。
- 初次仅 loopback，自动认领关闭；不自动认领真实任务、不导入/同步个人驾驶舱或 Obsidian 权威任务。
- 上游自动替换更新在个人安装版中禁用；fork 发布链未验收前不启用其他替换更新源。
- Skill/CLI 安装先检查来源和冲突，未知同名内容不覆盖；共享写入需备份及恢复记录。CLI/UI 使用同一服务。
- 非 trivial 代码、配置、AGENTS、部署规则变化由独立 validation-only reviewer 审核目标、边界、副作用、失败模式、证据质量；Critical/Important 解决后才合并发布。本 fork 使用独立 reviewer，不继承上游 Pro/人工逐项确认流程。
- 进程存在、端口监听、单测或构建成功均不能替代真实 UI 验收。分别记录独立看板、桌面启动、Codex 页面/会话定位。
- 每次变更同步 docs/DEVELOPMENT_STATUS.md 和 docs/LOCAL_DEPLOYMENT.md；持续维护 docs/FORK_MAINTENANCE.md。未完成项如实保留。

## 上游同步与发布
上游更新只读取、fetch 和比较；未来合入需独立同步分支评估个人补丁、冲突、测试及审核，再按上述流程发布。不得自动把上游新版本部署到运行环境。继承的签名/云发布工作流禁用发布入口，保留测试 CI；不运行 cloud:deploy、cloud:data 或上游安装器默认副作用。
