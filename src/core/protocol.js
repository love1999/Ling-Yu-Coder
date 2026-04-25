export const PROTOCOL_VERSION = '1.0';

export const Stage = {
  ENV: 'env',
  CLARIFY: 'clarify',
  RETRIEVE: 'retrieve',
  PLAN: 'plan',
  APPROVE: 'approve',
  ACT: 'act',
  COMPILE: 'compile',
  RUNTIME: 'runtime',
  DOC: 'doc',
  MEMORY: 'memory',
  MODIFY: 'modify',
  LLM: 'llm'
};

export const ErrorCode = {
  VALIDATION: 'E_VALIDATION',
  TIMEOUT: 'E_TIMEOUT',
  APPROVAL_DENIED: 'E_APPROVAL_DENIED',
  COMPILER: 'E_COMPILER',
  RUNTIME: 'E_RUNTIME',
  IO: 'E_IO',
  PROVIDER: 'E_PROVIDER',
  UNKNOWN: 'E_UNKNOWN'
};

export const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createEnvelope = ({ source, target, stage, payload = {}, traceId, requestId, meta = {} }) => ({
  protocolVersion: PROTOCOL_VERSION,
  traceId: traceId || createId(),
  requestId: requestId || createId(),
  timestamp: new Date().toISOString(),
  source,
  target,
  stage,
  payload,
  meta: {
    priority: meta.priority || 'normal',
    timeoutMs: meta.timeoutMs || 30000,
    retry: meta.retry || 0
  }
});

export const validateEnvelope = (envelope) => {
  const required = ['protocolVersion', 'traceId', 'requestId', 'source', 'target', 'stage', 'payload', 'meta'];
  const missing = required.filter((key) => envelope?.[key] === undefined);
  if (missing.length) {
    const error = new Error(`Envelope 字段缺失: ${missing.join(', ')}`);
    error.code = ErrorCode.VALIDATION;
    throw error;
  }
};

export const createOkResponse = (envelope, result, latencyMs) => ({
  ok: true,
  traceId: envelope.traceId,
  requestId: envelope.requestId,
  stage: envelope.stage,
  result,
  error: null,
  metrics: { latencyMs }
});

export const createErrorResponse = (envelope, error, latencyMs) => ({
  ok: false,
  traceId: envelope.traceId,
  requestId: envelope.requestId,
  stage: envelope.stage,
  result: null,
  error: {
    code: error.code || ErrorCode.UNKNOWN,
    message: error.message
  },
  metrics: { latencyMs }
});
