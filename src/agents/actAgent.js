import { BaseAgent } from './baseAgent.js';

const quickHash = (text) => `${text.length}-${text.charCodeAt(0) || 0}-${text.charCodeAt(text.length - 1) || 0}`;

const repairCode = (code, diagnostics = [], runtimeFailures = []) => {
  let repaired = code;
  const diagnosticText = diagnostics.map((item) => item.message || '').join(' | ');
  const runtimeText = runtimeFailures.join(' | ');

  if (diagnosticText.includes('Unexpected token') || diagnosticText.includes('unexpected token')) {
    repaired = repaired.replace(/=\s*;/g, '= null;');
  }

  if (runtimeText || repaired.includes('throw new Error')) {
    repaired = repaired.replace(/throw\s+new\s+Error\(([^)]*)\);?/g, 'console.error($1);');
  }

  return repaired;
};

export class ActAgent extends BaseAgent {
  constructor() {
    super('Act Agent');
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      const before = payload.code || '';
      const isRepair = Boolean(payload.repair);
      const updatedCode = isRepair
        ? repairCode(before, payload.diagnostics || [], payload.runtimeFailures || [])
        : `${before}\n// [灵羽] Act Agent 执行标记 @ ${new Date().toLocaleString()}`;

      return {
        updatedCode,
        changes: [{
          path: 'in-memory-editor.js',
          beforeHash: quickHash(before),
          afterHash: quickHash(updatedCode),
          summary: isRepair ? '根据失败信息执行自动修复' : '追加执行标记注释'
        }]
      };
    });
  }
}
