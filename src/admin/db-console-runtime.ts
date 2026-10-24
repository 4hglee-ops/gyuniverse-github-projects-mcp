import { z } from "zod";
import type { AppConfig } from "../config.js";
import { resolveSessionOperator, type VerifiedOperator } from "../http/operator-auth.js";
import { type AdminConsoleRuntime, type AdminDbConsoleBridge } from "./console.js";
import { type AdminSessionRecord, type AdminSessionStore } from "./session-store.js";
import { AdminDbLeaseBridge, ManagedDbResolver, type ScopedDbTransport } from "./scoped-db.js";
import { operatorPolicyDigest } from "./scoped-credential-rpc.js";

interface Options {
  enabled?: boolean;
  runtime: AdminConsoleRuntime & { config: AppConfig; sessionStore: AdminSessionStore };
  transport: ScopedDbTransport;
  expectedEpoch: (operator: VerifiedOperator) => number;
}
/** Explicit injection factory. No router, deployment entrypoint, environment key loader or real issuer calls this. */
export function createAdminDbConsoleRuntime(options: Options): AdminConsoleRuntime {
  const assertEnabled = () => {
    if (options.enabled !== true || process.env.VERCEL_ENV !== "preview") throw Error("ADMIN_DB_DISABLED: DB console injection is disabled.");
  };
  const resolver = new ManagedDbResolver(options.transport, { enabled: options.enabled });
  const config = options.runtime.auth?.currentConfig ?? (() => options.runtime.config);
  const auth = { ...options.runtime.auth, currentConfig: config, managedPrincipal: (subject: string, id: string) => resolver.resolve(subject, id) };
  function coordinator(record: AdminSessionRecord, store: AdminSessionStore) {
    assertEnabled();
    if (!record.dbLease) throw Error("ADMIN_DB_UNCONFIRMED: Session has no reviewed DB binding.");
    return new AdminDbLeaseBridge({ enabled: true, loadSession: () => store.get(record.idHash), revokeSession: (id) => store.revoke(id),
      config, auth, expectedEpoch: options.expectedEpoch, transport: options.transport });
  }
  async function current(record: AdminSessionRecord, store: AdminSessionStore) {
    const bridge = coordinator(record, store), operator = await bridge.refresh();
    if (record.dbLease!.authEpoch !== options.expectedEpoch(operator) || record.dbLease!.policyDigest !== operatorPolicyDigest(operator)) {
      throw Error("ADMIN_DB_UNCONFIRMED: Current policy no longer matches this session.");
    }
    return { bridge, operator };
  }
  const dbBridge: AdminDbConsoleBridge = {
    assertEnabled,
    prepare(record, operator) {
      assertEnabled();
      return { ...record, dbLease: { authEpoch: z.number().int().positive().safe().parse(options.expectedEpoch(operator)), policyDigest: operatorPolicyDigest(operator) } };
    },
    async connect(record, store) { const { bridge } = await current(record, store); await bridge.register(); },
    async assertCurrent(record, store) { const { bridge, operator } = await current(record, store); await bridge.leaseFor(operator); },
    async close(record, store) {
      assertEnabled();
      if (!record.dbLease) {
        // Pre-bridge sessions cannot acquire a DB lease. Close their shared session only.
        await store.revoke(record.idHash); return;
      }
      await coordinator(record, store).revoke(record, record.dbLease.authEpoch, record.dbLease.policyDigest);
    },
  };
  return { ...options.runtime, auth, dbBridge };
}
