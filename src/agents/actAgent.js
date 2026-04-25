import { BaseAgent } from './baseAgent.js';

const quickHash = (text) => `${text.length}-${text.charCodeAt(0) || 0}-${text.charCodeAt(text.length - 1) || 0}`;

export class ActAgent extends BaseAgent {
  constructor() {
    super('Act Agent');
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      const before = payload.code || '';
      const suffix = `\n// [灵羽] Act Agent 执行标记 @ ${new Date().toLocaleString()}`;
      const updatedCode = `${before}${suffix}`;

      return {
        updatedCode,
        changes: [{
          path: 'in-memory-editor.js',
          beforeHash: quickHash(before),
          afterHash: quickHash(updatedCode),
          summary: '追加执行标记注释'
        }]
      };
    });
  }
}
