/* 协同待办 H5：哈希路由 + 服务端 available_actions 驱动 UI */
(function () {
  "use strict";

  const root = document.getElementById("app");
  const UI = window.UI;
  const API = window.API;
  const { esc, icon, avatar } = UI;

  const state = {
    user: null,
    members: null,
    unread: 0,
    authMode: "login",
    orgMode: "create",
    list: { scope: "mine", status: "all", items: [], counts: {} },
    createAssignee: null,
    pollTimer: null,
  };

  let routeSeq = 0;

  const SCOPES = [
    ["mine", "待我处理"],
    ["created", "我创建的"],
    ["all", "团队全部"],
  ];
  const STATUS_FILTERS = [
    ["all", "全部"],
    ["pending", "待处理"],
    ["in_progress", "进行中"],
    ["completed", "已完成"],
    ["rejected", "已驳回"],
  ];
  const DEMO_USERS = [
    ["lin@demo.com", "林知夏"],
    ["chen@demo.com", "陈屿"],
    ["su@demo.com", "苏晚"],
  ];
  const NOTIF_META = {
    todo_created: { tone: "violet", icon: "inbox" },
    todo_assigned: { tone: "blue", icon: "play" },
    todo_transferred: { tone: "amber", icon: "swap" },
    todo_rejected: { tone: "red", icon: "xCircle" },
    todo_completed: { tone: "green", icon: "checkCircle" },
    todo_overdue: { tone: "red", icon: "alert" },
  };

  /* ---------------- 路由与通用 ---------------- */

  function navigate(path, options) {
    const opts = options || {};
    const hash = "#" + path;
    if (location.hash === hash) {
      route();
      return;
    }
    if (opts.replace) {
      history.replaceState(null, "", hash);
      route();
    } else {
      location.hash = path;
    }
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#/, "") || "/todos";
    const parts = raw.split("?");
    return { path: parts[0] || "/todos", query: new URLSearchParams(parts[1] || "") };
  }

  function safeRedirect(value) {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
      return "/todos";
    }
    return value;
  }

  async function route() {
    const seq = ++routeSeq;
    const { path, query } = parseRoute();

    if (!state.user) {
      if (path === "/login") {
        renderAuth(query);
        return;
      }
      const redirect = encodeURIComponent(path + (query.toString() ? "?" + query.toString() : ""));
      navigate("/login?redirect=" + redirect, { replace: true });
      return;
    }
    if (path === "/login") {
      navigate("/todos", { replace: true });
      return;
    }

    window.scrollTo(0, 0);
    const detailMatch = path.match(/^\/todos\/([^/]+)$/);
    if (path === "/todos") return renderList(seq);
    if (detailMatch) return renderDetail(decodeURIComponent(detailMatch[1]), seq);
    if (path === "/create") return renderCreate(seq);
    if (path === "/notifications") return renderNotifications(seq);
    navigate("/todos", { replace: true });
  }

  function simpleTopbar(title, slotHtml) {
    return (
      '<header class="topbar topbar--simple">' +
      '<button type="button" class="icon-btn" data-action="back" aria-label="返回">' + icon("arrowLeft", 21) + "</button>" +
      '<div class="topbar-title-wrap"><div class="topbar-title">' + esc(title) + "</div></div>" +
      (slotHtml ? '<div class="topbar-slot">' + slotHtml + "</div>" : "") +
      "</header>"
    );
  }

  function unreadBadge() {
    return (
      '<span class="notif-badge' + (state.unread ? "" : " is-hidden") + '" data-role="unread-badge">' +
      (state.unread > 99 ? "99+" : state.unread) + "</span>"
    );
  }

  function mainTopbar() {
    return (
      '<header class="topbar">' +
      '<div class="brand"><span class="brand-mark">' + icon("check", 18) + "</span>" +
      "<span><span class=\"brand-name\">协同待办</span><span class=\"brand-tag\">" + esc(state.user.org.name) + "</span></span></div>" +
      '<div class="topbar-actions">' +
      '<button type="button" class="icon-btn" data-action="open-notifications" aria-label="通知中心">' +
      icon("bell", 21) + unreadBadge() + "</button>" +
      '<button type="button" class="avatar-btn" data-action="toggle-menu" aria-label="账号菜单">' +
      avatar(state.user.display_name, 33) + "</button>" +
      "</div></header>"
    );
  }

  function userMenuHTML() {
    const code = state.user.org.code;
    return (
      '<div class="user-menu" role="menu">' +
      '<div class="user-menu-head">' + avatar(state.user.display_name, 40) +
      '<div><div class="user-menu-name">' + esc(state.user.display_name) + "</div>" +
      '<div class="user-menu-mail">' + esc(state.user.email) + "</div></div></div>" +
      '<div class="user-menu-divider"></div>' +
      '<div class="invite-row"><div><div class="invite-label">团队邀请码 · 分享给同事加入</div>' +
      '<div class="invite-code">' + esc(code) + "</div></div>" +
      '<button type="button" class="icon-btn" data-action="copy-invite" data-code="' + esc(code) + '" aria-label="复制邀请码">' +
      icon("copy", 18) + "</button></div>" +
      '<div class="user-menu-divider"></div>' +
      '<button type="button" class="menu-item" data-action="logout" role="menuitem">' +
      icon("logout", 17) + "退出登录</button></div>"
    );
  }

  function toggleUserMenu() {
    const existing = root.querySelector(".user-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const topbar = root.querySelector(".topbar");
    if (topbar) topbar.insertAdjacentHTML("beforeend", userMenuHTML());
  }

  function updateUnreadBadge() {
    document.querySelectorAll('[data-role="unread-badge"]').forEach((node) => {
      node.textContent = state.unread > 99 ? "99+" : String(state.unread);
      node.classList.toggle("is-hidden", !state.unread);
    });
  }

  async function refreshUnread() {
    if (!state.user) return;
    try {
      const data = await API.unreadCount();
      state.unread = data.unread;
      updateUnreadBadge();
    } catch (_error) {
      /* 静默失败，下一轮轮询会重试 */
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(() => {
      if (!document.hidden) refreshUnread();
    }, 25000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function resetSession() {
    state.user = null;
    state.members = null;
    state.unread = 0;
    state.list = { scope: "mine", status: "all", items: [], counts: {} };
    state.createAssignee = null;
    stopPolling();
  }

  async function logout() {
    try {
      await API.logout();
    } catch (_error) {
      /* 忽略网络错误，本地仍退出 */
    }
    resetSession();
    UI.toast("info", "已退出登录");
    navigate("/login", { replace: true });
  }

  /* ---------------- 登录 / 注册 ---------------- */

  function authTabs() {
    return (
      '<div class="auth-tabs" role="tablist">' +
      '<button type="button" class="auth-tab' + (state.authMode === "login" ? " is-active" : "") +
      '" data-auth-tab="login" role="tab" aria-selected="' + (state.authMode === "login") + '">登录</button>' +
      '<button type="button" class="auth-tab' + (state.authMode === "register" ? " is-active" : "") +
      '" data-auth-tab="register" role="tab" aria-selected="' + (state.authMode === "register") + '">注册</button></div>'
    );
  }

  function passwordField(label, hint) {
    return (
      '<label class="field"><span class="field-label">' + label + "<small>" + (hint || "") + "</small></span>" +
      '<span class="input-wrap"><span class="input-icon">' + icon("lock", 17) + "</span>" +
      '<input class="input input--with-icon input--password" type="password" name="password" ' +
      'placeholder="至少 8 位字符" autocomplete="current-password" minlength="8" maxlength="72" required>' +
      '<button type="button" class="input-suffix" data-toggle-password aria-label="显示密码">' + icon("eye", 18) + "</button></span></label>"
    );
  }

  function orgFieldHTML(mode) {
    if (mode === "join") {
      return (
        '<label class="field"><span class="field-label">团队邀请码<small>向管理员索取</small></span>' +
        '<span class="input-wrap"><span class="input-icon">' + icon("users", 17) + "</span>" +
        '<input class="input input--with-icon" name="org_code" placeholder="例如：XINGYE" maxlength="12" ' +
        'autocomplete="off" style="text-transform:uppercase" required></span></label>'
      );
    }
    return (
      '<label class="field"><span class="field-label">团队名称<small>创建后自动生成邀请码</small></span>' +
      '<span class="input-wrap"><span class="input-icon">' + icon("users", 17) + "</span>" +
      '<input class="input input--with-icon" name="org_name" placeholder="例如：星野产品实验室" maxlength="40"></span></label>'
    );
  }

  function authFormHTML() {
    if (state.authMode === "register") {
      return (
        '<form id="auth-form" class="auth-form" novalidate>' +
        '<label class="field"><span class="field-label">你的名字</span>' +
        '<span class="input-wrap"><span class="input-icon">' + icon("user", 17) + "</span>" +
        '<input class="input input--with-icon" name="display_name" placeholder="同事怎么称呼你" maxlength="24" autocomplete="nickname" required></span></label>' +
        '<label class="field"><span class="field-label">邮箱</span>' +
        '<span class="input-wrap"><span class="input-icon">' + icon("mail", 17) + "</span>" +
        '<input class="input input--with-icon" type="email" name="email" placeholder="name@company.com" autocomplete="email" required></span></label>' +
        passwordField("密码", "至少 8 位") +
        '<div class="field"><span class="field-label">团队</span>' +
        '<div class="org-mode">' +
        '<button type="button" data-org-mode="create" class="' + (state.orgMode === "create" ? "is-active" : "") + '">创建新团队</button>' +
        '<button type="button" data-org-mode="join" class="' + (state.orgMode === "join" ? "is-active" : "") + '">加入已有团队</button>' +
        "</div><div id=\"org-field\">" + orgFieldHTML(state.orgMode) + "</div></div>" +
        '<div class="form-error" role="alert"></div>' +
        '<button type="submit" class="btn btn-primary btn-block">创建账号并进入</button></form>'
      );
    }
    return (
      '<form id="auth-form" class="auth-form" novalidate>' +
      '<label class="field"><span class="field-label">邮箱</span>' +
      '<span class="input-wrap"><span class="input-icon">' + icon("mail", 17) + "</span>" +
      '<input class="input input--with-icon" type="email" name="email" placeholder="name@company.com" autocomplete="username" required></span></label>' +
      passwordField("密码", "默认演示密码 demo1234") +
      '<div class="form-error" role="alert"></div>' +
      '<button type="submit" class="btn btn-primary btn-block">登 录</button></form>'
    );
  }

  function demoBoxHTML() {
    return (
      '<div class="demo-box"><div class="demo-title">' + icon("sparkles", 14) + "体验账号 · 同一团队，密码均为 demo1234</div>" +
      '<div class="demo-users">' +
      DEMO_USERS.map(
        ([email, name]) =>
          '<button type="button" class="demo-user" data-demo-email="' + email + '">' +
          avatar(name, 24) + '<span class="demo-user-name">' + name + "</span></button>"
      ).join("") +
      '</div><p class="demo-tip">建议开两个浏览器窗口，分别登录不同成员体验指派与转交。</p></div>'
    );
  }

  function renderAuth(query) {
    root.innerHTML =
      '<div class="auth">' +
      '<div class="auth-hero">' +
      '<div class="auth-brand"><span class="brand-mark">' + icon("check", 20) + "</span>" +
      '<div><div class="auth-brand-name">协同待办</div><div class="auth-brand-sub">TEAM TODO, IN SYNC</div></div></div>' +
      '<h1 class="auth-headline">让每一件待办，<br>都<em>有人接住</em>。</h1>' +
      '<p class="auth-sub">指派、转交、驳回与完成，团队协作的每一步都有记录可循。</p>' +
      '<div class="auth-chips"><span class="status-chip tone-amber"><i class="status-dot"></i>待处理</span>' +
      '<span class="status-chip tone-blue"><i class="status-dot"></i>进行中</span>' +
      '<span class="status-chip tone-green"><i class="status-dot"></i>已完成</span>' +
      '<span class="status-chip tone-red"><i class="status-dot"></i>已驳回</span></div></div>' +
      '<div class="auth-card">' + authTabs() + authFormHTML() + demoBoxHTML() +
      '<p class="auth-foot">数据保存在本地数据库 · 所有状态流转均由服务端强制校验</p></div></div>';

    bindAuth(query);
  }

  function showFormError(form, message) {
    const node = form.querySelector(".form-error");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
  }

  function bindAuth(query) {
    const form = root.querySelector("#auth-form");
    if (!form) return;

    root.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.authMode = button.dataset.authTab;
        renderAuth(query);
      });
    });

    root.querySelectorAll("[data-org-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.orgMode = button.dataset.orgMode;
        root.querySelectorAll("[data-org-mode]").forEach((node) => {
          node.classList.toggle("is-active", node.dataset.orgMode === state.orgMode);
        });
        const holder = root.querySelector("#org-field");
        if (holder) holder.innerHTML = orgFieldHTML(state.orgMode);
      });
    });

    const passwordInput = form.querySelector('input[name="password"]');
    const toggle = form.querySelector("[data-toggle-password]");
    if (toggle && passwordInput) {
      toggle.addEventListener("click", () => {
        const visible = passwordInput.type === "text";
        passwordInput.type = visible ? "password" : "text";
        toggle.innerHTML = icon(visible ? "eye" : "eyeOff", 18);
        toggle.setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
      });
    }

    root.querySelectorAll("[data-demo-email]").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.authMode !== "login") {
          state.authMode = "login";
          renderAuth(query);
        }
        const currentForm = root.querySelector("#auth-form");
        currentForm.querySelector('input[name="email"]').value = button.dataset.demoEmail;
        currentForm.querySelector('input[name="password"]').value = "demo1234";
        currentForm.querySelector('input[name="password"]').focus();
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const data = new FormData(form);
      const email = String(data.get("email") || "").trim();
      const password = String(data.get("password") || "");

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showFormError(form, "请输入有效的邮箱地址");
        return;
      }
      if (password.length < 8) {
        showFormError(form, "密码至少需要 8 位字符");
        return;
      }

      let payload = null;
      if (state.authMode === "register") {
        const displayName = String(data.get("display_name") || "").trim();
        if (!displayName) {
          showFormError(form, "请填写你的名字");
          return;
        }
        payload = { email, password, display_name: displayName };
        if (state.orgMode === "join") {
          const code = String(data.get("org_code") || "").trim().toUpperCase();
          if (!code) {
            showFormError(form, "请输入团队邀请码");
            return;
          }
          payload.org_code = code;
        } else {
          payload.org_name = String(data.get("org_name") || "").trim() || undefined;
        }
      }

      submit.classList.add("is-loading");
      submit.disabled = true;
      try {
        const user = state.authMode === "login"
          ? await API.login(email, password)
          : await API.register(payload);
        state.user = user;
        state.members = null;
        UI.toast("success", state.authMode === "login" ? "欢迎回来，" + user.display_name : "账号已创建，欢迎加入");
        await refreshUnread();
        startPolling();
        navigate(safeRedirect(query.get("redirect")), { replace: true });
      } catch (error) {
        if (error.status === 401) return;
        showFormError(form, error.message);
        submit.classList.remove("is-loading");
        submit.disabled = false;
      }
    });
  }

  /* ---------------- 列表页 ---------------- */

  function statCards() {
    const counts = state.list.counts || {};
    const cards = [
      ["pending", "待处理"],
      ["in_progress", "进行中"],
      ["completed", "已完成"],
      ["rejected", "已驳回"],
    ];
    return cards
      .map(([status, label]) => {
        const meta = UI.STATUS[status];
        return (
          '<button type="button" class="stat-card tone-' + meta.tone + (state.list.status === status ? " is-active" : "") +
          '" data-action="filter-stat" data-status="' + status + '" aria-pressed="' + (state.list.status === status) + '">' +
          '<span class="stat-label">' + label + "</span>" +
          '<strong class="stat-value">' + (counts[status] || 0) + "</strong></button>"
        );
      })
      .join("");
  }

  function scopeSubtitle() {
    const counts = state.list.counts || {};
    const open = (counts.pending || 0) + (counts.in_progress || 0);
    if (state.list.scope === "mine") {
      return "还有 <strong>" + open + "</strong> 件待办在路上" + (counts.completed ? " · 已完成 <strong>" + counts.completed + "</strong> 件" : "");
    }
    if (state.list.scope === "created") {
      return "你发起了 <strong>" + (counts.all || 0) + "</strong> 件待办 · 进行中 <strong>" + (counts.in_progress || 0) + "</strong> 件";
    }
    return "团队共 <strong>" + (counts.all || 0) + "</strong> 件待办 · 待处理 <strong>" + (counts.pending || 0) + "</strong> 件";
  }

  function filterChips() {
    const counts = state.list.counts || {};
    return STATUS_FILTERS.map(([value, label]) => {
      const amount = value === "all" ? counts.all || 0 : counts[value] || 0;
      return (
        '<button type="button" class="filter-chip' + (state.list.status === value ? " is-active" : "") +
        '" data-action="set-filter" data-status="' + value + '">' + label +
        '<span class="filter-count">' + amount + "</span></button>"
      );
    }).join("");
  }

  function todoCard(todo, index) {
    const due = UI.dueText(todo.due_date, todo.status, todo.is_overdue);
    const self = todo.assignee.id === state.user.id;
    const creator = todo.creator.id === state.user.id ? "我创建" : "由 " + esc(todo.creator.display_name) + " 创建";
    const dueClass = due.overdue ? "tone-danger" : due.tone === "warn" ? "tone-warn" : "";
    return (
      '<article class="todo-card status-' + todo.status + (todo.status === "completed" ? " is-done" : "") +
      '" role="button" tabindex="0" data-action="open-todo" data-id="' + todo.id + '" style="--i:' + index + '">' +
      '<div class="todo-card-head">' + UI.statusChip(todo.status) +
      '<span class="todo-due ' + dueClass + '">' + icon(due.overdue ? "alert" : "calendar", 12) + esc(due.label) + "</span></div>" +
      '<h3 class="todo-title">' + esc(todo.title) + "</h3>" +
      (todo.description ? '<p class="todo-desc">' + esc(todo.description) + "</p>" : "") +
      '<div class="todo-card-foot"><span class="todo-assignee">' + avatar(todo.assignee.display_name, 22) +
      '<span class="todo-owner">' + esc(todo.assignee.display_name) + (self ? " · 我" : "") + "</span></span>" +
      '<span class="todo-creator">' + creator + "</span>" +
      '<span class="todo-arrow">' + icon("chevronRight", 16) + "</span></div></article>"
    );
  }

  function listContentHTML() {
    const items = state.list.items || [];
    if (!items.length) {
      let description = "这个状态下还没有待办";
      if (state.list.status !== "all") {
        return UI.emptyState(
          "inbox",
          "「" + (STATUS_FILTERS.find(([value]) => value === state.list.status) || [])[1] + "」下暂无待办",
          "换个筛选条件，或者创建一件新的待办。",
          '<button type="button" class="btn btn-outline btn-inline" data-action="clear-filter">查看全部</button>'
        );
      }
      if (state.list.scope === "mine") description = "暂时没有待你处理的待办，享受这一刻。";
      else if (state.list.scope === "created") description = "你还没有发起过待办，把第一件事交出去吧。";
      else description = "团队里还没有待办，创建第一件开始协作。";
      const action = state.user
        ? '<button type="button" class="btn btn-primary btn-inline" data-action="open-create">' + icon("plus", 16) + "新建待办</button>"
        : "";
      return UI.emptyState("clipboard", "这里很清爽", description, action);
    }
    return (
      '<div class="list-heading"><h2>' +
      (state.list.status === "all" ? "全部待办" : (STATUS_FILTERS.find(([value]) => value === state.list.status) || [])[1]) +
      "</h2><span>共 " + items.length + " 件</span></div>" +
      '<div class="todo-list">' + items.map(todoCard).join("") + "</div>"
    );
  }

  function listPageHTML(contentHTML) {
    return (
      '<div class="screen list-screen">' + mainTopbar() +
      '<section class="hero"><p class="hero-date">' + UI.todayText() + "</p>" +
      '<h1 class="hero-greeting">' + UI.greeting() + '，<span class="hero-name">' + esc(state.user.display_name) + "</span></h1>" +
      '<p class="hero-sub">' + scopeSubtitle() + "</p></section>" +
      '<div class="stat-grid">' + statCards() + "</div>" +
      '<div class="segmented">' +
      SCOPES.map(
        ([value, label]) =>
          '<button type="button" class="segmented-btn' + (state.list.scope === value ? " is-active" : "") +
          '" data-action="set-scope" data-scope="' + value + '">' + label + "</button>"
      ).join("") +
      '</div><div class="filter-row">' + filterChips() + "</div>" +
      contentHTML + "</div>" +
      '<div class="floating-layer"><button type="button" class="fab" data-action="open-create" aria-label="新建待办">' +
      icon("plus", 26) + "</button></div>"
    );
  }

  async function renderList(seq) {
    root.innerHTML = listPageHTML(UI.skeletonList(3));
    try {
      const data = await API.listTodos(state.list.scope, state.list.status);
      if (seq !== routeSeq) return;
      state.list.items = data.items;
      state.list.counts = data.counts;
      root.innerHTML = listPageHTML(listContentHTML());
      refreshUnread();
    } catch (error) {
      if (seq !== routeSeq || error.status === 401) return;
      root.innerHTML = listPageHTML(UI.errorState(error.message, "retry-list"));
    }
  }

  async function reloadList() {
    const seq = ++routeSeq;
    await renderList(seq);
  }

  /* ---------------- 详情页 ---------------- */

  function detailBanner(todo) {
    const isAssignee = todo.assignee.id === state.user.id;
    const meta = UI.STATUS[todo.status];
    let title = meta.label;
    let text = "";
    if (todo.status === "pending") {
      title = isAssignee ? "这件待办在等你" : "等待负责人确认";
      text = isAssignee
        ? "确认接收后进入处理中，也可以转交或驳回。"
        : "等待 " + todo.assignee.display_name + " 确认接收。";
    } else if (todo.status === "in_progress") {
      title = "正在处理中";
      text = isAssignee ? "完成后记得标记完成，或把责任转交给同事。" : todo.assignee.display_name + " 正在推进这件事。";
    } else if (todo.status === "completed") {
      title = "这件待办已完成";
      text = "流转记录已归档，可以随时回看处理过程。";
    } else if (todo.status === "rejected") {
      title = "这件待办被驳回";
      text = "驳回原因已记录，创建者可以评估后重新创建。";
    }
    return (
      '<div class="detail-status-banner tone-' + meta.tone + '">' +
      '<span class="detail-status-icon">' + icon(meta.icon, 18) + "</span>" +
      '<div><p class="detail-status-title">' + esc(title) + '</p><p class="detail-status-text">' + esc(text) + "</p></div></div>"
    );
  }

  function infoRow(iconName, label, valueHTML, danger) {
    return (
      '<div class="info-row"><span class="info-icon">' + icon(iconName, 15) + "</span>" +
      '<span class="info-label">' + esc(label) + "</span>" +
      '<span class="info-value' + (danger ? " is-danger" : "") + '">' + valueHTML + "</span></div>"
    );
  }

  function detailContentHTML(todo) {
    const due = UI.dueText(todo.due_date, todo.status, todo.is_overdue);
    const isSelfAssignee = todo.assignee.id === state.user.id;
    const isSelfCreator = todo.creator.id === state.user.id;
    const history = (todo.history || []).slice().reverse();
    const actions = todo.available_actions || [];

    return (
      '<div class="screen' + (actions.length ? " screen--with-bar" : "") + '">' +
      '<header class="topbar topbar--simple">' +
      '<button type="button" class="icon-btn" data-action="back" aria-label="返回">' + icon("arrowLeft", 21) + "</button>" +
      '<div class="topbar-title-wrap"><div class="topbar-title">待办详情</div></div>' +
      '<div class="topbar-slot">' + UI.statusChip(todo.status) + "</div></header>" +
      detailBanner(todo) +
      '<h1 class="detail-title">' + esc(todo.title) + "</h1>" +
      '<p class="detail-meta-line"><span>' + (isSelfCreator ? "我创建" : "由 " + esc(todo.creator.display_name) + " 创建") + "</span>" +
      '<span class="dot"></span><span>更新于 ' + esc(UI.relTime(todo.updated_at)) + "</span></p>" +
      (todo.status === "rejected" && todo.reject_reason
        ? '<div class="reject-callout">' + icon("xCircle", 17) +
          "<div><strong>驳回原因</strong>" + esc(todo.reject_reason) + "</div></div>"
        : "") +
      '<section class="detail-card"><div class="card-heading"><h2>任务描述</h2></div>' +
      '<p class="detail-desc' + (todo.description ? "" : " is-empty") + '">' +
      (todo.description ? esc(todo.description) : "创建者没有填写描述。") + "</p></section>" +
      '<section class="detail-card"><div class="card-heading"><h2>协作信息</h2></div><div class="info-list">' +
      infoRow("user", "负责人", avatar(todo.assignee.display_name, 22) + "<span>" + esc(todo.assignee.display_name) +
        (isSelfAssignee ? '<span class="tag">我</span>' : "") + "</span>") +
      infoRow("sparkles", "创建者", "<span>" + esc(todo.creator.display_name) + (isSelfCreator ? '<span class="tag">我</span>' : "") + "</span>") +
      infoRow("calendar", "截止时间", '<span title="' + esc(todo.due_date || "") + '">' + esc(due.label) + "</span>", due.overdue) +
      infoRow("clock", "创建时间", "<span>" + esc(UI.fmtDateTime(todo.created_at)) + "</span>") +
      "</div></section>" +
      '<section class="detail-card"><div class="card-heading"><h2>流转记录</h2><span>' + history.length + " 条 · 服务端审计</span></div>" +
      '<ul class="timeline">' + history.map(UI.historyLine).join("") + "</ul></section>" +
      (actions.length
        ? ""
        : '<p class="detail-empty-actions">当前状态下你没有可执行的操作</p>') +
      "</div>" +
      (actions.length ? actionBarHTML(todo) : "")
    );
  }

  function actionBarHTML(todo) {
    const actions = todo.available_actions || [];
    const primary = actions.includes("assign") ? "assign" : actions.includes("complete") ? "complete" : null;
    const transfer = actions.includes("transfer");
    const reject = actions.includes("reject");
    const primaryMeta = primary ? UI.ACTIONS[primary] : null;
    const secondary = [];
    if (transfer) secondary.push("transfer");
    if (reject) secondary.push("reject");
    const secondaryHTML = secondary
      .map((action) => {
        const meta = UI.ACTIONS[action];
        const cls = action === "reject" ? "btn-ghost-danger" : "btn-outline";
        return (
          '<button type="button" class="btn ' + cls + " " + (secondary.length === 1 ? "btn-span" : "") +
          '" data-action="' + (action === "transfer" ? "open-transfer" : "open-reject") + '" data-id="' + todo.id + '">' +
          icon(meta.icon, 17) + esc(meta.label) + "</button>"
        );
      })
      .join("");

    const hint = primary === "assign"
      ? "确认接收后进入「进行中」"
      : primary === "complete"
        ? "完成后状态将变为「已完成」"
        : "";

    return (
      '<div class="floating-layer detail-actions"><div class="action-bar">' +
      (primaryMeta
        ? '<button type="button" class="btn btn-primary btn-block" data-action="do-transition" data-act="' + primary +
          '" data-id="' + todo.id + '">' + icon(primaryMeta.icon, 18) + esc(primaryMeta.label) + "</button>"
        : "") +
      (secondary.length ? '<div class="action-grid" style="margin-top:' + (primaryMeta ? "8px" : "0") + '">' + secondaryHTML + "</div>" : "") +
      (hint ? '<p class="action-hint">' + icon("info", 12) + esc(hint) + "</p>" : "") +
      "</div></div>"
    );
  }

  function setDetail(todo) {
    root.innerHTML = detailContentHTML(todo);
  }

  async function renderDetail(todoId, seq) {
    root.innerHTML =
      '<div class="screen">' + simpleTopbar("待办详情") + '<div class="screen-body">' + UI.skeletonDetail() + "</div></div>";
    try {
      const todo = await API.getTodo(todoId);
      if (seq !== routeSeq) return;
      setDetail(todo);
      refreshUnread();
    } catch (error) {
      if (seq !== routeSeq || error.status === 401) return;
      root.innerHTML =
        '<div class="screen">' + simpleTopbar("待办详情") + '<div class="screen-body">' +
        UI.emptyState("alert", "无法打开待办", error.message,
          '<button type="button" class="btn btn-outline btn-inline" data-action="back">返回列表</button>') +
        "</div></div>";
    }
  }

  async function runTransition(todo, payload, successMessage) {
    try {
      const updated = await API.transitionTodo(todo.id, payload);
      setDetail(updated);
      window.scrollTo({ top: 0, behavior: "smooth" });
      UI.toast("success", successMessage);
      refreshUnread();
    } catch (error) {
      if (error.status === 401) return;
      UI.toast("error", error.message);
      const button = root.querySelector(".btn.is-loading");
      if (button) {
        button.classList.remove("is-loading");
        button.disabled = false;
      }
    }
  }

  function memberOptionsHTML(members, selectedId) {
    return members
      .map(
        (member) =>
          '<button type="button" class="sheet-option' + (member.id === selectedId ? " is-selected" : "") +
          '" data-member-id="' + member.id + '" data-member-name="' + esc(member.display_name) + '">' +
          avatar(member.display_name, 30) +
          '<span class="sheet-option-text"><span class="sheet-option-name">' + esc(member.display_name) +
          (member.is_self ? " · 我" : "") + '</span><span class="sheet-option-sub">' + esc(member.email) + "</span></span>" +
          '<span class="check-dot">' + icon("check", 12) + "</span></button>"
      )
      .join("");
  }

  async function openTransferSheet(todo) {
    let members = state.members;
    if (!members) {
      try {
        members = await API.members();
        state.members = members;
      } catch (error) {
        UI.toast("error", error.message);
        return;
      }
    }
    const candidates = members.filter((member) => member.id !== todo.assignee.id);
    const sheet = UI.openSheet({
      title: "转交待办",
      subtitle: "当前负责人：" + todo.assignee.display_name + " · 转交后状态回到待处理",
      content: candidates.length
        ? '<div class="member-options">' + memberOptionsHTML(candidates, null) + "</div>"
        : '<div class="sheet-empty">团队里暂时没有可以转交的其他成员</div>',
      footer: candidates.length
        ? '<button type="button" class="btn btn-primary btn-block" data-role="confirm-transfer" disabled>确认转交</button>'
        : "",
    });
    if (!sheet) return;

    let selected = null;
    sheet.element.addEventListener("click", (event) => {
      const option = event.target.closest("[data-member-id]");
      if (option) {
        sheet.element.querySelectorAll("[data-member-id]").forEach((node) => {
          node.classList.toggle("is-selected", node === option);
        });
        selected = { id: option.dataset.memberId, name: option.dataset.memberName };
        const confirm = sheet.element.querySelector('[data-role="confirm-transfer"]');
        if (confirm) confirm.disabled = false;
        return;
      }
      const confirm = event.target.closest('[data-role="confirm-transfer"]');
      if (!confirm || !selected) return;
      sheet.close();
      runTransition(todo, { action: "transfer", new_assignee_id: selected.id }, "已转交给 " + selected.name);
    });
  }

  function openRejectSheet(todo) {
    const reasons = ["信息不足，无法开始", "不在我的职责范围内", "当前排期已满，建议下周再排"];
    const sheet = UI.openSheet({
      title: "驳回待办",
      subtitle: "驳回后进入「已驳回」状态，创建者会收到通知",
      content:
        '<div class="reason-chips">' +
        reasons.map((reason) => '<button type="button" class="quick-chip" data-reason="' + esc(reason) + '">' + esc(reason) + "</button>").join("") +
        '</div><textarea class="sheet-textarea" data-role="reject-reason" maxlength="500" placeholder="请说明驳回原因（必填）" data-autofocus></textarea>' +
        '<div class="sheet-meta-line"><span>原因会记录在流转历史中</span><span data-role="reason-count">0/500</span></div>' +
        '<p class="sheet-error" data-role="reject-error">请填写驳回原因</p>',
      footer: '<button type="button" class="btn btn-danger btn-block" data-role="confirm-reject" disabled>确认驳回</button>',
    });
    if (!sheet) return;

    const area = sheet.element.querySelector('[data-role="reject-reason"]');
    const confirm = sheet.element.querySelector('[data-role="confirm-reject"]');
    const counter = sheet.element.querySelector('[data-role="reason-count"]');
    const errorNode = sheet.element.querySelector('[data-role="reject-error"]');

    function sync() {
      const value = area.value.trim();
      counter.textContent = area.value.length + "/500";
      confirm.disabled = !value;
      if (value) errorNode.classList.remove("is-visible");
    }

    area.addEventListener("input", sync);
    sheet.element.querySelectorAll("[data-reason]").forEach((chip) => {
      chip.addEventListener("click", () => {
        area.value = chip.dataset.reason;
        sync();
        area.focus();
      });
    });
    confirm.addEventListener("click", () => {
      const reason = area.value.trim();
      if (!reason) {
        errorNode.classList.add("is-visible");
        return;
      }
      sheet.close();
      runTransition(todo, { action: "reject", reject_reason: reason }, "已驳回，创建者会收到通知");
    });
  }

  /* ---------------- 新建页 ---------------- */

  function createMemberOptions(members, selectedId) {
    return members
      .map(
        (member) =>
          '<button type="button" class="member-option' + (member.id === selectedId ? " is-selected" : "") +
          '" data-assignee="' + member.id + '" data-name="' + esc(member.display_name) + '">' +
          avatar(member.display_name, 27) +
          '<span class="member-option-text"><span class="member-option-name">' + esc(member.display_name) +
          (member.is_self ? " · 我" : "") + '</span><span class="member-option-sub">' + esc(member.email) + "</span></span>" +
          '<span class="check-dot">' + icon("check", 11) + "</span></button>"
      )
      .join("");
  }

  function localInputValue(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return (
      date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) + ":" + pad(date.getMinutes())
    );
  }

  async function renderCreate(seq) {
    root.innerHTML =
      '<div class="screen form-screen">' + simpleTopbar("新建待办") +
      '<div class="screen-body"><div class="loading-row"><span class="spinner"></span>正在加载团队成员…</div></div></div>';
    try {
      if (!state.members) state.members = await API.members();
    } catch (error) {
      if (seq !== routeSeq || error.status === 401) return;
      root.innerHTML =
        '<div class="screen">' + simpleTopbar("新建待办") + '<div class="screen-body">' +
        UI.errorState(error.message, "retry-create") + "</div></div>";
      return;
    }
    if (seq !== routeSeq) return;

    const members = state.members;
    const self = members.find((member) => member.is_self);
    const selectedId = state.createAssignee || (self ? self.id : members[0] && members[0].id);
    state.createAssignee = selectedId;

    root.innerHTML =
      '<div class="screen form-screen">' + simpleTopbar("新建待办") +
      '<div class="form-intro"><h1>把一件事，交给对的人</h1><p>创建后会立即指派给负责人，并进入「待处理」。</p></div>' +
      '<form id="create-form" class="form-card" novalidate>' +
      '<div class="form-section"><label class="field"><span class="field-label">待办标题<small>必填</small></span>' +
      '<input class="input" name="title" placeholder="例如：整理 V1.2 版本发布清单" maxlength="200" autocomplete="off" required></label></div>' +
      '<div class="form-section"><label class="field"><span class="field-label">任务描述<small>可选</small></span>' +
      '<textarea class="textarea" name="description" maxlength="2000" placeholder="补充背景、验收标准或注意事项…"></textarea></label></div>' +
      '<div class="form-section"><div class="field-label">负责人<small>同一团队成员</small></div>' +
      '<div class="member-picker" id="assignee-picker">' + createMemberOptions(members, selectedId) + "</div></div>" +
      '<div class="form-section"><div class="field"><span class="field-label">截止时间<small>可选</small></span>' +
      '<input class="input" type="datetime-local" name="due_date">' +
      '<div class="quick-row"><button type="button" class="quick-chip" data-quick-due="today">今天 18:00</button>' +
      '<button type="button" class="quick-chip" data-quick-due="tomorrow">明天 18:00</button>' +
      '<button type="button" class="quick-chip" data-quick-due="nextweek">下周一 10:00</button>' +
      '<button type="button" class="quick-chip" data-quick-due="clear">不设置</button></div></div></div>' +
      '<button type="submit" class="btn btn-primary btn-block">' + icon("send", 17) + "创建并指派</button></form></div>";

    const form = root.querySelector("#create-form");
    const dueInput = form.querySelector('input[name="due_date"]');

    root.querySelectorAll("[data-assignee]").forEach((option) => {
      option.addEventListener("click", () => {
        state.createAssignee = option.dataset.assignee;
        root.querySelectorAll("[data-assignee]").forEach((node) => {
          node.classList.toggle("is-selected", node === option);
        });
      });
    });

    root.querySelectorAll("[data-quick-due]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const kind = chip.dataset.quickDue;
        if (kind === "clear") {
          dueInput.value = "";
          return;
        }
        const date = new Date();
        if (kind === "tomorrow") date.setDate(date.getDate() + 1);
        if (kind === "nextweek") {
          const today = date.getDay();
          const delta = ((8 - today) % 7) || 7;
          date.setDate(date.getDate() + delta);
          date.setHours(10, 0, 0, 0);
        } else {
          date.setHours(18, 0, 0, 0);
        }
        dueInput.value = localInputValue(date);
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const title = form.querySelector('input[name="title"]').value.trim();
      const description = form.querySelector("textarea[name=\"description\"]").value.trim();
      const dueRaw = dueInput.value;
      if (!title) {
        UI.toast("error", "请填写待办标题");
        form.querySelector('input[name="title"]').focus();
        return;
      }
      if (!state.createAssignee) {
        UI.toast("error", "请选择负责人");
        return;
      }
      const payload = {
        title,
        description: description || null,
        assignee_id: state.createAssignee,
        due_date: dueRaw ? new Date(dueRaw).toISOString() : null,
      };
      submit.classList.add("is-loading");
      submit.disabled = true;
      try {
        const todo = await API.createTodo(payload);
        const assigneeName = (state.members.find((member) => member.id === state.createAssignee) || {}).display_name || "负责人";
        state.createAssignee = null;
        UI.toast("success", "已创建并指派给 " + assigneeName);
        navigate("/todos/" + todo.id, { replace: true });
      } catch (error) {
        if (error.status === 401) return;
        UI.toast("error", error.message);
        submit.classList.remove("is-loading");
        submit.disabled = false;
      }
    });
  }

  /* ---------------- 通知页 ---------------- */

  function notificationItem(item) {
    const meta = NOTIF_META[item.type] || { tone: "violet", icon: "bell" };
    return (
      '<button type="button" class="notif-item' + (item.is_read ? "" : " is-unread") +
      '" data-action="open-notification" data-id="' + item.id + '" data-todo-id="' + (item.todo_id || "") + '">' +
      '<span class="notif-icon tone-' + meta.tone + '">' + icon(meta.icon, 17) + "</span>" +
      '<span class="notif-content"><span class="notif-title-row"><span class="notif-title">' + esc(item.title) + "</span>" +
      (item.is_read ? "" : '<span class="notif-unread-dot"></span>') + "</span>" +
      '<span class="notif-body">' + esc(item.body || "") + "</span>" +
      '<span class="notif-time">' + esc(UI.relTime(item.created_at)) + "</span></span>" +
      '<span class="notif-chevron">' + icon("chevronRight", 15) + "</span></button>"
    );
  }

  function notificationsBody(items) {
    if (!items.length) {
      return UI.emptyState("bell", "暂无通知", "指派、转交、驳回与完成的动态会汇到这里。");
    }
    const groups = { 今天: [], 昨天: [], 更早: [] };
    items.forEach((item) => {
      const date = new Date(item.created_at);
      const today = new Date();
      const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const days = Math.round((startToday - startDate) / 86400000);
      if (days <= 0) groups["今天"].push(item);
      else if (days === 1) groups["昨天"].push(item);
      else groups["更早"].push(item);
    });
    return Object.keys(groups)
      .filter((key) => groups[key].length)
      .map(
        (key) =>
          '<section class="notif-group"><h2 class="notif-group-title">' + key + "</h2>" +
          '<div class="notif-list">' + groups[key].map(notificationItem).join("") + "</div></section>"
      )
      .join("");
  }

  async function renderNotifications(seq) {
    root.innerHTML =
      '<div class="screen notif-screen">' +
      simpleTopbar(
        "通知中心",
        '<button type="button" class="text-btn" data-action="read-all" disabled>全部已读</button>'
      ) +
      '<div class="screen-body"><div class="loading-row"><span class="spinner"></span>正在加载通知…</div></div></div>';
    try {
      const data = await API.notifications();
      if (seq !== routeSeq) return;
      state.unread = data.unread;
      updateUnreadBadge();
      root.innerHTML =
        '<div class="screen notif-screen">' +
        simpleTopbar(
          "通知中心",
          '<button type="button" class="text-btn" data-action="read-all"' + (data.unread ? "" : " disabled") + ">全部已读</button>"
        ) +
        '<div class="screen-body">' +
        '<p class="muted" style="font-size:11px;padding:0 2px 8px">共 ' + data.items.length + " 条 · " + data.unread + " 条未读</p>" +
        notificationsBody(data.items) + "</div></div>";
    } catch (error) {
      if (seq !== routeSeq || error.status === 401) return;
      root.innerHTML =
        '<div class="screen notif-screen">' + simpleTopbar("通知中心") +
        '<div class="screen-body">' + UI.errorState(error.message, "retry-notifications") + "</div></div>";
    }
  }

  async function readAllNotifications() {
    try {
      await API.readAll();
      state.unread = 0;
      updateUnreadBadge();
      root.querySelectorAll(".notif-item").forEach((item) => {
        item.classList.remove("is-unread");
        const dot = item.querySelector(".notif-unread-dot");
        if (dot) dot.remove();
      });
      const button = root.querySelector('[data-action="read-all"]');
      if (button) button.disabled = true;
      const summary = root.querySelector(".screen-body .muted");
      if (summary) summary.textContent = "全部通知已读";
      UI.toast("success", "已全部标记为已读");
    } catch (error) {
      if (error.status === 401) return;
      UI.toast("error", error.message);
    }
  }

  /* ---------------- 事件委托 ---------------- */

  async function handleAction(action, target) {
    switch (action) {
      case "back":
        navigate("/todos");
        break;
      case "open-notifications":
        navigate("/notifications");
        break;
      case "open-create":
        navigate("/create");
        break;
      case "toggle-menu":
        toggleUserMenu();
        break;
      case "copy-invite": {
        const ok = await UI.copyText(target.dataset.code || "");
        UI.toast(ok ? "success" : "error", ok ? "邀请码已复制" : "复制失败，请手动选择");
        break;
      }
      case "logout":
        await logout();
        break;
      case "open-todo":
        navigate("/todos/" + target.dataset.id);
        break;
      case "set-scope":
        if (state.list.scope === target.dataset.scope) return;
        state.list.scope = target.dataset.scope;
        state.list.status = "all";
        reloadList();
        break;
      case "set-filter":
        state.list.status = target.dataset.status;
        reloadList();
        break;
      case "filter-stat": {
        const next = target.dataset.status;
        state.list.status = state.list.status === next ? "all" : next;
        reloadList();
        break;
      }
      case "clear-filter":
        state.list.status = "all";
        reloadList();
        break;
      case "retry-list":
        reloadList();
        break;
      case "retry-create":
        renderCreate(++routeSeq);
        break;
      case "retry-notifications":
        renderNotifications(++routeSeq);
        break;
      case "do-transition": {
        const act = target.dataset.act;
        if (!["assign", "complete"].includes(act)) return;
        target.classList.add("is-loading");
        target.disabled = true;
        let todo = null;
        try {
          todo = await API.getTodo(target.dataset.id);
        } catch (error) {
          UI.toast("error", error.message);
          target.classList.remove("is-loading");
          target.disabled = false;
          return;
        }
        await runTransition(todo, { action: act }, act === "assign" ? "已确认接收，开始处理" : "已完成，收工");
        break;
      }
      case "open-transfer": {
        try {
          const todo = await API.getTodo(target.dataset.id);
          openTransferSheet(todo);
        } catch (error) {
          UI.toast("error", error.message);
        }
        break;
      }
      case "open-reject": {
        try {
          const todo = await API.getTodo(target.dataset.id);
          openRejectSheet(todo);
        } catch (error) {
          UI.toast("error", error.message);
        }
        break;
      }
      case "read-all":
        await readAllNotifications();
        break;
      case "open-notification": {
        const notificationId = Number(target.dataset.id);
        const todoId = target.dataset.todoId;
        target.classList.remove("is-unread");
        const dot = target.querySelector(".notif-unread-dot");
        if (dot) dot.remove();
        if (notificationId) {
          API.markRead(notificationId)
            .then((data) => {
              state.unread = data.unread;
              updateUnreadBadge();
            })
            .catch(() => {});
        }
        if (todoId) navigate("/todos/" + todoId);
        break;
      }
      default:
        break;
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  root.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches('[role="button"][data-action="open-todo"]')) {
      event.preventDefault();
      event.target.click();
    }
  });

  document.addEventListener("click", (event) => {
    const menu = root.querySelector(".user-menu");
    if (!menu) return;
    if (event.target.closest(".user-menu") || event.target.closest('[data-action="toggle-menu"]')) return;
    menu.remove();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.user) refreshUnread();
  });

  /* ---------------- 启动 ---------------- */

  async function boot() {
    API.setSessionExpiredHandler(() => {
      resetSession();
      UI.toast("error", "登录状态已失效，请重新登录");
      const redirect = encodeURIComponent(location.hash.replace(/^#/, "") || "/todos");
      navigate("/login?redirect=" + redirect, { replace: true });
    });

    window.addEventListener("hashchange", () => {
      route();
    });

    const restored = await API.restore();
    if (restored) {
      state.user = restored;
      startPolling();
      refreshUnread();
    }
    if (!location.hash) {
      history.replaceState(null, "", "#/todos");
    }
    route();
  }

  boot();
})();
