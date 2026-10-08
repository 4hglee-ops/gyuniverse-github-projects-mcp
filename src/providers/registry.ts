import type { ProjectProvider, ProviderId } from "./provider.js";
import { normalizeResourceRef, type ResourceRef } from "../core/resources/resource-ref.js";

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

  /** Dispatch a provider-qualified reference; do not weaken provider authorization. */
  async getResource(ref: ResourceRef): Promise<unknown> {
    const resource = normalizeResourceRef(ref);
    const provider = this.require(resource.provider);
    if (resource.provider === "github_projects") {
      return provider.getProject(resource.owner, resource.projectNumber);
    }
    throw new Error("PROVIDER_OPERATION_UNSUPPORTED: Jira resource reads are not implemented yet.");
  }

  async getResourceSnapshot(ref: ResourceRef, first = 100): Promise<unknown> {
    const resource = normalizeResourceRef(ref);
    const provider = this.require(resource.provider);
    if (resource.provider === "github_projects") {
      return provider.getSnapshot(resource.owner, resource.projectNumber, first);
    }
    throw new Error("PROVIDER_OPERATION_UNSUPPORTED: Jira snapshot reads are not implemented yet.");
  }

  require(providerId: ProviderId): ProjectProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`PROVIDER_NOT_REGISTERED: '${providerId}' is not available for this request.`);
    }
    return provider;
  }
}
