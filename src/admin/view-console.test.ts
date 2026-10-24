import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

interface State {
  identity: { authenticated: boolean; subject: string } | null;
  projects: Array<{ id: string; canWriteViews: boolean }>;
  target: { id: string } | null;
  views: unknown;
  plan: unknown;
  result: { state: string } | null;
  error: string | null;
  busy: boolean;
}
interface Console {
  snapshot(): State;
  connect(token: string): Promise<unknown>;
  disconnect(): void;
  selectProject(id: string): void;
  loadViews(): Promise<unknown>;
  previewTemplate(name: string): Promise<unknown>;
  previewUpdate(id: string, changes: object): Promise<unknown>;
  invalidatePlan(): void;
  apply(approved: boolean): Promise<unknown>;
  connectSession(token: string): Promise<unknown>;
  resumeSession(): Promise<unknown>;
  logoutSession(): Promise<unknown>;
}
const moduleUrl = new URL("../../public/admin/views.js", import.meta.url);
const { createViewConsole, mountViewConsole } = await import(moduleUrl.href) as {
  createViewConsole: (fetcher: typeof fetch) => Console;
  mountViewConsole: (document: unknown, fetcher: typeof fetch, lifecycle: unknown) => Console;
};
const target = { id: "PVT", owner: "fixture-org", number: 3, title: "Fixture", canWriteViews: true };
const identity = { authenticated: true, subject: "fixture-admin", role: "admin", displayName: "Fixture" };
function plan() {
  return { planId: "view-plan-12345678-1234-4123-8123-123456789abc", planDigest: "d".repeat(43), state: "previewed",
    artifact: { ...target, projectId: target.id, kind: "update", expiresAt: new Date(Date.now() + 900_000).toISOString(),
      actions: [{ action: "update-supported", name: "Renamed", manual: [] as string[] }] } };
}
function fixture(options: { writable?: boolean } = {}) {
  const calls: Array<{ path: string; init: RequestInit; body: Record<string, unknown> | undefined }> = [];
  let preview = plan(), name = "Original";
  let write: (() => Promise<Response>) | undefined, read: (() => Promise<Response>) | undefined;
  const ok = (data: unknown) => Response.json({ ok: true, data });
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, init, body });
    if (path === "/api/v1/identity") return ok(identity);
    if (path === "/api/v1/project/catalog") return ok({ projects: [{ ...target, canWriteViews: options.writable ?? true }], omittedProjectCount: 0 });
    if (path === "/api/v1/project/views/preview") return ok(preview);
    if (path === "/api/v1/project/views") return read ? read() : ok({ complete: true, project: target,
      views: [{ id: "V", name, layout: "TABLE_LAYOUT", filter: "", visibleFields: ["Title"], groupByFields: [], verticalGroupByFields: [], sortBy: [] }] });
    if (["/api/v1/write/views/update", "/api/v1/write/views/apply"].includes(path)) {
      name = "Renamed";
      return write ? write() : ok({ state: "completed", manualRequired: false, retryable: false, results: [{ verified: true }] });
    }
    throw new Error("Unexpected synthetic request");
  };
  const client = createViewConsole(fetcher);
  return { client, fetcher, calls, ok, get writes() { return calls.filter((c) => c.path.startsWith("/api/v1/write/")).length; },
    preview: (p: ReturnType<typeof plan>) => { preview = p; }, write: (fn: () => Promise<Response>) => { write = fn; }, read: (fn: () => Promise<Response>) => { read = fn; } };
}
async function ready(s: ReturnType<typeof fixture>) {
  await s.client.connect("synthetic-existing-bearer"); s.client.selectProject("PVT"); await s.client.loadViews();
  await s.client.previewUpdate("V", { name: "Renamed" });
}
test("Console binds exact target/digest, requires approval, re-reads results and does not replay a consumed plan", async () => {
  const s = fixture(); await ready(s);
  await assert.rejects(() => s.client.apply(false), /EXPLICIT_APPROVAL_REQUIRED/);
  assert.equal(s.writes, 0);
  await s.client.apply(true);
  assert.equal(s.client.snapshot().result!.state, "completed");
  const applied = s.calls.find((c) => c.path.startsWith("/api/v1/write/"))!;
  assert.deepEqual(applied.body, { owner: "fixture-org", number: 3, planId: plan().planId, planDigest: "d".repeat(43), approved: true });
  assert.equal(s.calls.at(-1)!.path, "/api/v1/project/views");
  await assert.rejects(() => s.client.apply(true), /VIEW_PLAN_EXPIRED/);
  assert.equal(s.writes, 1);
  assert.ok(s.calls.every((c) => c.init.credentials === "omit" && c.init.redirect === "error" && c.init.cache === "no-store"));
  assert.doesNotMatch(JSON.stringify(s.client.snapshot()), /synthetic-existing-bearer/);
  s.client.disconnect();
  assert.equal(s.client.snapshot().identity, null);
  assert.equal(s.client.snapshot().views, null);
});
test("Console refuses unlisted Projects and read-only writes, and invalidates a plan when inputs change", async () => {
  const s = fixture(); await ready(s);
  s.client.invalidatePlan();
  await assert.rejects(() => s.client.apply(true), /VIEW_PLAN_EXPIRED/);
  await s.client.previewUpdate("V", { name: "Renamed" });
  assert.throws(() => s.client.selectProject("OTHER"), /PROJECT_SELECTION_REQUIRED/);
  assert.equal(s.client.snapshot().target, null); assert.equal(s.client.snapshot().plan, null);
  assert.equal(s.writes, 0);
  const readOnly = fixture({ writable: false }); await ready(readOnly);
  await assert.rejects(() => readOnly.client.apply(true), /PERMISSION_DENIED/);
  assert.equal(readOnly.writes, 0);
});
test("Template previews route explicit approval to template apply and retain manual-result information", async () => {
  const s = fixture(), p = plan(); p.artifact.kind = "template"; p.artifact.actions[0]!.action = "create";
  p.artifact.actions[0]!.manual.push("Verify Roadmap date configuration"); s.preview(p);
  await s.client.connect("synthetic-existing-bearer"); s.client.selectProject("PVT"); await s.client.loadViews();
  await s.client.previewTemplate("wbs-v1");
  assert.deepEqual(s.calls.at(-1)!.body, { owner: "fixture-org", number: 3, template: "wbs-v1" });
  assert.match(JSON.stringify(s.client.snapshot().plan), /Verify Roadmap/);
  s.write(async () => s.ok({ state: "completed", manualRequired: true, retryable: false }));
  await s.client.apply(true);
  assert.equal(s.calls.filter((c) => c.path === "/api/v1/write/views/apply").length, 1);
  assert.match(JSON.stringify(s.client.snapshot().result), /"manualRequired":true/);
});
test("Expired, wrong-target and wrong-kind preview responses never become applicable", async () => {
  for (const mutate of [
    (p: ReturnType<typeof plan>) => { p.artifact.expiresAt = new Date(0).toISOString(); },
    (p: ReturnType<typeof plan>) => { p.artifact.projectId = "OTHER"; },
    (p: ReturnType<typeof plan>) => { p.artifact.kind = "template"; },
  ]) {
    const s = fixture(); await s.client.connect("synthetic-existing-bearer"); s.client.selectProject("PVT"); await s.client.loadViews();
    const invalid = plan(); mutate(invalid); s.preview(invalid);
    await assert.rejects(() => s.client.previewUpdate("V", { name: "Renamed" }), /CONSOLE_PLAN_INVALID/);
    assert.equal(s.client.snapshot().plan, null); assert.equal(s.writes, 0);
  }
});
test("Blocked plans and plans that expire after preview perform zero writes", async (t) => {
  const blocked = fixture(), p = plan(); p.artifact.actions[0]!.action = "blocked"; blocked.preview(p);
  await ready(blocked);
  await assert.rejects(() => blocked.client.apply(true), /VIEW_PLAN_BLOCKED/);
  assert.equal(blocked.writes, 0);
  const expired = fixture(); await ready(expired);
  const now = Date.now(); t.mock.method(Date, "now", () => now + 900_001);
  await assert.rejects(() => expired.client.apply(true), /VIEW_PLAN_EXPIRED/);
  assert.equal(expired.client.snapshot().plan, null); assert.equal(expired.writes, 0);
});
test("Lost responses, stale denials and partial results consume the plan and never automatically retry writes", async () => {
  for (const outcome of ["lost", "stale", "partial"] as const) {
    const s = fixture(); await ready(s);
    s.write(async () => {
      if (outcome === "lost") throw new TypeError("synthetic connection lost after commit");
      if (outcome === "stale") return Response.json({ ok: false, error: { code: "VIEW_PLAN_STALE" } }, { status: 409 });
      return s.ok({ state: "partial", retryable: false, manualRequired: true, results: [{ changed: null, verified: false }] });
    });
    if (outcome === "partial") {
      await s.client.apply(true); assert.equal(s.client.snapshot().result!.state, "partial");
    } else await assert.rejects(() => s.client.apply(true), outcome === "lost" ? /CONSOLE_WRITE_OUTCOME_UNKNOWN/ : /VIEW_PLAN_STALE/);
    assert.equal(s.client.snapshot().plan, null);
    await assert.rejects(() => s.client.apply(true), /VIEW_PLAN_EXPIRED/);
    assert.equal(s.writes, 1);
  }
});
test("Double apply clicks are serialized and a re-read failure keeps the applied result without reapplying", async () => {
  const s = fixture(); await ready(s);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  s.write(async () => { await gate; return s.ok({ state: "completed" }); });
  const pending = s.client.apply(true);
  await assert.rejects(() => s.client.apply(true), /CONSOLE_BUSY/);
  assert.equal(s.writes, 1);
  s.read(async () => { throw new TypeError("synthetic read failure"); });
  release(); await pending;
  assert.equal(s.client.snapshot().result!.state, "completed");
  assert.equal(s.client.snapshot().views, null);
  assert.equal(s.client.snapshot().error, "CONSOLE_REREAD_FAILED");
  assert.equal(s.writes, 1);
});
test("Disconnected pending authentication cannot erase a newer connection", async () => {
  const s = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const fetcher: typeof fetch = async (input, init) => {
    if (first) { first = false; await gate; }
    return s.fetcher(input, init);
  };
  const client = createViewConsole(fetcher);
  const old = client.connect("synthetic-old-bearer");
  const rejected = assert.rejects(() => old, /CONSOLE_STATE_CHANGED/);
  client.disconnect(); await client.connect("synthetic-new-bearer"); release(); await rejected;
  assert.equal(client.snapshot().identity!.subject, "fixture-admin");
});
test("Expired authentication clears Project data and failed reads recover only through an explicit new read", async () => {
  const s = fixture(); await ready(s);
  s.read(async () => { throw new TypeError("synthetic read transport error"); });
  await assert.rejects(() => s.client.loadViews(), /CONSOLE_REQUEST_FAILED/);
  assert.equal(s.client.snapshot().views, null); assert.equal(s.client.snapshot().plan, null);
  assert.equal(s.writes, 0);
  s.read(async () => s.ok({ complete: true, project: target, views: [] }));
  await s.client.loadViews(); assert.notEqual(s.client.snapshot().views, null);
  s.read(async () => Response.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 }));
  await assert.rejects(() => s.client.loadViews(), /UNAUTHORIZED/);
  assert.equal(s.client.snapshot().identity, null); assert.deepEqual(s.client.snapshot().projects, []);
  assert.equal(s.client.snapshot().target, null); assert.equal(s.writes, 0);
});

