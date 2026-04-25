# 灵羽模块调度协议标准（v0.2 草案）

> 适用于 Electron + CodeMirror 架构下的多 Agent 编排。该规范定义：
> 1) 模块间消息格式；2) 生命周期与状态机；3) 错误语义；4) 每个模块的最小实现要求（MVP）。

## 1. 术语与角色

- **Orchestrator**：调度器（当前在 `renderer.js` 中），负责串联 Agent 流程。
- **Agent**：执行特定能力的模块（Clarifier / Retriever / Plan / Act / Compiler / Runtime / Doc）。
- **Gate**：门禁模块（Approval Gate）。
- **Infra Modules**：基础能力（Memory、Environment Inspector、Codebase Modifier、LLM Manage）。

## 2. 标准消息信封（Message Envelope）

所有模块输入输出必须统一使用以下结构：

```json
{
  "protocolVersion": "1.0",
  "traceId": "uuid",
  "requestId": "uuid",
  "timestamp": "2026-04-24T17:00:00.000Z",
  "source": "orchestrator|agent-name",
  "target": "agent-name|module-name",
  "stage": "clarify|retrieve|plan|act|compile|runtime|approve|memory|doc|env|modify|llm",
  "payload": {},
  "meta": {
    "priority": "low|normal|high",
    "timeoutMs": 30000,
    "retry": 0
  }
}
```

### 2.1 响应结构

```json
{
  "ok": true,
  "traceId": "uuid",
  "requestId": "uuid",
  "stage": "plan",
  "result": {},
  "error": null,
  "metrics": {
    "latencyMs": 42
  }
}
```

### 2.2 错误码规范

| 错误码 | 含义 | 建议处理 |
|---|---|---|
| `E_VALIDATION` | 入参校验失败 | 直接终止，返回缺失字段 |
| `E_TIMEOUT` | 模块执行超时 | 可重试（最多 2 次） |
| `E_APPROVAL_DENIED` | 审批未通过 | 停止后续写操作 |
| `E_COMPILER` | 语法编译失败 | 回退到 Plan/Act 修复环节 |
| `E_RUNTIME` | 运行测试失败 | 触发修复计划 |
| `E_IO` | 文件或持久化失败 | 记录并降级到内存态 |
| `E_PROVIDER` | LLM Provider 不可用 | 自动切换备用 provider |

## 3. 调度生命周期规范

```text
INIT -> ENV_CHECK -> CLARIFY -> RETRIEVE -> PLAN -> APPROVAL
    -> (DENIED => END)
    -> ACT -> COMPILE -> RUNTIME -> DOC -> MEMORY_PERSIST -> CODEBASE_MODIFY -> END
```

### 3.1 状态转换约束

1. `APPROVAL` 未通过，不得进入 `ACT`/`CODEBASE_MODIFY`。
2. `COMPILE` 失败必须回流到 `PLAN` 或 `ACT`（最多 N 次，默认 2）。
3. `RUNTIME` 失败允许产出文档，但文档须标记失败。
4. `MEMORY_PERSIST` 失败不得阻断主流程完成（降级策略）。

## 4. 模块实现清单（MVP）

## 4.1 Clarifier Agent

**职责**
- 将用户需求拆分为：目标、约束、验收标准、待确认问题。

**最小输入**
- `userPrompt`

**最小输出**
- `objective`
- `constraints[]`
- `acceptanceCriteria[]`
- `openQuestions[]`

**实现要求**
- 至少做一次结构化拆分（不得只原样回显）。
- 对“模糊描述”给出待确认项。

## 4.2 Retriever Agent

**职责**
- 聚合长期记忆、当前工作区上下文、环境信息，形成可检索知识包。

**最小输入**
- `topic`
- `workspaceSnapshot`

**最小输出**
- `references[]`
- `memoryHints[]`
- `knowledgeDigest`

**实现要求**
- 需支持限定检索窗口（默认最近 5 条记忆）。
- 必须标记引用来源（memory/workspace/env）。

## 4.3 Plan Agent

**职责**
- 生成可执行计划（步骤、风险、回滚策略）。

**最小输出**
- `steps[]`
- `risks[]`
- `rollbackPlan`

**实现要求**
- 每一步必须可追踪到具体输入来源。
- 必须定义“完成判定条件”。

## 4.4 Act Agent

**职责**
- 按计划执行代码改动（可多文件）。

**最小输出**
- `changes[]`（path, beforeHash, afterHash, summary）

**实现要求**
- 修改前后摘要必须可审计。
- 仅允许在批准后执行。

## 4.5 Compiler Agent（语法检查）

**职责**
- 对改动后的代码执行语法级校验。

**最小输出**
- `ok`
- `diagnostics[]`（message, line, column, severity）

**实现要求**
- 至少覆盖 JS/TS 语法检查中的一种。
- 错误定位应可映射到编辑器。

