import { BaseAgent } from './baseAgent.js';

export class DocumentationWriter extends BaseAgent {
  constructor() {
    super('Documentation Writer');
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => {
      const lines = [
        '# 灵羽执行记录',
        `- 时间: ${new Date().toISOString()}`,
        `- 目标: ${payload.clarifier?.objective || 'N/A'}`,
        `- 计划步骤: ${(payload.plan?.steps || []).join(' -> ')}`,
        `- 编译结果: ${payload.compile?.ok ? '通过' : '失败'}`,
        `- 运行结果: ${payload.runtime?.ok ? '通过' : '失败'}`,
        '',
        '## 下一步建议',
        payload.runtime?.ok ? '- 可继续扩展自动化测试。' : '- 先修复运行失败，再进入下一轮执行。'
      ];

      return { markdown: lines.join('\n') };
    });
  }
}
