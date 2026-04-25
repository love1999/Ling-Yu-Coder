import { createEnvelope, Stage, ErrorCode } from './protocol.js';

export class AgentOrchestrator {
  constructor(deps) {
    this.deps = deps;
  }

  async invoke({ target, stage, payload, traceId, logs, retry = 0 }) {
    let attempt = 0;
    let lastResponse = null;

    while (attempt <= retry) {
      const envelope = createEnvelope({
        source: 'orchestrator',
        target: target.name || target.constructor.name,
        stage,
        payload,
        traceId,
        meta: { retry: attempt }
      });

      const response = await target.run(envelope);
      logs.push({
        stage,
        target: target.name || target.constructor.name,
        ok: response.ok,
        attempt,
        latencyMs: response.metrics?.latencyMs ?? 0,
        response
      });

      lastResponse = response;
      if (response.ok) return response;
      attempt += 1;
    }

    return lastResponse;
  }

  buildSummary(logs) {
    const totalStages = logs.length;
    const failedStages = logs.filter((entry) => !entry.ok).length;
    const retryCount = logs.filter((entry) => entry.attempt > 0).length;
    const totalLatencyMs = logs.reduce((sum, entry) => sum + (entry.latencyMs || 0), 0);

    return {
      totalStages,
      failedStages,
      retryCount,
      totalLatencyMs
    };
  }

  assertStageOk(response, stage, errorCode = ErrorCode.UNKNOWN) {
    if (!response?.ok) {
      const error = new Error(response?.error?.message || `${stage} 执行失败`);
      error.code = response?.error?.code || errorCode;
      throw error;
    }
  }

  async tryCompileFix({ traceId, logs, baseCode, plan, maxFixAttempts }) {
    let workingCode = baseCode;

    for (let i = 0; i <= maxFixAttempts; i += 1) {
      const compile = await this.invoke({
        target: this.deps.compiler,
        stage: Stage.COMPILE,
        payload: { code: workingCode },
        traceId,
        logs
      });
      this.assertStageOk(compile, Stage.COMPILE, ErrorCode.COMPILER);

      if (compile.result.ok) {
        return { compile, finalCode: workingCode, compileRepairCount: i };
      }

      if (i === maxFixAttempts) break;

      const repair = await this.invoke({
        target: this.deps.actor,
        stage: Stage.ACT,
        payload: {
          code: workingCode,
          plan,
          repair: true,
          diagnostics: compile.result.diagnostics
        },
        traceId,
        logs
      });
      this.assertStageOk(repair, Stage.ACT);
      workingCode = repair.result.updatedCode;
    }

    const compileError = new Error('语法检查未通过，且自动修复失败');
    compileError.code = ErrorCode.COMPILER;
    throw compileError;
  }

  async tryRuntimeFix({ traceId, logs, baseCode, plan, maxRuntimeFixAttempts }) {
    let workingCode = baseCode;

    for (let i = 0; i <= maxRuntimeFixAttempts; i += 1) {
      const runtime = await this.invoke({
        target: this.deps.runtime,
        stage: Stage.RUNTIME,
        payload: { code: workingCode },
        traceId,
        logs
      });
      this.assertStageOk(runtime, Stage.RUNTIME, ErrorCode.RUNTIME);

      if (runtime.result.ok) {
        return { runtime, finalCode: workingCode, runtimeRepairCount: i };
      }

      if (i === maxRuntimeFixAttempts) {
        return { runtime, finalCode: workingCode, runtimeRepairCount: i };
      }

      const repair = await this.invoke({
        target: this.deps.actor,
        stage: Stage.ACT,
        payload: {
          code: workingCode,
          plan,
          repair: true,
          runtimeFailures: runtime.result.failures || []
        },
        traceId,
        logs
      });
      this.assertStageOk(repair, Stage.ACT);
      workingCode = repair.result.updatedCode;

      const compile = await this.invoke({
        target: this.deps.compiler,
        stage: Stage.COMPILE,
        payload: { code: workingCode },
        traceId,
        logs
      });
      this.assertStageOk(compile, Stage.COMPILE, ErrorCode.COMPILER);

      if (!compile.result.ok) {
        const error = new Error('运行修复后语法检查失败');
        error.code = ErrorCode.COMPILER;
        throw error;
      }
    }

    const runtimeError = new Error('运行时修复流程异常');
    runtimeError.code = ErrorCode.RUNTIME;
    throw runtimeError;
  }