class Element {
  value = ""; textContent = ""; checked = false; disabled = false; hidden = false;
  listeners = new Map<string, Array<(event: { preventDefault(): void }) => unknown>>();
  children: Element[] = [];
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener(type: string, fn: (event: { preventDefault(): void }) => unknown) { this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]); }
  async emit(type: string) { for (const fn of this.listeners.get(type) ?? []) await fn({ preventDefault() {} }); }
}
test("DOM flow selects a Project, previews changes, approves once and clears credentials/output on disconnect", async () => {
  const html = await readFile(new URL("../../public/admin/views.html", import.meta.url), "utf8");
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => [m[1]!, new Element()]));
  const controls = [...html.matchAll(/<(?:button|input|select)\b[^>]*\bid="([^"]+)"/g)].map((m) => nodes.get(m[1]!)!);
  const $ = (id: string) => nodes.get(id)!;
  const document = { getElementById: $, createElement: () => new Element(), querySelectorAll: () => controls };
  const s = fixture(); const lifecycle = new Element();
  mountViewConsole(document, s.fetcher, lifecycle);
  $("token").value = "synthetic-existing-bearer";
  await $("connect").emit("submit"); assert.equal($("token").value, ""); assert.equal($("workspace").hidden, false);
  $("project").value = "PVT"; await $("project").emit("change");
  $("view").value = "V"; await $("view").emit("change");
  $("name").value = "Renamed"; await $("update").emit("submit");
  assert.match($("plan").textContent, /fixture-org/);
  assert.equal($("apply").disabled, true);
  $("approve").checked = true; await $("approve").emit("change"); assert.equal($("apply").disabled, false);
  await $("apply").emit("click"); assert.match($("result").textContent, /completed/); assert.equal(s.writes, 1);
  assert.equal($("apply").disabled, true);
  await $("disconnect").emit("click"); assert.equal($("workspace").hidden, true); assert.equal($("result").textContent, "");
  assert.doesNotMatch([...nodes.values()].map((n) => n.textContent).join(" "), /synthetic-existing-bearer/);
});
test("View assets use external scripts/styles, safe text rendering and same-origin restrictive CSP", async () => {
  const [html, source, deployment] = await Promise.all([
    readFile(new URL("../../public/admin/views.html", import.meta.url), "utf8"),
    readFile(moduleUrl, "utf8"), readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /innerHTML|localStorage|sessionStorage|console\.log|\/oauth\/token|\/oauth\/register/);
  assert.doesNotMatch(html, /<style>|<script(?![^>]*\bsrc=)|\bonclick=/);
  const headers = JSON.parse(deployment).headers.find((h: { source: string }) => h.source === "/admin/:path*").headers as Array<{ key: string; value: string }>;
  const csp = headers.find((h) => h.key === "Content-Security-Policy")!.value;
  assert.match(csp, /script-src 'self'; style-src 'self'/); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(headers.find((h) => h.key === "Cache-Control")!.value, "no-store");
});
test("session transport sends bearer only at bootstrap, scopes cookies/CSRF to admin routes, resumes and logs out", async () => {
  const original = fixture(), calls: Array<{ path: string; init: RequestInit }> = [];
  const csrf = "c".repeat(43);
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input); calls.push({ path, init });
    if (path === "/api/admin/v1/session") return Response.json({ ok: true, data: { authenticated: true, csrf } });
    if (path === "/api/admin/v1/logout") return Response.json({ ok: true, data: { loggedOut: true } });
    return original.fetcher(path.replace("/api/admin/v1/", "/api/v1/"), init);
  };
  const client = createViewConsole(fetcher);
  await client.connectSession("synthetic-existing-versioned-bearer");
  assert.equal(calls[0]!.init.credentials, "same-origin");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer synthetic-existing-versioned-bearer");
  client.selectProject("PVT"); await client.loadViews(); await client.previewUpdate("V", { name: "Renamed" }); await client.apply(true);
  assert.ok(calls.every((c) => c.path.startsWith("/api/admin/v1/") && c.init.credentials === "same-origin"));
  for (const call of calls.slice(1)) {
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
    if (call.init.method === "POST") assert.equal(headers["X-CSRF-Token"], csrf);
  }
  client.disconnect(); await client.resumeSession();
  await client.logoutSession(); assert.equal(calls.at(-1)!.path, "/api/admin/v1/logout"); assert.equal(client.snapshot().identity, null);
  assert.doesNotMatch(JSON.stringify(client.snapshot()), /synthetic-existing-versioned-bearer|cccccccccccc/);
});

