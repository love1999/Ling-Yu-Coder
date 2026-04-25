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

const memoryModule = new MemoryModule(window.lingYuAPI);
const inspector = new EnvironmentInspector(window.lingYuAPI);
const modifier = new CodebaseModifier(window.lingYuAPI);
const approvalGate = new ApprovalGate(window.lingYuAPI);
const llmManager = new LLMManager();

llmManager.startHealthProbe(15000);
window.addEventListener('beforeunload', () => llmManager.stopHealthProbe());

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