  async run({ prompt, code, root = '', options = {} }) {
    const traceId = createEnvelope({ source: 'orchestrator', target: 'orchestrator', stage: 'init' }).traceId;
    const logs = [];
    const maxFixAttempts = options.maxFixAttempts ?? 1;
    const maxRuntimeFixAttempts = options.maxRuntimeFixAttempts ?? 1;

    const env = await this.invoke({ target: this.deps.inspector, stage: Stage.ENV, payload: {}, traceId, logs });
    this.assertStageOk(env, Stage.ENV);

    const clarifier = await this.invoke({
      target: this.deps.clarifier,
      stage: Stage.CLARIFY,
      payload: { userPrompt: prompt },
      traceId,
      logs
    });
    this.assertStageOk(clarifier, Stage.CLARIFY);

    const retriever = await this.invoke({
      target: this.deps.retriever,
      stage: Stage.RETRIEVE,
      payload: {
        topic: clarifier.result.objective,
        workspaceSnapshot: code,
        env: env.result
      },
      traceId,
      logs
    });
    this.assertStageOk(retriever, Stage.RETRIEVE);

    const plan = await this.invoke({
      target: this.deps.planner,
      stage: Stage.PLAN,
      payload: { clarifier: clarifier.result, retriever: retriever.result },
      traceId,
      logs
    });
    this.assertStageOk(plan, Stage.PLAN);

    const approve = await this.invoke({
      target: this.deps.approvalGate,
      stage: Stage.APPROVE,
      payload: { message: `是否允许执行代码修改？预计步骤 ${plan.result.steps.length} 个。` },
      traceId,
      logs
    });
    this.assertStageOk(approve, Stage.APPROVE);

    if (!approve.result.approved) {
      const denied = new Error('审批未通过');
      denied.code = ErrorCode.APPROVAL_DENIED;
      throw denied;
    }

    const act = await this.invoke({
      target: this.deps.actor,
      stage: Stage.ACT,
      payload: { code, plan: plan.result },
      traceId,
      logs
    });
    this.assertStageOk(act, Stage.ACT);

    const { compile, finalCode: compileFinalCode, compileRepairCount } = await this.tryCompileFix({
      traceId,
      logs,
      baseCode: act.result.updatedCode,
      plan: plan.result,
      maxFixAttempts
    });

    const { runtime, finalCode, runtimeRepairCount } = await this.tryRuntimeFix({
      traceId,
      logs,
      baseCode: compileFinalCode,
      plan: plan.result,
      maxRuntimeFixAttempts
    });

    const llm = await this.invoke({
      target: this.deps.llmManager,
      stage: Stage.LLM,
      payload: { prompt: '总结本次执行' },
      traceId,
      logs,
      retry: 1
    });
    this.assertStageOk(llm, Stage.LLM, ErrorCode.PROVIDER);

    const doc = await this.invoke({
      target: this.deps.docWriter,
      stage: Stage.DOC,
      payload: {
        clarifier: clarifier.result,
        plan: plan.result,
        compile: compile.result,
        runtime: runtime.result,
        llm: llm.result,
        compileRepairCount,
        runtimeRepairCount
      },
      traceId,
      logs
    });
    this.assertStageOk(doc, Stage.DOC);

    const memory = await this.invoke({
      target: this.deps.memoryModule,
      stage: Stage.MEMORY,
      payload: {
        entry: {
          summary: clarifier.result.objective,
          compile: compile.result.ok,
          runtime: runtime.result.ok,
          compileRepairCount,
          runtimeRepairCount
        },
        options: options.memory || {}
      },
      traceId,
      logs
    });
    this.assertStageOk(memory, Stage.MEMORY);

    const modify = await this.invoke({
      target: this.deps.modifier,
      stage: Stage.MODIFY,
      payload: {
        root,
        changes: [{ path: 'lingyu-last-doc.md', content: doc.result.markdown }],
        options: {
          transactional: true,
          dryRun: Boolean(options.dryRun)
        }
      },
      traceId,
      logs
    });
    this.assertStageOk(modify, Stage.MODIFY, ErrorCode.IO);

    return {
      traceId,
      logs,
      summary: this.buildSummary(logs),
      artifacts: {
        env: env.result,
        clarifier: clarifier.result,
        retriever: retriever.result,
        plan: plan.result,
        act: { ...act.result, updatedCode: finalCode },
        compile: compile.result,
        runtime: runtime.result,
        llm: llm.result,
        doc: doc.result,
        memory: memory.result,
        modify: modify.result
      }
    };
  }
}
