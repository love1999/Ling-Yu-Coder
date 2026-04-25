import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { AgentOrchestrator } from './orchestrator.js';
import { ClarifierAgent } from '../agents/clarifierAgent.js';
import { RetrieverAgent } from '../agents/retrieverAgent.js';
import { PlanAgent } from '../agents/planAgent.js';
import { ActAgent } from '../agents/actAgent.js';
import { RuntimeAgent } from '../agents/runtimeAgent.js';
import { DocumentationWriter } from '../agents/documentationWriter.js';
import { LLMManager } from '../agents/llmManager.js';
import { MemoryModule } from './memoryModule.js';
import { EnvironmentInspector } from './environmentInspector.js';
import { ApprovalGate } from './approvalGate.js';
import { CodebaseModifier } from './codebaseModifier.js';

const createFakeApi = () => {
  const memory = { notes: [], decisions: [], contexts: [], archive: [] };

  return {
    inspectEnvironment: async () => ({ platform: 'test-os', arch: 'x64', node: '22', electron: '37', chrome: '136', appVersion: '0.1.0' }),
    loadMemory: async () => memory,
    saveMemory: async (next) => {
      memory.notes = next.notes || [];
      memory.decisions = next.decisions || [];
      memory.contexts = next.contexts || [];
      memory.archive = next.archive || [];
      return true;
    },
    runSnippet: async (code) => {
      const logs = [];
      const context = vm.createContext({ console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) } });
      try {
        new vm.Script(code).runInContext(context, { timeout: 1000 });
        return { ok: true, logs };
      } catch (error) {
        return { ok: false, logs, error: error.message };
      }
    },
    requestApproval: async () => true,
    modifyCodebase: async () => ({ ok: true, applied: ['lingyu-last-doc.md'], failed: [], root: '/tmp' })
  };
};

const createCompilerModule = () => ({
  name: 'Compiler Agent',
  async run(envelope) {
    try {
      new vm.Script(envelope.payload.code || '');
      return {
        ok: true,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        stage: envelope.stage,
        result: { ok: true, diagnostics: [] },
        error: null,
        metrics: { latencyMs: 1 }
      };
    } catch (error) {
      return {
        ok: true,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        stage: envelope.stage,
        result: { ok: false, diagnostics: [{ message: error.message }] },
        error: null,
        metrics: { latencyMs: 1 }
      };
    }
  }
});

const createRealOrchestrator = (api) => {
  const memoryModule = new MemoryModule(api);

  return new AgentOrchestrator({
    inspector: new EnvironmentInspector(api),
    clarifier: new ClarifierAgent(),
    retriever: new RetrieverAgent(memoryModule),
    planner: new PlanAgent(),
    approvalGate: new ApprovalGate(api),
    actor: new ActAgent(),
    compiler: createCompilerModule(),
    runtime: new RuntimeAgent(api.runSnippet),
    llmManager: new LLMManager(),
    docWriter: new DocumentationWriter(),
    memoryModule,
    modifier: new CodebaseModifier(api)
  });
};

test('integration: compile failure can be auto repaired by real modules', async () => {
  const api = createFakeApi();
  const orchestrator = createRealOrchestrator(api);

  const result = await orchestrator.run({
    prompt: '修复语法问题',
    code: 'const broken = ;',
    options: { maxFixAttempts: 1, maxRuntimeFixAttempts: 0 }
  });

  assert.equal(result.artifacts.compile.ok, true);
  assert.match(result.artifacts.act.updatedCode, /const broken = null;/);
});

test('integration: runtime failure can be auto repaired by real modules', async () => {
  const api = createFakeApi();
  const orchestrator = createRealOrchestrator(api);

  const result = await orchestrator.run({
    prompt: '修复运行异常',
    code: 'throw new Error("boom");',
    options: { maxFixAttempts: 0, maxRuntimeFixAttempts: 1 }
  });

  assert.equal(result.artifacts.runtime.ok, true);
  assert.doesNotMatch(result.artifacts.act.updatedCode, /throw new Error/);
});
