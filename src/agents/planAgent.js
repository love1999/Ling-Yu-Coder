import { BaseAgent } from './baseAgent.js';

export class PlanAgent extends BaseAgent {
  constructor() {
    super('Plan Agent');
  }

  async run(envelope) {
    return this.execute(envelope, async (payload) => ({
      steps: [
        '澄清需求与边界',
        '检索历史与依赖',
        '变更代码并执行语法检查',
        '运行测试/示例',
        '整理文档并等待审批'
      ],
      risks: ['语法错误', '运行时异常', '审批拒绝'],
      rollbackPlan: '恢复变更前代码并记录失败原因',
      basedOn: payload.clarifier?.objective || '用户输入'
    }));
  }
}
