import { BaseAgent } from './baseAgent.js';

export class RuntimeAgent extends BaseAgent {
  constructor(runtimeExecutor) {
    super('Test/Runtime Agent');
    this.runtimeExecutor = runtimeExecutor;
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      const result = await this.runtimeExecutor(payload.code || 'console.log("empty")');
      return {
        ok: result.ok,
        logs: result.logs || [],
        failures: result.ok ? [] : [result.error || 'unknown runtime error']
      };
    });
  }
}