## 4.6 Test/Runtime Agent

**职责**
- 执行最小运行验证或测试脚本。

**最小输出**
- `ok`
- `logs[]`
- `failures[]`

**实现要求**
- 支持超时控制（默认 1s~5s 可配）。
- 执行环境需沙箱隔离。

## 4.7 Approval Gate

**职责**
- 在高风险动作前（写文件、执行代码）提供确认门禁。

**最小输出**
- `approved: boolean`
- `approver`（可匿名）

**实现要求**
- 审批消息须包含影响范围摘要（受影响文件数、风险级别）。

## 4.8 Memory Module（长期记忆）

**职责**
- 结构化保存任务摘要、决策记录、失败案例。

**最小数据模型**
- `notes[]`
- `decisions[]`
- `contexts[]`

**实现要求**
- 至少保证本地持久化与可恢复。
- 需提供 TTL/归档策略（可后续增强）。

## 4.9 Environment Inspector

**职责**
- 输出系统与运行时能力快照，辅助计划与兼容性判断。

**最小输出**
- `os`
- `arch`
- `nodeVersion`
- `electronVersion`

**实现要求**
- 输出结构需稳定可序列化。

## 4.10 Codebase Modifier（多文件协调）

**职责**
- 按变更集执行多文件写入，保证路径安全与原子性策略。

**最小输入**
- `root`
- `changes[]`

**最小输出**
- `applied[]`
- `failed[]`

**实现要求**
- 必须进行路径越界校验。
- 建议提供“全部成功/部分成功”策略标记。

## 4.11 Documentation Writer

**职责**
- 自动输出执行报告（目标、计划、结果、风险、后续建议）。

**最小输出**
- Markdown 文档文本

**实现要求**
- 必含“失败原因与下一步”章节（当流程失败时）。

## 4.12 LLM Manage（在线+本地）

**职责**
- 管理 provider 注册、切换、健康检查、降级策略。

**最小输出**
- `activeProvider`
- `providers[]`
- `healthStatus`

**实现要求**
- 主 provider 不可用时可自动回退到备用 provider。
- 每次调用需记录 provider 元信息用于审计。

## 5. 接口契约（建议）

```ts
interface Agent<I, O> {
  name: string;
  stage: string;
  run(input: I, ctx: RuntimeContext): Promise<O>;
}
```

```ts
interface RuntimeContext {
  traceId: string;
  requestId: string;
  memory: MemoryAccessor;
  env: EnvSnapshot;
  llm: LLMRouter;
  logger: Logger;
}
```

## 6. 可观测性规范

- 每个 stage 输出：开始时间、结束时间、耗时、状态、重试次数。
- traceId 必须贯穿完整链路。
- 错误日志至少包含：errorCode、stage、summary、raw。

## 7. 安全与合规基线

- 默认最小权限：Renderer 不直接写磁盘，必须经 IPC 主进程。
- 执行代码必须沙箱 + 超时。
- Codebase Modifier 必须防目录穿越。

## 8. 与当前实现的映射建议

- 当前 `renderer.js` 已具备串行流水线，可升级为标准消息信封驱动。
- 当前 `main.js` 的 `runtime:run` 与 `codebase:modify` 已具备基本安全约束；建议补充失败列表与原子写策略。
- 当前 `LLMManager` 已有在线/本地切换；建议补充健康检查与自动降级。

## 9. Webhook 告警签名规范（v1）

为支持外部告警通道验签，约定：

- Header:
  - `x-lingyu-signature-version: v1`
  - `x-lingyu-signature: <hex(hmac_sha256(secret, rawBody))>`
- Body: 必须使用发送时原始 JSON 字符串参与签名（不要二次格式化）。

### 9.1 发送端建议（SDK snippet）

```js
import { createHmac } from 'node:crypto';

export const buildLingYuWebhookHeaders = ({ secret, rawBody }) => {
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  return {
    'content-type': 'application/json',
    'x-lingyu-signature-version': 'v1',
    'x-lingyu-signature': signature
  };
};
```

### 9.2 接收端验签示例（Node/Express）

```js
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const app = express();

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

const verifySignature = ({ secret, rawBody, receivedSignature }) => {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(receivedSignature || '', 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

app.post('/lingyu/webhook', (req, res) => {
  const version = req.header('x-lingyu-signature-version');
  const sig = req.header('x-lingyu-signature');
  if (version !== 'v1') return res.status(400).json({ ok: false, reason: 'unsupported signature version' });

  const ok = verifySignature({
    secret: process.env.LINGYU_WEBHOOK_SECRET,
    rawBody: req.rawBody,
    receivedSignature: sig
  });
  if (!ok) return res.status(401).json({ ok: false, reason: 'bad signature' });

  return res.json({ ok: true });
});
```
