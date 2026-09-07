# 个人 fork 维护

## 日常 CDP 维护增量（2026-09-07）

PR #8 已 squash 至 develop `f353e0c7a2af8c3758286eaa71e1c16080700b29`；旧 feat--personal-cdp-integration 保留。日常启动改动从该 develop 创建 `fix--daily-cdp-launch`，仍仅个人 fork PR → develop squash → 验收后 main fast-forward，保留分支/worktree。

新增 scripts/personal-cdp-open.py 为手工启动入口，默认日常 home/profile、9229 loopback、已运行无 CDP 拒绝、已有注入器复用；没有常驻开机服务或替换更新源。test/personal-cdp-open_test.py 覆盖七个进程/端口/home 分支，通用 Check 加入执行。入口只调用安装版注入器，不重新实现 CDP 协议。

最终发布 SHA 存在安装 build-provenance/备份 receipt 和本机 `.local-evidence/cdp-handoff-retry-20260907/MANIFEST.json`，文档不嵌自身提交 SHA。发布前必须独立审核、PR CI、真实日常 UI 与同库验收；CI 和端口监听不替代实机验收。默认入口对未来新增官方参数采取拒绝策略，出现变更先核对来源和日常身份再修改规则。

以下为之前阶段的维护记录；后续不沿用旧的“日常未部署”状态。

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

- Issue #7：个人App持久私有凭据与受限根入口；CLI/CDP共享唯一服务。external-service是仅附着模式，禁止生命周期接管、版本/HMAC降级、通用runtime写入；停止/失败须撤销本次注入而不停止已有Codex或App。

Issue #7 的兼容补丁将原生 preload 回调与网页 postMessage 分开验证；不退回标题识别，不向外部页面下发令牌，不放宽自动认领或上游更新策略。独立 App 与注入器使用同一持久化凭据/数据库。当前隔离 UI 验收完成，日常部署与最终发布结论尚未形成；远端 host 的 IPC 转发尚未验收。
