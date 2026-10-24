// Management contract client. No browser credential persistence or automatic mutation retries.
export function createAdminConsole(fetcher = fetch, onChange = () => {}, uuid = () => crypto.randomUUID()) {
  const empty = () => ({ connected: false, busy: false, overview: null, oneTime: null, error: null, result: null, uncertain: false });
  let model = empty(), csrf = "", generation = 0, clearTimer, sessionTimer;
  const snapshot = () => structuredClone(model), notify = () => onChange(snapshot());
  function clearSecret() { clearTimeout(clearTimer); model.oneTime = null; }
  function clear() { generation++; clearTimeout(sessionTimer); csrf = ""; clearSecret(); model = empty(); notify(); }
  async function run(work) {
    if (model.busy) throw new Error("ADMIN_BUSY");
    const current = generation; clearSecret(); model.busy = true; model.error = null; notify();
    const request = async (path, body, bearer) => {
      if (current !== generation) throw new Error("ADMIN_STATE_CHANGED");
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetcher("/api/admin/v1/" + path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(csrf && body !== undefined ? { "X-CSRF-Token": csrf } : {}), ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
        const payload = await response.json(); if (current !== generation) throw new Error("ADMIN_STATE_CHANGED");
        if (!response.ok || payload.ok !== true) {
          clearSecret(); if ([401, 403].includes(response.status)) { csrf = ""; model.connected = false; model.overview = null; }
          const code = payload.error?.code; throw new Error(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(code) ? code : "ADMIN_REQUEST_FAILED");
        }
        return payload.data;
      } catch (error) {
        if (current !== generation) throw new Error("ADMIN_STATE_CHANGED");
        if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) throw error;
        throw new Error(body !== undefined && path !== "session" && path !== "logout" ? "ADMIN_OUTCOME_UNKNOWN" : "ADMIN_REQUEST_FAILED");
      } finally { clearTimeout(timeout); }
    };
    try { return await work(request); }
    catch (error) { if (generation === current) { model.error = error.message; clearSecret(); } throw error; }
    finally { if (generation === current) { model.busy = false; notify(); } }
  }
  function bindSession(data) {
    if (!data.authenticated || !/^[A-Za-z0-9_-]{43}$/.test(data.csrf) || !Number.isSafeInteger(data.expiresAt)
      || data.expiresAt * 1000 <= Date.now() || data.expiresAt * 1000 > Date.now() + 900000) throw new Error("ADMIN_SESSION_INVALID");
    clearTimeout(sessionTimer); csrf = data.csrf;
    sessionTimer = setTimeout(clear, data.expiresAt * 1000 - Date.now());
  }
  const overview = async (request) => {
    const data = await request("overview");
    if (!data || !Array.isArray(data.users) || !Array.isArray(data.credentials) || !Array.isArray(data.audit) || typeof data.actorId !== "string") throw new Error("ADMIN_RESPONSE_INVALID");
    model.overview = data; model.connected = true; return snapshot();
  };
  return {
    snapshot, clear, hideSecret() { clearSecret(); notify(); },
    async connect(bearer) {
      if (model.busy) throw new Error("ADMIN_BUSY"); clear();
      const token = String(bearer).trim(); if (!token || token.length > 16384 || /\s/.test(token)) throw new Error("ADMIN_TOKEN_INVALID");
      return run(async (request) => { const data = await request("session", {}, token);
        bindSession(data); return overview(request); });
    },
    resume() { return run(async (request) => { const data = await request("session");
      bindSession(data); return overview(request); }); },
    reload() { return run((request) => overview(request)); },
    async logout() { if (model.busy) throw new Error("ADMIN_BUSY"); try { return await run((request) => request("logout", {})); } finally { clear(); } },
    mutate(path, input, approved) {
      if (!approved) return Promise.reject(new Error("ADMIN_APPROVAL_REQUIRED"));
      if (!model.connected || !csrf) return Promise.reject(new Error("ADMIN_SESSION_REQUIRED"));
      if (model.uncertain) return Promise.reject(new Error("ADMIN_RECONCILIATION_REQUIRED"));
      if (!["users", "users/update", "credentials", "credentials/revoke"].includes(path)) return Promise.reject(new Error("ADMIN_ROUTE_INVALID"));
      return run(async (request) => {
        // Latch before sending: if response/audit/refresh fails, no new operation is silently issued.
        model.uncertain = true; const operationId = uuid(); model.result = { operationId, state: "pending" };
        const data = await request(path, { ...input, operationId });
        model.result = { operationId, state: data.replayed ? "already-applied" : "confirmed", target: data.target };
        await overview(request); model.uncertain = false;
        if (data.secret && ((data.syntheticOnly === true && /^synthetic-only-[A-Za-z0-9-]{1,100}$/.test(data.secret)) || (path === "credentials" && data.operationId === operationId && data.syntheticOnly === false && data.candidateAccepted === true && data.replayed === false && /^gypk_[A-Za-z0-9_-]{43}$/.test(data.secret)))) {
          model.oneTime = data.secret; clearTimer = setTimeout(() => { clearSecret(); notify(); }, 30000);
        }
        return snapshot();
      });
    },
    // Manual reconciliation only after a fresh list read; never recreates/replays an operation.
    reconcile() { return run(async (request) => { await overview(request); model.uncertain = false; model.result = null; return snapshot(); }); },
  };
}

