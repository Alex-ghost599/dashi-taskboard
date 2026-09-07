# 个人 fork 维护

写入仓库：https://github.com/Alex-ghost599/dashi-taskboard
只读上游：https://github.com/chuspeeism/dashi-taskboard

2026-09-07 核实账号 Alex-ghost599，复用已有 fork。初始 main/develop：677b54451db707ae6132486b6593b7be11e4ee09。基础分支从 develop 创建后 fast-forward 到稳定版 v1.1.21（1a807be8d4114b82f3cecc61cddaebdba6df9c60），再提交个人约束，PR squash 合入 develop；不重写历史。

当日 Beta v1.1.22-beta.6/main 为 bd264e7ff3402785f1e8b0bb789106358352707b。稳定版之后主要是编辑器、Windows、CI 与更新预下载改动；首次安装选择稳定版，不默认纳入 Beta。

## 个人改动清单
- AGENTS：fork-only、develop squash、main fast-forward、保留分支、真实验收及独立审核。
- CI：保留 Check，PR 限 develop；Release 的前置 job 恒禁用，其依赖发布链不运行。不得推送继承的上游标签触发旧代码工作流；本次不创建 release/tag。
- 运行补丁：Mac 专用 personal entry（构建时显式启用）、固定 loopback、checkout 外数据库、自有子进程有界退出、个人 CLI、缓存区 ad-hoc 签名、可回滚用户安装。原 launcher 保留但个人版不进入。
- 仓库启动动作改为 scripts/personal-open.sh；共享 Skill 未安装。
- Check 额外编译 personal Mac entry；原平台检查保留。

## 日常开发
核对 status/remotes → fetch → checkout develop → pull --ff-only origin develop → checkout -b feat--具体功能 → Issue → 小提交及 staged diff → 直接路径验证 → 独立审核 → push origin/任务分支 → PR base develop → squash（不删除分支）→ 发布验收 → main fast-forward → 可回滚安装。

GitHub 写前确认 owner/repo，写后回读。所有 gh 显式 GH_PROMPT_DISABLED=1 与 fork 目标。main 分叉不强推。squash 分支用 PR 合并状态与 tree/diff 审计。

## 同步与更新器
未来上游同步独立分支评估，不自动合入或更新运行环境。当前 Tauri 上游 updater 指向上游 stable/beta，初次个人版必须禁用实际替换路径；fork updater 未验证，不得启用。原生 launcher 启动可能安装共享 Skill 并请求重启 Codex，不能直接用于首次验收。

## 本机认证
origin fetch 为 fork HTTPS，push 为 `git@github.com:Alex-ghost599/dashi-taskboard.git`。已有 SSH 认证已核实同账号，因 OAuth 缺 workflow scope 采用该路径；不扩权限。upstream push URL 仍 DISABLED。

## 个人补丁与已接受行为（2026-09-07）
- Issue #5：CDP 目标只认可信 app 主页面；凭证写入前校验，导航撤权，通知同窗口/同源，打包携带信任策略模块。后续上游合入需保留此边界及负向测试，禁止恢复标题回退。
- 用户确认保留自动 AI 项目总结和 Markdown/头像外链加载；它们是已接受的数据处理/网络行为，不按恶意后门判定，也不因安全审计擅自关闭。自动认领和上游程序替换更新仍关闭。
