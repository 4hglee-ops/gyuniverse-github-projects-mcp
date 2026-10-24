import { createHash, randomBytes } from "node:crypto";
import { ScopedCredentialRpc, scopedIssueInput, operatorPolicyDigest, type ScopedIssueOptions } from "./scoped-credential-rpc.js";

export const managedCredentialPattern = /^gypk_[A-Za-z0-9_-]{43}$/;
export function managedCredentialHash(value: string): string {
  if (!managedCredentialPattern.test(value)) throw Error("ADMIN_CREDENTIAL_INVALID: Invalid credential format.");
  return createHash("sha256").update(value).digest("hex");
}
/** No environment factory installs this issuer. Only a confirmed fresh SQL result releases the in-flight candidate. */
export class CredentialIssuer {
  constructor(private readonly options: Omit<ScopedIssueOptions,"candidateHashFor">) {}
  async issue(body: unknown) {
    if (this.options.enabled !== true || process.env.VERCEL_ENV !== "preview") throw Error("ADMIN_RPC_DISABLED: Credential issuance is disabled.");
    const input = scopedIssueInput.parse(body);
    let candidate: string | undefined, bytes: Buffer | undefined;
    try {
      let currentDigest = "";
      const rpc = new ScopedCredentialRpc({ ...this.options,
        refresh: async () => { const op = await this.options.refresh(); currentDigest = operatorPolicyDigest(op); return op; },
        candidateHashFor: async () => {
          bytes = randomBytes(32); candidate = "gypk_" + bytes.toString("base64url");
          const hash = managedCredentialHash(candidate); bytes.fill(0); bytes = undefined; return hash;
        },
      });
      const result = await rpc.issue(input);
      // A commit may succeed while the session is being closed. Never release a candidate to a stale session.
      const operator = await this.options.refresh();
      if (operatorPolicyDigest(operator) !== currentDigest) throw Error("changed");
      await this.options.leaseFor(operator);
      return { operationId: result.operationId, target: result.credentialId, version: result.keyVersion, replayed: result.replayed,
        secretUnavailable: result.secretUnavailable, syntheticOnly: false,
        ...(result.candidateAccepted && candidate ? { secret: candidate, candidateAccepted: true } : {}) };
    } catch { throw Error("ADMIN_RPC_UNCONFIRMED: Issuance was not confirmed. Inspect the operation metadata; revoke the inaccessible key explicitly before a new issue."); }
    finally { bytes?.fill(0); candidate = undefined; }
  }
}