export function mountAdminConsole(document, clientFactory = createAdminConsole) {
  const $ = (id) => document.getElementById(id);
  const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const field = (label, value, type = "text") => { const holder = element("label", label), input = element("input"); input.type = type; input.value = value; holder.append(input); return { holder, input }; };
  const action = (work) => async (event) => { event.preventDefault(); try { await work(); } catch (error) { $("status").textContent = error.message + " · 적용 상태를 확인하고 자동 재시도하지 마세요."; } };
  let client;
  function render(state) {
    $("identity").textContent = state.overview ? `${state.overview.actorId} · ${state.overview.syntheticOnly ? "합성 관리 저장소 · 실제 권한 미부여" : "관리 기록"}` : "연결되지 않음";
    $("status").textContent = (state.error ?? (state.uncertain ? "결과 확인 필요: 목록과 감사 기록을 확인하세요." : state.busy ? "처리 중" : "")) + (state.result ? ` · 작업 ${state.result.operationId}: ${state.result.state}` : "");
    $("secret").textContent = state.oneTime ?? ""; $("one-time").hidden = !state.oneTime;
    $("users").replaceChildren(); $("keys").replaceChildren(); $("audit").replaceChildren();
    for (const user of state.overview?.users ?? []) {
      const record = element("div"); record.className = "record"; record.append(element("h3", user.displayName), element("p", user.subject));
      const form = element("form"), roles = element("select"); roles.setAttribute("aria-label", "사용자 역할");
      for (const role of ["viewer", "member", "admin"]) { const option = element("option", role); option.value = role; option.selected = role === user.role; roles.append(option); }
      const projects = field("전체 Project ID", user.projectIds.join(", "));
      const enabled = field("활성", "", "checkbox"); enabled.input.checked = user.enabled;
      const approved = field("변경/발급 승인", "", "checkbox"); const save = element("button", "역할·범위 저장"), issue = element("button", state.overview.syntheticOnly ? "합성 키 발급" : "키 발급"); issue.type = "button";
      save.disabled = !user.canUpdate; issue.disabled = !user.canIssue;
      form.append(roles, projects.holder, enabled.holder, approved.holder, save, issue);
      form.addEventListener("submit", action(() => client.mutate("users/update", { subject: user.subject, expectedVersion: user.version, role: roles.value, projectIds: projects.input.value.split(",").map((s) => s.trim()).filter(Boolean), enabled: enabled.input.checked }, approved.input.checked)));
      issue.addEventListener("click", action(() => client.mutate("credentials", { subject: user.subject, expectedVersion: user.version }, approved.input.checked)));
      record.append(form); $("users").append(record);
    }
    for (const key of state.overview?.credentials ?? []) {
      const record = element("div"); record.className = "record"; record.append(element("p", `${key.id} · ${key.subject} · ${key.revoked ? "폐기됨" : "활성 metadata"}`));
      const approve = field("폐기 승인", "", "checkbox"), button = element("button", "키 폐기"); button.disabled = !key.canRevoke || key.revoked;
      button.addEventListener("click", action(() => client.mutate("credentials/revoke", { id: key.id, expectedVersion: key.version }, approve.input.checked)));
      record.append(approve.holder, button); $("keys").append(record);
    }
    for (const entry of state.overview?.audit ?? []) { const row = element("p", `${entry.actorId} · ${entry.operation} · ${entry.target}`); row.className = "record"; $("audit").append(row); }
    $("create-button").disabled = !state.overview?.canCreateUser;
    for (const button of document.querySelectorAll("button")) button.disabled = button.disabled || state.busy;
    // Top-level controls have no row capability state to preserve between renders.
    $("hide-secret").disabled = false; $("resume").disabled = state.busy; $("reload").disabled = state.busy || !state.connected; $("logout").disabled = state.busy || !state.connected;
    $("reconcile").disabled = state.busy || !state.connected || !state.uncertain;
    $("login").querySelector("button").disabled = state.busy;
  }
  client = clientFactory(fetch, render); render(client.snapshot());
  $("login").addEventListener("submit", action(() => { const token = $("bearer").value; $("bearer").value = ""; return client.connect(token); }));
  $("resume").addEventListener("click", action(() => client.resume()));
  $("reload").addEventListener("click", action(() => client.reload()));
  $("reconcile").addEventListener("click", action(() => client.reconcile()));
  $("logout").addEventListener("click", action(() => client.logout()));
  $("hide-secret").addEventListener("click", () => client.hideSecret());
  $("create-user").addEventListener("submit", action(() => client.mutate("users", { displayName: $("display-name").value, githubLogin: $("github-login").value,
    role: $("new-role").value, projectIds: $("projects").value.split(",").map((s) => s.trim()).filter(Boolean) }, $("create-approved").checked)));
  document.addEventListener("visibilitychange", () => { if (document.hidden) client.hideSecret(); });
  document.defaultView?.addEventListener("pagehide", () => { $("bearer").value = ""; client.clear(); });
  return client;
}
if (typeof document !== "undefined" && document.getElementById("login")) mountAdminConsole(document);
