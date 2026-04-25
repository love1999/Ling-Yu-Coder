import { createErrorResponse, createOkResponse, validateEnvelope } from './protocol.js';

export class EnvironmentInspector {
  constructor(api) {
    this.name = 'Environment Inspector';
    this.api = api;
  }

  async run(envelope) {
    const start = Date.now();
    try {
      validateEnvelope(envelope);
      const env = await this.api.inspectEnvironment();
      return createOkResponse(envelope, {
        os: env.platform,
        arch: env.arch,
        nodeVersion: env.node,
        electronVersion: env.electron,
        appVersion: env.appVersion,
        chromeVersion: env.chrome
      }, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
