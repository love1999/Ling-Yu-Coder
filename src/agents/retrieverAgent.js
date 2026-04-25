import { BaseAgent } from './baseAgent.js';

export class RetrieverAgent extends BaseAgent {
  constructor(memoryStore) {
    super('Retriever Agent');
    this.memoryStore = memoryStore;
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      const memory = await this.memoryStore.loadRaw();
      const memoryHints = (memory.notes || []).slice(-5);

      return {
        references: ['memory', 'workspace', 'environment'],
        memoryHints,
        knowledgeDigest: `与“${payload.topic || '当前任务'}”相关的上下文已聚合`,
        workspaceSize: (payload.workspaceSnapshot || '').length
      };
    });
  }
}
