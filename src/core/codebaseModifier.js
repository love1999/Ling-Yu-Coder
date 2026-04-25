import { createErrorResponse, createOkResponse, validateEnvelope } from './protocol.js';

export class CodebaseModifier {
  constructor(api) {
    this.name = 'Codebase Modifier';
    this.api = api;
  }

  async run(envelope) {
    const start = Date.now();
    try {
      validateEnvelope(envelope);
      const result = await this.api.modifyCodebase({
        root: envelope.payload.root,
        changes: envelope.payload.changes || [],
        options: envelope.payload.options || {}
      });

      return createOkResponse(envelope, {
        applied: result.applied || [],
        failed: result.failed || [],
        rolledBack: Boolean(result.rolledBack),
        dryRun: Boolean(result.dryRun),
        root: result.root
      }, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
