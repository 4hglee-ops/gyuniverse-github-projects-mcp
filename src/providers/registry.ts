import type { ProjectProvider, ProviderId } from "./provider.js";

/**
 * Request-scoped registry for Project read providers.
 *
 * The registry performs dispatch, not authorization. Only providers built from
 * the request's authenticated principal and policy-bound services belong here.
 * Unknown or duplicate provider IDs fail closed rather than falling back.
 */
export class ProjectProviderRegistry {
  private readonly providers = new Map<ProviderId, ProjectProvider>();

  constructor(providers: readonly ProjectProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: ProjectProvider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`PROVIDER_ALREADY_REGISTERED: '${provider.id}' is already registered.`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  require(providerId: ProviderId): ProjectProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`PROVIDER_NOT_REGISTERED: '${providerId}' is not available for this request.`);
    }
    return provider;
  }
}
