import { ErrorCode, createErrorResponse, createOkResponse, validateEnvelope } from './protocol.js';

export class ApprovalGate {
  constructor(api) {
    this.name = 'Approval Gate';
    this.api = api;
  }

  async run(envelope) {
    const start = Date.now();
    try {
      validateEnvelope(envelope);
      const approved = await this.api.requestApproval(envelope.payload.message || '是否批准本次操作？');
      if (!approved) {
        return createOkResponse(envelope, {
          approved: false,
          approver: 'interactive-user',
          errorCode: ErrorCode.APPROVAL_DENIED
        }, Date.now() - start);
      }

      return createOkResponse(envelope, {
        approved: true,
        approver: 'interactive-user'
      }, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
