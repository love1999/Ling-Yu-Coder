import { ErrorCode, createErrorResponse, createOkResponse, validateEnvelope } from '../core/protocol.js';

export class LLMManager {
  constructor() {
    this.name = 'LLM Manage';
    this.providers = {
      online: { enabled: true, name: 'Online API Provider', healthy: true },
      local: { enabled: true, name: 'Local Model Provider', healthy: true }
    };
    this.active = 'online';
    this.healthTimer = null;
  }

  listProviders() {
    return this.providers;
  }

  switchProvider(mode) {
    if (!this.providers[mode]) throw new Error(`未知 provider: ${mode}`);
    this.active = mode;
    return this.providers[mode];
  }

  setProviderHealth(mode, healthy) {
    if (!this.providers[mode]) return;
    this.providers[mode].healthy = Boolean(healthy);
  }

  async checkProviderHealth(mode) {
    const provider = this.providers[mode];
    if (!provider || !provider.enabled) return false;
    return provider.healthy;
  }

  async probeAllProviders() {
    const checks = await Promise.all(
      Object.keys(this.providers).map(async (mode) => ({
        mode,
        healthy: await this.checkProviderHealth(mode)
      }))
    );

    checks.forEach((item) => {
      this.providers[item.mode].healthy = item.healthy;
    });

    return this.providers;
  }

  startHealthProbe(intervalMs = 30000) {
    this.stopHealthProbe();
    this.healthTimer = setInterval(() => {
      this.probeAllProviders().catch(() => {
        // ignore transient probe failures
      });
    }, intervalMs);
    return true;
  }

  stopHealthProbe() {
    if (!this.healthTimer) return false;
    clearInterval(this.healthTimer);
    this.healthTimer = null;
    return true;
  }

  resolveProvider() {
    const current = this.providers[this.active];
    if (current?.healthy && current.enabled) return this.active;

    const fallback = Object.entries(this.providers).find(([, provider]) => provider.enabled && provider.healthy);
    if (!fallback) return null;

    this.active = fallback[0];
    return this.active;
  }

  async run(envelope) {
    const start = Date.now();
    try {
      validateEnvelope(envelope);
      const prompt = envelope.payload.prompt || '';
      const chosen = this.resolveProvider();

      if (!chosen) {
        const error = new Error('没有可用的 LLM provider');
        error.code = ErrorCode.PROVIDER;
        throw error;
      }

      return createOkResponse(envelope, {
        activeProvider: chosen,
        providers: this.providers,
        healthStatus: 'healthy',
        completion: `[${chosen}] 模型回执: ${prompt.slice(0, 80)}`
      }, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
