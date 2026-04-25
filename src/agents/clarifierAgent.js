import { BaseAgent } from './baseAgent.js';

export class ClarifierAgent extends BaseAgent {
  constructor() {
    super('Clarifier Agent');
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      const goals = (payload.userPrompt || '')
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean);

      return {
        objective: goals[0] || '实现用户目标',
        constraints: goals.slice(1),
        acceptanceCriteria: ['核心流程可执行', '结果可追溯'],
        openQuestions: ['目标优先级是否明确', '验收标准是否完整']
      };
    });
  }
}
