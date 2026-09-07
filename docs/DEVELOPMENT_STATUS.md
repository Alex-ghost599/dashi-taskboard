# 开发与部署状态

2026-09-07，首次 Mac 个人源码安装验收已执行；最终 PR/发布晋级及重建结果以安装 provenance 与本地验收清单读回为准。

## 源码与工作项
- fork：Alex-ghost599/dashi-taskboard；初始 main 677b54451db707ae6132486b6593b7be11e4ee09。
- 稳定产品基线：v1.1.21 / 1a807be8d4114b82f3cecc61cddaebdba6df9c60。同期最新 Beta/main：v1.1.22-beta.6 / bd264e7ff3402785f1e8b0bb789106358352707b，没有纳入该 Beta。
- 基础 Issue #1、PR #2，squash a99cf4cc64649e2aae376ae06a65ce43f9540f05；foundation_review 独立审核 Pass。
- 安装 Issue #3、PR #4、chore--personal-desktop；最终合并状态从 fork PR 读取。PR base 仅 develop，main 只在验收后 fast-forward，保留所有任务分支。

## 实际验收
| 检查 | 结果/范围 |
|---|---|
| npm ci | 成功，395 packages，audit 0 vulnerabilities |
| 构建前基线 | typecheck、build:web 通过；Node 372 pass/1 skipped/0 fail，组件 9 pass |
| 变更后后端 | server.test.mjs 30/30 pass |
| 原生构建 | 现有 Rust 1.95、arm64 Tauri 构建成功，bundled Node 22.23.2；ad-hoc 签名和安装后验证通过 |
| 独立 UI | 真实创建项目“安装验收测试-20260907”、卡片 202-1，添加评论，todo→in_review，刷新后保留 |
| Finder/App | 从 Finder 打开安装版，真实显示同一卡片、评论、状态；退出重启后 CLI 数据一致 |
| 监听/清理 | 仅 127.0.0.1:47823；修正退出无界等待后自有 App/Node 均消失，无残留监听；原 Codex PID 82362 保持 |
| 数据恢复 | 隔离 47824 服务读取恢复副本，CLI 与正式卡片一致，SQLite integrity_check=ok，评论保留；隔离服务已停止 |
| 自动认领 | 浏览器和重启桌面均 Paused/off，控件不可用，无模型调用/真实任务执行 |
| 更新策略 | 个人入口不注册 updater，无上游替换路径；策略编译固定，重启后仍个人入口 |
| Codex | Codex In-app Browser 实际显示同一服务/卡片；无 CDP/sidebar 注入和会话定位验收 |
| 共享写入 | 无共享 Skill、PATH、shell、官方 App/数据库或开机自启修改；仅仓库启动动作改为个人 App |

证据位于 checkout `.local-evidence/`：baseline-*.log、personal-server-test.log、native-*.png/ax.txt、native-restart-cli.json、shutdown-validation.json、restore-validation.json、install-*.json、codex-browser.png。精确构建源码和时间在安装 App `Contents/Resources/build-provenance.json`；安装收据在用户 Application Support 备份目录。

## 审核与已处理问题
- foundation_review 独立 reviewer：基础 c2f2f37 Pass。
- 部署首轮发现 personal 默认 feature 对 Windows 不适用；已限定 Mac，并改为 personal-build.sh 显式启用，保留原平台 CI，添加 personal cargo check。e4270aa 增量静态审核 Pass，无 Critical/Important。
- 现场网络：Git OAuth 缺 workflow scope，复用已合法认证同账号的现有 SSH；没有增加 scope。Cargo HTTP/2 错误使用本次 HTTP/1 配置解决。
- 初次未签名和 Documents 的 FinderInfo 使签名失败，改为缓存区无元数据副本 ad-hoc 签名。一次构建中编辑运行脚本导致失败，随后使用固定提交完整重跑成功，失败产物不用于最终发布。
- 首次 Cmd+Q 后监听停止但 Node 残留，具体异步阻塞点未定位；owned Child 增加 5 秒退出期限后真实退出/重启通过。

## 保留限制
没有上游云部署、远端发布或 updater 链验收；GitHub 基础 PR 未产生 Check runs，不能声称 CI 通过。最终远端 Check 状态另行记录，Mac 本地构建/UI 是本次主要验收。上游未用 launcher 代码产生 dead-code warnings；网页大 chunk 提示仍保留。不把新会话/侧边栏注入、Windows/Linux 运行、签名公证或付费模型认领视为已完成。启动握手无超时、App 被强杀的孤儿恢复仍依赖文档人工诊断，后续出现实际问题再处理。

最终独立 foundation_review（00e39c8 文档 / e4270aa 安装）：Pass，无 Critical/Important；实时检查签名、provenance、唯一 loopback、自有进程与原 Codex 保留，并查看真实截图。合并后仍必须重建最终 commit，不能以该 review 提前证明来源一致。完整 AX 补充为 codex-browser-full.ax.txt/native-current-full.ax.txt；增量 AX 需配截图，不单独作为完整UI证据。
