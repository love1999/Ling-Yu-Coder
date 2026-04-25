# 灵羽（Ling-Yu-Coder）

基于 **Electron + CodeMirror** 搭建的多 Agent 智能编码桌面应用原型，内置从需求澄清到文档生成的完整流水线。

## 已实现模块

- ✅ Clarifier Agent：拆解用户目标与约束。
- ✅ Retriever Agent：结合长期记忆提取上下文。
- ✅ Plan Agent：生成执行计划。
- ✅ Act Agent：执行代码改写动作。
- ✅ Compiler Agent（语法检查）：使用 `acorn` 做 JS 语法检测。
- ✅ Test/Runtime Agent：通过 Node `vm` 执行代码并采集日志。
- ✅ Approval Gate（确认门禁）：修改前弹窗审批。
- ✅ Memory Module（长期记忆）：持久化到 Electron `userData/memory.json`。
- ✅ Environment Inspector：采集 Node/Electron/平台信息。
- ✅ Codebase Modifier（多文件协调）：批量写入目标文件。
- ✅ Documentation Writer：生成任务执行文档。
- ✅ LLM Manage（支持在线+本地）：可在在线/本地 provider 间切换。
- ✅ LLM 健康 IPC：主进程已提供 `llm:health` / `llm:probe`，可用于 UI 仪表盘拉取 provider 状态与熔断指标。

## 模块调度协议与标准规范

已补充完整规范文档（包含：统一消息信封、状态机、错误码、模块 MVP 契约、可观测性与安全基线）：

- 👉 `docs/dispatch-protocol.md`
- 👉 `docs/implementation-status.md`

### 本次新增的关键规范点

1. **统一消息协议**：所有模块统一 `protocolVersion/traceId/requestId/stage/payload/meta`。
2. **标准生命周期**：`INIT -> ENV_CHECK -> ... -> END`，并明确失败回流机制。
3. **错误码体系**：覆盖审批拒绝、编译失败、运行失败、IO/Provider 异常等。
4. **模块最小实现清单（MVP）**：每个模块都定义了职责、最小输入输出、实现要求。
5. **安全基线**：目录越界防护、沙箱执行、最小权限 IPC。

## 快速开始

```bash
npm install
npm run start
npm test
npm run test:e2e
npm run test:e2e:smoke
npm run test:e2e:full
```

> `npm run test:e2e` 当前包含三类 Electron E2E：UI 主流程（点击运行并生成文档）、审批拒绝分支验证，以及预加载 `lingYuAPI` 的真实进程级 IPC 桥接验证（环境检测/记忆读写/运行沙箱含超时分支/审批门禁/LLM 健康探测/代码修改冲突分支）。

项目已提供 GitHub Actions CI（`.github/workflows/ci.yml`）：`push/PR` 执行 `npm test + E2E smoke`；`schedule/workflow_dispatch` 执行 `E2E full`（失败自动重试一次）。

## 项目结构

```text
.
├─ docs
│  └─ dispatch-protocol.md     # 模块调度协议与实现规范
├─ main.js                     # Electron 主进程 + IPC
├─ preload.js                  # 安全桥接 API
├─ src
│  ├─ index.html               # 主界面
│  ├─ styles.css               # 样式
│  ├─ renderer.js              # Agent 编排与交互
│  ├─ agents                   # 各 Agent 实现
│  └─ core                     # Memory/Gate/Inspector/Modifier
└─ package.json
```

## 工作流

1. Environment Inspector 检测当前运行环境。
2. Clarifier / Retriever / Plan 生成任务上下文与计划。
3. Approval Gate 确认后，Act Agent 执行变更。
4. Compiler + Runtime 执行质量闸门（支持失败后自动修复重试）。
5. Documentation Writer 输出结果文档。
6. Memory Module 保存关键摘要（支持 TTL/数量裁剪/过期归档），Codebase Modifier 以 transactional + 冲突检测 + patch-level 合并方式回写产物。
