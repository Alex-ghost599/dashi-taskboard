# Obsidian 只读导入预览

本阶段提供源码 CLI，不启动服务、不修改笔记或数据库、不创建 Codex 任务。输出清单供人核对，`authorizesImport` 与 `authorizesDispatch` 固定为 `false`。正式桌面 App 尚未接入此入口。

## 显式输入

准备一份本机 JSON 清单，不提交个人路径或任务内容：

```json
{
  "root": "/absolute/synthetic-notes",
  "files": ["example.md"],
  "scope": {
    "from": "2026-09-01",
    "through": "2026-09-30",
    "statuses": ["planned", "active"]
  },
  "projects": [
    {"hostId": "local", "projectId": "example-project", "workspacePath": "/absolute/example-project"}
  ],
  "existing": []
}
```

执行 `node scripts/obs-import-preview.mjs --manifest /absolute/preview.json`。JSON 结果写 stdout；失败退出 1。需要保存时自行重定向到私有目录；输出含完整选中笔记及字段差异，不应发到公开日志或 GitHub。CLI 没有网络调用、模型调用或默认 vault 路径。

日期边界包含首尾，明确使用 `task_id` 中的日期，不代表文件修改时间、完成时间或最近七天活动。状态必须逐项列明；没有默认时间或状态范围。取消的旧七天导入请求不复用。

`files` 为 root 内显式相对 `.md` 路径，不递归发现文件；拒绝 `..`、绝对路径、越过 root 的真实路径以及 root 以下任意层级符号链接。输入清单最大 2 MiB，最多 1000 文件，每文件 1 MiB，总正文 10 MiB。只读普通文件，文件读取失败时整个 CLI 失败且不输出部分候选。打开已解析路径并比较打开文件的 dev/ino，读取前后复核路径、元数据及父目录链接，检测变化即失败且无报告输出。这些校验不构成针对恶意并发目录反复替换的操作系统沙箱；运行时应保持指定目录稳定，本预览不能作为后续写入的授权或无冲突证明。

## 判断规则

- 复用 `OBSIDIAN_TASK_CONTRACT.md`：来源明确为 Codex，executor 留空继承已知来源，非 Codex 执行者跳过。保留源状态，不转换为原生 Todo；来源会话与执行绑定分开，历史空绑定保持空。
- frontmatter 必须是独立 YAML mapping，拒绝重复键、锚点、对象别名、merge key、过深或过大的元数据。现有 `js-yaml` JSON schema 不把日期转换成 Date；无法解析的文档明确跳过。存在此类文档时 `completeness=unreadable_documents`，不能声称已完成整批去重。
- 同一显式快照中的重复任务 ID 全部冻结，先做去重再筛选时间和状态；重复已有索引 ID 同样冻结。范围外文档也必须放入清单才能发现其重复 ID。未读取文件不在去重覆盖内。
- 项目仅匹配 `workspace` 与项目清单 `workspacePath` 的精确字符串，必须恰好一项。缺失、同名或多 host 同路径造成歧义时跳过；不从标题、正文、父目录猜测归属，不标准化路径掩盖区别。
- 项目清单是操作者提供的快照，不证明当前主机和项目存在。已有执行绑定与所选项目的 host/project/cwd 不一致时跳过；完整一致仍保持 `bindingVerified=false`。
- `existing` 为此前预览 `proposed` 形状的 Obsidian 索引快照，不接收或转换原生业务卡。按稳定 `taskId` 比较，移动文件显示 `sourcePath` 差异；输出 `create`/`update`/`unchanged` 及每个字段的前后值。保留原始 `sourceMarkdown`（包括未知字段、格式与正文），不把规范化身份对象当作整份 frontmatter 替换内容。

## 验证及后续

`node --test test/obs-import-preview.test.mjs test/obs-import-preview-cli.test.mjs` 使用合成笔记验证字段保留、状态隔离、项目冲突、去重、YAML 拒绝、输入限制、CLI 无写入和差异识别。此结果只证明源码 CLI 与合成输入路径；尚未对真实 vault 选定范围运行，没有导入、双向联动或 UI 验收。

真实预览需明确选定文件范围和项目清单；实际索引导入另行确定范围与验收。未来写入须重新读取并检查源变化、整库重复 ID、权限和冲突，不直接执行此报告中的 `proposed`。Obsidian 的权威存储和跨写入者规则仍由 #27/#29/#30 推进。