test("management client needs approval, guards duplicate sends, displays synthetic value once and never stores/resends bearer",async()=>{
  const {createAdminConsole}=await import(new URL("../../public/admin/console.js",import.meta.url).href);
  const calls:Array<{path:string;init:RequestInit}>=[];let gate:(()=>void)|undefined;
  const fetcher:typeof fetch=async(input,init={})=>{const path=String(input);calls.push({path,init});
    if(path.endsWith("/session"))return Response.json({ok:true,data:{authenticated:true,csrf:"c".repeat(43),expiresAt:Math.floor(Date.now()/1000)+600}});
    if(path.endsWith("/overview"))return Response.json({ok:true,data:{actorId:"user:fixture",users:[],credentials:[],audit:[]}});
    if(path.endsWith("/credentials")){await new Promise<void>(r=>{gate=r;});return Response.json({ok:true,data:{target:"fixture",secret:"synthetic-only-value",syntheticOnly:true}});}
    return Response.json({ok:true,data:{loggedOut:true}});};
  const client=createAdminConsole(fetcher,()=>{},()=>"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");await client.connect("synthetic-existing-bearer");
  await assert.rejects(()=>client.mutate("credentials",{},false),/ADMIN_APPROVAL_REQUIRED/);
  const pending=client.mutate("credentials",{subject:"fixture",expectedVersion:1},true);await new Promise(r=>setImmediate(r));
  await assert.rejects(()=>client.mutate("credentials",{},true),/ADMIN_BUSY|ADMIN_RECONCILIATION_REQUIRED/);gate!();await pending;
  assert.equal(client.snapshot().oneTime,"synthetic-only-value");client.hideSecret();assert.equal(client.snapshot().oneTime,null);
  assert.equal(calls.filter(c=>c.path.endsWith("/credentials")).length,1);
  for(const call of calls.slice(1)){assert.equal((call.init.headers as Record<string,string>).Authorization,undefined);if(call.init.method==="POST")assert.equal((call.init.headers as Record<string,string>)["X-CSRF-Token"],"c".repeat(43));}
  await client.logout();assert.equal(client.snapshot().connected,false);assert.equal(client.snapshot().oneTime,null);
  const js=await readFile(new URL("../../public/admin/console.js",import.meta.url),"utf8");assert.doesNotMatch(js,/innerHTML|localStorage|sessionStorage|console\.log|\/oauth\/token/);
});
test("management response loss latches mutations until explicit reconciliation; clear invalidates late output",async()=>{
  const {createAdminConsole}=await import(new URL("../../public/admin/console.js",import.meta.url).href);let writes=0;
  const client=createAdminConsole(async(input:RequestInfo|URL)=>{const path=String(input);
    if(path.endsWith("/session"))return Response.json({ok:true,data:{authenticated:true,csrf:"c".repeat(43),expiresAt:Math.floor(Date.now()/1000)+600}});
    if(path.endsWith("/overview"))return Response.json({ok:true,data:{actorId:"user:fixture",users:[],credentials:[],audit:[]}});
    writes++;throw new TypeError("synthetic response lost");});
  await client.resume();await assert.rejects(()=>client.mutate("users",{},true),/ADMIN_OUTCOME_UNKNOWN/);
  await assert.rejects(()=>client.mutate("users",{},true),/ADMIN_RECONCILIATION_REQUIRED/);assert.equal(writes,1);assert.equal(client.snapshot().oneTime,null);
  await client.reconcile();assert.equal(client.snapshot().uncertain,false);client.clear();assert.equal(client.snapshot().overview,null);
});
test("management UI expires session metadata and synthetic one-time DOM state without another request",{timeout:3000},async()=>{
  const {createAdminConsole}=await import(new URL("../../public/admin/console.js",import.meta.url).href);
  const client=createAdminConsole(async(input:RequestInfo|URL)=>{const path=String(input);
    if(path.endsWith("/session"))return Response.json({ok:true,data:{authenticated:true,csrf:"c".repeat(43),expiresAt:Math.floor(Date.now()/1000)+1}});
    if(path.endsWith("/overview"))return Response.json({ok:true,data:{actorId:"user:fixture",users:[],credentials:[],audit:[]}});
    return Response.json({ok:true,data:{target:"fixture",secret:"synthetic-only-expiring",syntheticOnly:true}});});
  await client.resume();await client.mutate("credentials",{},true);assert.equal(client.snapshot().oneTime,"synthetic-only-expiring");
  await new Promise(r=>setTimeout(r,1100));assert.equal(client.snapshot().oneTime,null);assert.equal(client.snapshot().connected,false);assert.equal(client.snapshot().overview,null);client.clear();
});
