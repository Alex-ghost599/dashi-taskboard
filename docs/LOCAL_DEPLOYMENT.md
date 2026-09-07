# 本地部署

状态：基础治理阶段，尚未构建或安装。正式路径及命令将在部署分支依据实测补齐，不把本文件视为安装完成。

环境：macOS 15.7.1 arm64；Node 22.22.0/npm 10.9.4；Command Line Tools 可用。默认 Rust 1.84 不满足上游 >=1.88，已存在 1.95 工具链可按项目指定使用，不升级全局默认。

首次选稳定版 v1.1.21 加个人补丁；使用 build:web，不运行会 refresh Codex 的 build/check 链。原生构建优先 arm64。安装当前用户 Applications 目录；同名旧 App/受影响配置先备份。

数据、附件与备份必须在 checkout 外；运行服务固定 loopback。日志单独保存。健康检查须同时验证 HTTP/UI，CLI 与 UI 同一数据；测试卡片标明测试，刷新/重启后检查持久化。备份恢复只在隔离目录验证。

Codex 为后续可选 native browser 集成；独立看板先验收。禁止重启现有 Codex 或写官方包/数据库。共享 Skill 不自动覆盖。停止仅限本任务拥有进程；卸载保留数据库与历史备份。

待补：实际 App、数据、日志、备份绝对路径及启动/停止/恢复/卸载命令；构建清单与真实 UI 证据。

## 个人桌面实现（待验收）
构建入口 `sh scripts/personal-build.sh`，使用已有 Rust 1.95、arm64 目标；可执行内嵌 provenance。默认 personal feature 不注册上游 updater、autostart 或 Skill 安装。固定数据 `~/Library/Application Support/Dashi Taskboard Personal`、日志 `~/Library/Logs/Dashi Taskboard Personal/server.log`、端口 127.0.0.1:47823；端口占用则拒绝第二个实例，不接管既有服务。App 退出仅 SIGTERM 自有 Node。CLI 使用 scripts/personal-taskctl。

安装脚本 `python3 scripts/personal-install.py`：验证构建 commit 与 HEAD、dirty=false，同名 App 校验 bundle ID，运行中拒绝替换；先复制 staging，再备份旧 App 并换入。数据库 SQLite backup API 与附件/config 复制保存到用户 Application Support 的独立备份目录。签名使用本地 ad-hoc，未公证，仅本 Mac 验收。
