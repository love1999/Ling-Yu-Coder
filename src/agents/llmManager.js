import { ErrorCode, createErrorResponse, createOkResponse, validateEnvelope } from '../core/protocol.js';

const nowTs = () => Date.now();

const defaultPolicy = {
  failureThreshold: 3,
  cooldownMs: 30_000
};

export class LLMManager {
  constructor(policy = {}) {
    this.name = 'LLM Manage';
    this.policy = {
      ...defaultPolicy,
      ...policy
    };
    this.providers = {
      online: {
        enabled: true,
        name: 'Online API Provider',
        healthy: true,
        state: 'healthy',
        consecutiveFailures: 0,
        lastSuccessTs: null,
        cooldownUntil: null
      },
      local: {
        enabled: true,
        name: 'Local Model Provider',
        healthy: true,
        state: 'healthy',
        consecutiveFailures: 0,
        lastSuccessTs: null,
        cooldownUntil: null
      }
    };
    this.metrics = {
      totalProbes: 0,
      successfulProbes: 0,
      failedProbes: 0,
      openedCircuits: 0,
      recoveredCircuits: 0,
      lastProbeAt: null
    };
    this.active = 'online';
    this.healthTimer = null;
  }

  listProviders() {
    return this.providers;
  }

  getHealthMetrics() {
    return {
      ...this.metrics,
      probeSuccessRate: this.metrics.totalProbes === 0
        ? 1
        : this.metrics.successfulProbes / this.metrics.totalProbes
    };
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

  recordProbeResult(mode, healthy) {
    const provider = this.providers[mode];
    if (!provider) return;

    this.metrics.totalProbes += 1;
    this.metrics.lastProbeAt = nowTs();

    if (healthy) {
      this.metrics.successfulProbes += 1;
      provider.consecutiveFailures = 0;
      provider.lastSuccessTs = nowTs();
      provider.state = 'healthy';
      provider.cooldownUntil = null;
      return;
    }

    this.metrics.failedProbes += 1;
    provider.consecutiveFailures += 1;
    const prevState = provider.state;
    provider.state = provider.consecutiveFailures >= this.policy.failureThreshold ? 'open' : 'degraded';

    if (provider.state === 'open') {
      provider.cooldownUntil = nowTs() + this.policy.cooldownMs;
      if (prevState !== 'open') {
        this.metrics.openedCircuits += 1;
      }
    }
  }

  isProviderAvailable(mode) {
    const provider = this.providers[mode];
    if (!provider || !provider.enabled) return false;

    if (provider.state !== 'open') return true;

    if (provider.cooldownUntil && nowTs() >= provider.cooldownUntil) {
      provider.state = 'degraded';
      provider.cooldownUntil = null;
      this.metrics.recoveredCircuits += 1;
      return true;
    }

    return false;
  }

  async checkProviderHealth(mode) {
    const provider = this.providers[mode];
    if (!provider || !provider.enabled) return false;
    const healthy = provider.healthy;
    this.recordProbeResult(mode, healthy);
    return healthy;
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

    return {
      providers: this.providers,
      metrics: this.getHealthMetrics()
    };
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
    if (current?.healthy && this.isProviderAvailable(this.active)) return this.active;

    const fallback = Object.entries(this.providers).find(([mode, provider]) => provider.healthy && this.isProviderAvailable(mode));
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
        const error = new Error('没有可用的 LLM provider（可能处于熔断冷却）');
        error.code = ErrorCode.PROVIDER;
        throw error;
      }

      return createOkResponse(envelope, {
        activeProvider: chosen,
        providers: this.providers,
        healthStatus: this.providers[chosen].state,
        healthMetrics: this.getHealthMetrics(),
        completion: `[${chosen}] 模型回执: ${prompt.slice(0, 80)}`
      }, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
