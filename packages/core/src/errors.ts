/**
 * Errors the agent is allowed to surface to a customer carry `customerSafe`.
 * Everything else becomes a generic message plus an escalation.
 */
export class BitcError extends Error {
  readonly code: string;
  readonly customerSafe: boolean;
  readonly context: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { customerSafe?: boolean; context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BitcError';
    this.code = code;
    this.customerSafe = options.customerSafe ?? false;
    this.context = options.context ?? {};
  }
}

export class ConfigError extends BitcError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('config_invalid', message, context === undefined ? {} : { context });
    this.name = 'ConfigError';
  }
}

/** A tenant-scoped operation was attempted without a tenant in scope. */
export class TenantScopeError extends BitcError {
  constructor(message: string) {
    super('tenant_scope_missing', message);
    this.name = 'TenantScopeError';
  }
}
