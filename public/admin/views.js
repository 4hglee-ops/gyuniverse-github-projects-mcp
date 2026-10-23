// Uses the existing REST identity/scope boundary. No token issuance or persistent browser storage.
export function createViewConsole(fetcher = fetch, onChange = () => {}) {
  const empty = () => ({ transport: "bearer", identity: null, projects: [], omittedProjectCount: 0, target: null, views: null, plan: null, result: null, busy: false, error: null });
  let model = empty(), token = "", csrf = "", authMode = "bearer", revision = 0;
  const snapshot = () => structuredClone(model);
  const notify = () => onChange(snapshot());
  const failure = (code) => new Error(code);
  const targetBody = () => {
    if (!model.target) throw failure("PROJECT_SELECTION_REQUIRED");
    return { owner: model.target.owner, number: model.target.number };
  };
  async function run(work) {
    if (model.busy) throw failure("CONSOLE_BUSY");
    const current = revision;
    model.busy = true; model.error = null; notify();
    const request = async (path, body, write = false) => {
      if (current !== revision) throw failure("CONSOLE_STATE_CHANGED");
      const session = authMode === "session", bootstrap = path === "/api/admin/v1/session" && body !== undefined;
      const destination = session ? path.replace(/^\/api\/v1\//, "/api/admin/v1/") : path;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), write ? 120_000 : 20_000);
      try {
        const response = await fetcher(destination, {
          method: body === undefined ? "GET" : "POST", credentials: session || bootstrap ? "same-origin" : "omit", cache: "no-store", redirect: "error",
          headers: { ...(session ? {} : { Authorization: "Bearer " + token }), ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(session && body !== undefined ? { "X-CSRF-Token": csrf } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
        });
        if (current !== revision) throw failure("CONSOLE_STATE_CHANGED");
        const payload = await response.json();
        if (current !== revision) throw failure("CONSOLE_STATE_CHANGED");
        if (!response.ok || payload.ok !== true) {
          if (response.status === 401 || (session && response.status === 403)) { token = ""; csrf = ""; authMode = "bearer"; model = empty(); }
          const code = payload.error?.code;
          throw failure(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(code) ? code : "CONSOLE_REQUEST_FAILED");
        }
        return payload.data;
      } catch (error) {
        if (current !== revision) throw failure("CONSOLE_STATE_CHANGED");
        // A disconnected browser/timeout cannot tell whether a write reached the server.
        if (write && !(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))) throw failure("CONSOLE_WRITE_OUTCOME_UNKNOWN");
        if (!(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))) throw failure("CONSOLE_REQUEST_FAILED");
        throw error;
      } finally { clearTimeout(timer); }
    };
    try { return await work(request); }
    catch (error) { if (current === revision) model.error = error.message; throw error; }
    finally { if (current === revision) { model.busy = false; notify(); } }
  }
  async function preview(body) {
    const target = targetBody();
    return run(async (request) => {
      model.plan = null; model.result = null;
      const plan = await request("/api/v1/project/views/preview", { ...target, ...body });
      if (plan.state !== "previewed" || plan.artifact?.owner !== target.owner || plan.artifact?.number !== target.number
        || plan.artifact?.projectId !== model.target.id || plan.artifact?.kind !== (body.update ? "update" : "template")
        || !/^view-plan-[0-9a-f-]{36}$/.test(plan.planId) || !/^[A-Za-z0-9_-]{43}$/.test(plan.planDigest)
        || !Number.isFinite(Date.parse(plan.artifact.expiresAt)) || Date.parse(plan.artifact.expiresAt) <= Date.now()
        || !Array.isArray(plan.artifact.actions) || !plan.artifact.actions.length
        || plan.artifact.actions.some((a) => !a || !["create", "skip-compatible", "update-supported", "manual-review", "blocked"].includes(a.action))) throw failure("CONSOLE_PLAN_INVALID");
      model.plan = plan;
      return snapshot();
    });
  }
  async function loadIdentity(request) {
    const identity = await request("/api/v1/identity"), catalog = await request("/api/v1/project/catalog");
    if (!identity.authenticated || !Array.isArray(catalog.projects) || catalog.projects.length > 100
      || catalog.projects.some((p) => !p || typeof p.id !== "string" || !p.id || typeof p.owner !== "string" || !p.owner
        || !Number.isSafeInteger(p.number) || p.number <= 0 || typeof p.title !== "string" || typeof p.canWriteViews !== "boolean")
      || new Set(catalog.projects.map((p) => p.id)).size !== catalog.projects.length) throw failure("CONSOLE_IDENTITY_INVALID");
    model.identity = identity; model.projects = catalog.projects; model.omittedProjectCount = catalog.omittedProjectCount;
    model.transport = authMode;
    return snapshot();
  }
  async function sessionConnection(presentedToken, resume) {
    if (model.busy) throw failure("CONSOLE_BUSY");
    revision++; const connecting = revision; model = empty(); token = resume ? "" : String(presentedToken).trim(); csrf = ""; authMode = resume ? "session" : "bearer";
    if (!resume && (!token || token.length > 16_384 || /\s/.test(token))) { model.error = "CONSOLE_TOKEN_INVALID"; notify(); throw failure("CONSOLE_TOKEN_INVALID"); }
    try {
      return await run(async (request) => {
        const data = await request("/api/admin/v1/session", resume ? undefined : {});
        if (!data.authenticated || !/^[A-Za-z0-9_-]{43}$/.test(data.csrf)) throw failure("CONSOLE_SESSION_INVALID");
        csrf = data.csrf; token = ""; authMode = "session";
        return loadIdentity(request);
      });
    } catch (error) { if (connecting === revision) { token = ""; csrf = ""; authMode = "bearer"; model.identity = null; model.projects = []; notify(); } throw error; }
  }
  return {
    snapshot,
    async connect(presentedToken) {
      if (model.busy) throw failure("CONSOLE_BUSY");
      revision++; model = empty(); token = String(presentedToken).trim(); csrf = ""; authMode = "bearer";
      if (!token || token.length > 16_384 || /\s/.test(token)) { token = ""; model.error = "CONSOLE_TOKEN_INVALID"; notify(); throw failure("CONSOLE_TOKEN_INVALID"); }
      const connecting = revision;
      try {
        return await run(loadIdentity);
      } catch (error) { if (connecting === revision) { token = ""; model.identity = null; model.projects = []; notify(); } throw error; }
    },
    connectSession(presentedToken) { return sessionConnection(presentedToken, false); },
    resumeSession() { return sessionConnection("", true); },
    async logoutSession() {
      if (authMode !== "session") throw failure("CONSOLE_SESSION_INVALID");
      if (model.busy) throw failure("CONSOLE_BUSY");
      try { return await run((request) => request("/api/admin/v1/logout", {})); }
      finally { revision++; token = ""; csrf = ""; authMode = "bearer"; model = empty(); notify(); }
    },
    disconnect() { revision++; token = ""; csrf = ""; authMode = "bearer"; model = empty(); notify(); },
    selectProject(id) {
      if (model.busy) throw failure("CONSOLE_BUSY");
      const target = model.projects.find((p) => p.id === id);
      model.target = target || null; model.views = null; model.plan = null; model.result = null; model.error = null; notify();
      if (!target) throw failure("PROJECT_SELECTION_REQUIRED");
    },
    invalidatePlan() { if (model.busy) throw failure("CONSOLE_BUSY"); model.plan = null; notify(); },
    async loadViews() {
      const target = targetBody();
      return run(async (request) => { model.plan = null; model.views = null; model.views = await request("/api/v1/project/views", target); return snapshot(); });
    },
    previewTemplate(template) { return preview({ template }); },
    previewUpdate(viewId, changes) {
      if (!model.views?.views.some((v) => v.id === viewId)) throw failure("VIEW_SELECTION_REQUIRED");
      return preview({ update: { viewId, changes } });
    },
    async apply(approved) {
      if (model.busy) throw failure("CONSOLE_BUSY");
      if (approved !== true) throw failure("EXPLICIT_APPROVAL_REQUIRED");
      const plan = model.plan, target = targetBody();
      if (!model.target.canWriteViews) throw failure("PERMISSION_DENIED");
      if (!plan || Date.parse(plan.artifact.expiresAt) <= Date.now()) { model.plan = null; notify(); throw failure("VIEW_PLAN_EXPIRED"); }
      if (plan.artifact.actions.some((a) => a.action === "blocked")) throw failure("VIEW_PLAN_BLOCKED");
      // Consume before sending, including timeouts and partial results. There is no automatic write retry.
      model.plan = null; model.result = null; model.views = null;
      return run(async (request) => {
        model.result = await request("/api/v1/write/views/" + (plan.artifact.kind === "update" ? "update" : "apply"),
          { ...target, planId: plan.planId, planDigest: plan.planDigest, approved: true }, true);
        try { model.views = await request("/api/v1/project/views", target); }
        catch (error) { if (error.message === "CONSOLE_STATE_CHANGED") throw error; model.views = null; model.error = "CONSOLE_REREAD_FAILED"; }
        return snapshot();
      });
    },
  };
}

export function mountViewConsole(document, fetcher = fetch, lifecycle = globalThis) {
  const $ = (id) => document.getElementById(id);
  const client = createViewConsole(fetcher, render);
  const option = (value, label) => { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; };
  const show = (id, value) => { $(id).textContent = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2); };
  function render(state) {
    $("workspace").hidden = !state.identity;
    $("connection").hidden = !!state.identity;
    show("identity", state.identity ? (state.identity.displayName || state.identity.subject) + " · " + state.identity.role : "");
    $("disconnect").textContent = state.transport === "session" ? "서버 세션 종료" : "연결 해제";
    const choices = $("project");
    choices.replaceChildren(option("", "Project 선택"), ...state.projects.map((p) => option(p.id, `${p.owner} #${p.number} · ${p.title}${p.canWriteViews ? "" : " (조회 전용)"}`)));
    choices.value = state.target?.id || "";
    const selectedView = $("view").value;
    $("view").replaceChildren(option("", "수정할 View 선택"), ...(state.views?.views || []).map((v) => option(v.id, v.name)));
    $("view").value = selectedView;
    show("current", state.views?.views.map((v) => ({ name: v.name, layout: v.layout, filter: v.filter, columns: v.visibleFields,
      groupBy: v.groupByFields, verticalGroupBy: v.verticalGroupByFields, sortBy: v.sortBy })) || []);
    show("plan", state.plan ? { project: `${state.plan.artifact.owner} #${state.plan.artifact.number}`, expiresAt: state.plan.artifact.expiresAt,
      digest: state.plan.planDigest, changes: state.plan.artifact.actions } : "계획을 만들면 적용할 변경과 수동 항목이 여기에 표시됩니다.");
    show("result", state.result);
    $("approve").checked = false;
    for (const control of document.querySelectorAll("button, select, input")) control.disabled = state.busy;
    $("apply").disabled = true;
    $("approve").disabled = state.busy || !state.plan || !state.target?.canWriteViews;
    show("status", state.busy ? "처리 중…" : state.error ? `${state.error} · 결과와 현재 View를 확인한 뒤 새 계획을 만드세요. 쓰기는 자동 재시도하지 않습니다.`
      : state.result ? "적용 결과와 재조회 결과를 확인하세요. partial/applying 또는 수동 항목은 추가 확인이 필요합니다."
      : state.omittedProjectCount ? "접근할 수 없거나 서버 허용 범위를 벗어난 Project는 선택 목록에서 제외됐습니다." : "");
  }
  const action = (work) => async (event) => { event.preventDefault(); try { await work(); } catch (error) { show("status", `${error.message} · 현재 상태를 확인하세요.`); } };
  $("connect").addEventListener("submit", action(async () => { const token = $("token").value; $("token").value = ""; await ($("session-mode").checked ? client.connectSession(token) : client.connect(token)); }));
  $("resume-session").addEventListener("click", action(() => client.resumeSession()));
  $("disconnect").addEventListener("click", action(() => client.snapshot().transport === "session" ? client.logoutSession() : client.disconnect()));
  $("project").addEventListener("change", action(async () => { client.selectProject($("project").value); await client.loadViews(); }));
  $("refresh").addEventListener("click", action(() => client.loadViews()));
  $("preview-template").addEventListener("click", action(() => client.previewTemplate($("template").value)));
  $("update").addEventListener("submit", action(() => {
    const changes = { name: $("name").value, filter: $("filter").value };
    if ($("layout").value) changes.layout = $("layout").value;
    return client.previewUpdate($("view").value, changes);
  }));
  $("view").addEventListener("change", () => {
    const view = client.snapshot().views?.views.find((v) => v.id === $("view").value);
    $("name").value = view?.name || ""; $("filter").value = view?.filter || ""; $("layout").value = "";
    client.invalidatePlan();
  });
  for (const id of ["template", "name", "filter", "layout"]) $(id).addEventListener("input", () => client.invalidatePlan());
  $("approve").addEventListener("change", () => {
    const state = client.snapshot();
    $("apply").disabled = !$("approve").checked || !state.target?.canWriteViews || !state.plan
      || state.busy || Date.parse(state.plan.artifact.expiresAt) <= Date.now()
      || state.plan.artifact.actions.some((a) => a.action === "blocked");
  });
  $("apply").addEventListener("click", action(() => client.apply($("approve").checked)));
  lifecycle.addEventListener("pagehide", () => client.disconnect());
  render(client.snapshot());
  return client;
}
if (typeof document !== "undefined") mountViewConsole(document);
