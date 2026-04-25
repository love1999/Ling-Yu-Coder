import { validateEnvelope, createOkResponse, createErrorResponse } from '../core/protocol.js';

export class BaseAgent {
  constructor(name) {
    this.name = name;
  }

  async execute(envelope, handler) {
    const start = Date.now();
    try {
      validateEnvelope(envelope);
      const result = await handler(envelope.payload, envelope);
      return createOkResponse(envelope, result, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
