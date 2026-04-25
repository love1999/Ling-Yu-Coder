import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';

import { ClarifierAgent } from './agents/clarifierAgent.js';
import { RetrieverAgent } from './agents/retrieverAgent.js';
import { PlanAgent } from './agents/planAgent.js';
import { ActAgent } from './agents/actAgent.js';
import { CompilerAgent } from './agents/compilerAgent.js';
import { RuntimeAgent } from './agents/runtimeAgent.js';
import { DocumentationWriter } from './agents/documentationWriter.js';
import { LLMManager } from './agents/llmManager.js';
import { MemoryModule } from './core/memoryModule.js';
import { EnvironmentInspector } from './core/environmentInspector.js';
import { CodebaseModifier } from './core/codebaseModifier.js';
import { ApprovalGate } from './core/approvalGate.js';
import { AgentOrchestrator } from './core/orchestrator.js';

const logEl = document.getElementById('log');
const docEl = document.getElementById('doc');
const providerSelect = document.getElementById('providerSelect');
const refreshHealthBtn = document.getElementById('refreshHealthBtn');
const healthSummaryEl = document.getElementById('healthSummary');
const healthMetricsEl = document.getElementById('healthMetrics');
const healthAlertsEl = document.getElementById('healthAlerts');

const memoryModule = new MemoryModule(window.lingYuAPI);
const inspector = new EnvironmentInspector(window.lingYuAPI);
const modifier = new CodebaseModifier(window.lingYuAPI);
const approvalGate = new ApprovalGate(window.lingYuAPI);
const llmManager = new LLMManager();

llmManager.startHealthProbe(15000);
window.addEventListener('beforeunload', () => llmManager.stopHealthProbe());

const alertQueue = [];

const pushHealthAlert = (message, level = 'warn') => {
  const entry = `[${new Date().toLocaleTimeString()}][${level}] ${message}`;
  alertQueue.unshift(entry);
  if (alertQueue.length > 8) alertQueue.length = 8;
  healthAlertsEl.innerHTML = alertQueue.map((item) => `<li>${item}</li>`).join('');
};

const summaryClass = (providers = {}) => {
  const states = Object.values(providers).map((item) => item.state);
  if (states.includes('open')) return 'health-danger';
  if (states.includes('degraded')) return 'health-warn';
  return 'health-ok';
};

const renderHealth = (health) => {
  if (!health?.ok) {
    healthSummaryEl.className = 'health-danger';
    healthSummaryEl.textContent = `LLM 健康查询失败: ${health?.reason || 'unknown'}`;
    return;
  }

  const online = health.providers?.online?.state || 'unknown';
  const local = health.providers?.local?.state || 'unknown';
  healthSummaryEl.className = summaryClass(health.providers);
  healthSummaryEl.textContent = `active=${health.active} | online=${online} | local=${local}`;
  healthMetricsEl.textContent = JSON.stringify(health.metrics, null, 2);
};

const pollHealthDashboard = async (triggerProbe = false) => {
  try {
    if (triggerProbe) {
      await window.lingYuAPI.probeLLMProviders();
    }

    const health = await window.lingYuAPI.getLLMHealth();
    renderHealth(health);

    if (health?.ok) {
      if (health.providers?.online?.state === 'open') {
        pushHealthAlert('在线 provider 处于熔断(open)状态', 'danger');
      } else if (health.providers?.online?.state === 'degraded') {
        pushHealthAlert('在线 provider 健康退化(degraded)', 'warn');
      }

      if ((health.metrics?.probeSuccessRate ?? 1) < 0.8) {
        pushHealthAlert(`probeSuccessRate 下降至 ${health.metrics.probeSuccessRate}`, 'warn');
      }
    }
  } catch (error) {
    pushHealthAlert(`健康轮询异常: ${error.message}`, 'danger');
  }
};

const orchestrator = new AgentOrchestrator({
  inspector,
  clarifier: new ClarifierAgent(),
  retriever: new RetrieverAgent(memoryModule),
  planner: new PlanAgent(),
  approvalGate,
  actor: new ActAgent(),
  compiler: new CompilerAgent(),
  runtime: new RuntimeAgent(window.lingYuAPI.runSnippet),
  llmManager,
  docWriter: new DocumentationWriter(),
  memoryModule,
  modifier
});

const editor = new EditorView({
  state: EditorState.create({
    doc: `// 欢迎使用 灵羽\nfunction hello() {\n  console.log('Ling-Yu online');\n}\nhello();\n`,
    extensions: [keymap.of(defaultKeymap), javascript()]
  }),
  parent: document.getElementById('editor')
});

const log = (title, payload) => {
  logEl.textContent += `\n[${title}]\n${JSON.stringify(payload, null, 2)}\n`;
};

providerSelect.addEventListener('change', (event) => {
  const selected = event.target.value;
  llmManager.switchProvider(selected);
  log('LLM Manage', { active: selected, providers: llmManager.listProviders() });
});

refreshHealthBtn.addEventListener('click', async () => {
  await pollHealthDashboard(true);
});

document.getElementById('rememberBtn').addEventListener('click', async () => {
  const code = editor.state.doc.toString();
  const next = await memoryModule.remember({ summary: '用户手动保存片段', code });
  log('Memory Module', { saved: true, noteCount: next.notes.length });
});

document.getElementById('runPipeline').addEventListener('click', async () => {
  logEl.textContent = '';
  const code = editor.state.doc.toString();

  try {
    const result = await orchestrator.run({
      prompt: '构建多 Agent 智能编码工作流',
      code,
      root: '',
      options: {
        maxFixAttempts: 1,
        maxRuntimeFixAttempts: 1,
        dryRun: false,
        memory: { ttlDays: 30, maxNotes: 200 }
      }
    });

    const updatedCode = result.artifacts.act.updatedCode;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: updatedCode }
    });

    docEl.textContent = result.artifacts.doc.markdown;
    log('Summary', result.summary);
    result.logs.forEach((item) => log(item.stage, item.response));
  } catch (error) {
    log('Pipeline Error', { message: error.message, code: error.code || 'UNKNOWN' });
    docEl.textContent = `流程中断：${error.message}`;
  }
});

pollHealthDashboard(true);
const healthTimer = setInterval(() => {
  pollHealthDashboard(false);
}, 15000);

window.addEventListener('beforeunload', () => {
  clearInterval(healthTimer);
});
