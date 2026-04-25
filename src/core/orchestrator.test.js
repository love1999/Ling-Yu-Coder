import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentOrchestrator } from './orchestrator.js';

const okModule = (name, result) => ({
  name,
  async run(envelope) {
    return {
      ok: true,
      traceId: envelope.traceId,
      requestId: envelope.requestId,
      stage: envelope.stage,
      result,
      error: null,
      metrics: { latencyMs: 1 }
    };
  }
});

test('orchestrator runs full pipeline and returns artifacts', async () => {
  const orchestrator = new AgentOrchestrator({
    inspector: okModule('Environment Inspector', { os: 'linux' }),
    clarifier: okModule('Clarifier Agent', { objective: 'build' }),
    retriever: okModule('Retriever Agent', { knowledgeDigest: 'digest' }),
    planner: okModule('Plan Agent', { steps: ['a', 'b'] }),
    approvalGate: okModule('Approval Gate', { approved: true }),
    actor: okModule('Act Agent', { updatedCode: 'console.log(1);' }),
    compiler: okModule('Compiler Agent', { ok: true, diagnostics: [] }),
    runtime: okModule('Runtime Agent', { ok: true, logs: [] }),
    llmManager: okModule('LLM Manage', { completion: 'done' }),
    docWriter: okModule('Documentation Writer', { markdown: '# ok' }),
    memoryModule: okModule('Memory Module', { noteCount: 1 }),
    modifier: okModule('Codebase Modifier', { applied: ['lingyu-last-doc.md'], failed: [] })
  });

  const result = await orchestrator.run({ prompt: 'p', code: 'c' });
  assert.equal(result.artifacts.doc.markdown, '# ok');
  assert.equal(result.logs.length, 12);
  assert.equal(result.summary.totalStages, 12);
});

test('orchestrator stops when approval denied', async () => {
  const orchestrator = new AgentOrchestrator({
    inspector: okModule('Environment Inspector', {}),
    clarifier: okModule('Clarifier Agent', { objective: 'build' }),
    retriever: okModule('Retriever Agent', {}),
    planner: okModule('Plan Agent', { steps: ['a'] }),
    approvalGate: okModule('Approval Gate', { approved: false }),
    actor: okModule('Act Agent', { updatedCode: '' }),
    compiler: okModule('Compiler Agent', { ok: true, diagnostics: [] }),
    runtime: okModule('Runtime Agent', { ok: true, logs: [] }),
    llmManager: okModule('LLM Manage', { completion: 'done' }),
    docWriter: okModule('Documentation Writer', { markdown: '# ok' }),
    memoryModule: okModule('Memory Module', { noteCount: 1 }),
    modifier: okModule('Codebase Modifier', { applied: [], failed: [] })
  });

  await assert.rejects(
    () => orchestrator.run({ prompt: 'p', code: 'c' }),
    (error) => error.code === 'E_APPROVAL_DENIED'
  );
});

test('orchestrator retries via compile repair flow when compile fails once', async () => {
  let compileCount = 0;
  const actor = {
    name: 'Act Agent',
    async run(envelope) {
      const repaired = envelope.payload.repair ? 'const ok = 1;' : 'const broken = ;';
      return {
        ok: true,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        stage: envelope.stage,
        result: { updatedCode: repaired },
        error: null,
        metrics: { latencyMs: 1 }
      };
    }
  };

  const compiler = {
    name: 'Compiler Agent',
    async run(envelope) {
      compileCount += 1;
      if (compileCount === 1) {
        return {
          ok: true,
          traceId: envelope.traceId,
          requestId: envelope.requestId,
          stage: envelope.stage,
          result: { ok: false, diagnostics: [{ message: 'unexpected token' }] },
          error: null,
          metrics: { latencyMs: 1 }
        };
      }
      return {
        ok: true,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        stage: envelope.stage,
        result: { ok: true, diagnostics: [] },
        error: null,
        metrics: { latencyMs: 1 }
      };
    }
  };

  const orchestrator = new AgentOrchestrator({
    inspector: okModule('Environment Inspector', { os: 'linux' }),
    clarifier: okModule('Clarifier Agent', { objective: 'build' }),
    retriever: okModule('Retriever Agent', { knowledgeDigest: 'digest' }),
    planner: okModule('Plan Agent', { steps: ['a', 'b'] }),
    approvalGate: okModule('Approval Gate', { approved: true }),
    actor,
    compiler,
    runtime: okModule('Runtime Agent', { ok: true, logs: [] }),
    llmManager: okModule('LLM Manage', { completion: 'done' }),
    docWriter: okModule('Documentation Writer', { markdown: '# ok' }),
    memoryModule: okModule('Memory Module', { noteCount: 1 }),
    modifier: okModule('Codebase Modifier', { applied: ['lingyu-last-doc.md'], failed: [] })
  });

  const result = await orchestrator.run({ prompt: 'p', code: 'c', options: { maxFixAttempts: 1 } });
  assert.equal(result.artifacts.act.updatedCode, 'const ok = 1;');
});

test('orchestrator retries via runtime repair flow when runtime fails once', async () => {
  let runtimeCount = 0;
  const actor = {
    name: 'Act Agent',
    async run(envelope) {
      const repaired = envelope.payload.repair ? 'console.log("fixed");' : 'throw new Error("bad")';
      return {
        ok: true,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        stage: envelope.stage,
        result: { updatedCode: repaired },
        error: null,
        metrics: { latencyMs: 1 }
      };
    }
  };

  const runtime = {
    name: 'Runtime Agent',
    async run(envelope) {
      runtimeCount += 1;
      const ok = runtimeCount > 1;
      return {
        ok: true,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        stage: envelope.stage,
        result: { ok, logs: [], failures: ok ? [] : ['boom'] },
        error: null,
        metrics: { latencyMs: 1 }
      };
    }
  };

  const orchestrator = new AgentOrchestrator({
    inspector: okModule('Environment Inspector', { os: 'linux' }),
    clarifier: okModule('Clarifier Agent', { objective: 'build' }),
    retriever: okModule('Retriever Agent', { knowledgeDigest: 'digest' }),
    planner: okModule('Plan Agent', { steps: ['a', 'b'] }),
    approvalGate: okModule('Approval Gate', { approved: true }),
    actor,
    compiler: okModule('Compiler Agent', { ok: true, diagnostics: [] }),
    runtime,
    llmManager: okModule('LLM Manage', { completion: 'done' }),
    docWriter: okModule('Documentation Writer', { markdown: '# ok' }),
    memoryModule: okModule('Memory Module', { noteCount: 1 }),
    modifier: okModule('Codebase Modifier', { applied: ['lingyu-last-doc.md'], failed: [] })
  });

  const result = await orchestrator.run({ prompt: 'p', code: 'c', options: { maxRuntimeFixAttempts: 1 } });
  assert.equal(result.artifacts.act.updatedCode, 'console.log("fixed");');
});
