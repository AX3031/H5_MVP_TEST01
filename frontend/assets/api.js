/* API 封装：access token 仅存内存；401 时单飞刷新并重放请求 */
(function () {
  "use strict";

  let accessToken = null;
  let refreshPromise = null;
  let sessionExpiredHandler = null;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  async function parseError(response) {
    let message = "请求失败，请稍后重试";
    try {
      const data = await response.json();
      if (typeof data.detail === "string") {
        message = data.detail;
      } else if (Array.isArray(data.detail) && data.detail.length) {
        message = data.detail
          .map((item) => (item && item.msg ? String(item.msg).replace(/^Value error,\s*/, "") : ""))
          .filter(Boolean)
          .join("；");
      }
    } catch (_error) {
      /* 响应不是 JSON 时使用默认文案 */
    }
    return message;
  }

  async function refresh() {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const response = await fetch("/api/v1/auth/refresh", {
            method: "POST",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          if (!response.ok) return null;
          const data = await response.json();
          accessToken = data.access_token;
          return data;
        } catch (_error) {
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }
    return refreshPromise;
  }

  async function request(path, options) {
    const opts = options || {};
    const method = opts.method || "GET";
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    const init = { method, headers, credentials: "same-origin" };

    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (opts.auth !== false && accessToken) {
      headers.Authorization = "Bearer " + accessToken;
    }

    let response;
    try {
      response = await fetch(path, init);
    } catch (_error) {
      throw new ApiError("网络连接失败，请确认服务已启动", 0);
    }

    if (response.status === 401 && opts.retry !== false && opts.auth !== false) {
      const refreshed = await refresh();
      if (refreshed) {
        return request(path, Object.assign({}, opts, { retry: false }));
      }
      if (sessionExpiredHandler) sessionExpiredHandler();
      throw new ApiError("登录状态已失效，请重新登录", 401);
    }

    if (!response.ok) {
      throw new ApiError(await parseError(response), response.status);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function setToken(token) {
    accessToken = token || null;
  }

  window.API = {
    ApiError,
    setToken,
    hasToken: () => Boolean(accessToken),
    setSessionExpiredHandler(handler) {
      sessionExpiredHandler = handler;
    },

    async restore() {
      const data = await refresh();
      return data ? data.user : null;
    },
    async login(email, password) {
      const data = await request("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
        retry: false,
      });
      setToken(data.access_token);
      return data.user;
    },
    async register(payload) {
      const data = await request("/api/v1/auth/register", {
        method: "POST",
        body: payload,
        auth: false,
        retry: false,
      });
      setToken(data.access_token);
      return data.user;
    },
    async logout() {
      try {
        await request("/api/v1/auth/logout", { method: "POST" });
      } finally {
        setToken(null);
      }
    },
    me: () => request("/api/v1/auth/me"),

    org: () => request("/api/v1/org"),
    members: () => request("/api/v1/members"),

    listTodos(scope, status) {
      const params = new URLSearchParams({ scope });
      if (status && status !== "all") params.set("status", status);
      return request("/api/v1/todos?" + params.toString());
    },
    getTodo: (id) => request("/api/v1/todos/" + encodeURIComponent(id)),
    createTodo: (payload) => request("/api/v1/todos", { method: "POST", body: payload }),
    transitionTodo(id, payload) {
      return request("/api/v1/todos/" + encodeURIComponent(id) + "/transition", {
        method: "POST",
        body: payload,
      });
    },

    notifications: () => request("/api/v1/notifications?limit=50"),
    unreadCount: () => request("/api/v1/notifications/unread-count"),
    markRead(id) {
      return request("/api/v1/notifications/" + encodeURIComponent(id) + "/read", {
        method: "POST",
      });
    },
    readAll: () => request("/api/v1/notifications/read-all", { method: "POST" }),
  };
})();
