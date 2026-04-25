import { BaseAgent } from './baseAgent.js';
import { parse } from 'acorn';

export class CompilerAgent extends BaseAgent {
  constructor() {
    super('Compiler Agent');
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      try {
        parse(payload.code || '', { ecmaVersion: 'latest', sourceType: 'module', locations: true });
        return { ok: true, diagnostics: [] };
      } catch (error) {
        return {
          ok: false,
          diagnostics: [{
            message: error.message,
            line: error.loc?.line || 0,
            column: error.loc?.column || 0,
            severity: 'error'
          }]
        };
      }
    });
  }
}
