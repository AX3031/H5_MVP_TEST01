/* UI 工具：转义、状态与时间格式化、头像、Toast、底部弹层 */
(function () {
  "use strict";

  const STATUS = {
    pending: { label: "待处理", tone: "amber", icon: "clock" },
    in_progress: { label: "进行中", tone: "blue", icon: "play" },
    completed: { label: "已完成", tone: "green", icon: "checkCircle" },
    rejected: { label: "已驳回", tone: "red", icon: "xCircle" },
  };

  const ACTIONS = {
    assign: { label: "确认接收", icon: "play", tone: "primary", hint: "确认后进入处理中" },
    complete: { label: "标记完成", icon: "checkCircle", tone: "primary", hint: "完成后不可再流转" },
    transfer: { label: "转交", icon: "swap", tone: "outline", hint: "把处理责任移交团队成员" },
    reject: { label: "驳回", icon: "xCircle", tone: "danger", hint: "需要说明驳回原因" },
  };

  const HISTORY_META = {
    create: { icon: "sparkles", tone: "violet", label: "创建待办" },
    assign: { icon: "play", tone: "blue", label: "确认接收" },
    transfer: { icon: "swap", tone: "amber", label: "转交" },
    reject: { icon: "xCircle", tone: "red", label: "驳回" },
    complete: { icon: "checkCircle", tone: "green", label: "完成" },
  };

  const AVATAR_PALETTE = [
    ["#ece9ff", "#4748c9"],
    ["#fdeee9", "#b94f2e"],
    ["#e6f5ef", "#157a5a"],
    ["#eaf2fd", "#2a63b8"],
    ["#fdf3e1", "#946010"],
    ["#fbeaed", "#ad3849"],
  ];

  const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value === null || value === undefined ? "" : value).replace(
      /[&<>"']/g,
      (char) => ESCAPE_MAP[char]
    );
  }

  function icon(name, size, className) {
    return window.Icons.svg(name, size || 20, className || "");
  }

  function statusOf(status) {
    return STATUS[status] || { label: status, tone: "violet", icon: "info" };
  }

  function statusChip(status, extraClass) {
    const meta = statusOf(status);
    return (
      '<span class="status-chip tone-' + meta.tone + " " + (extraClass || "") + '">' +
      '<i class="status-dot"></i>' + esc(meta.label) + "</span>"
    );
  }

  function initials(name) {
    const text = String(name || "?").trim();
    if (!text) return "?";
    if (/^[a-zA-Z]/.test(text)) {
      return text.slice(0, 2).toUpperCase();
    }
    return text.slice(0, 1);
  }

  function avatar(name, size, className) {
    const text = String(name || "?");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) % 997;
    }
    const [bg, fg] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
    return (
      '<span class="avatar ' + (className || "") + '" title="' + esc(name) +
      '" style="--avatar-size:' + (size || 32) + "px;--avatar-bg:" + bg + ";--avatar-fg:" + fg + '">' +
      esc(initials(name)) + "</span>"
    );
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function clockText(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function dayDiff(date) {
    return Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  }

  function dueText(iso, status, serverOverdue) {
    if (!iso) {
      return { label: "未设置截止时间", tone: "muted", overdue: false };
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return { label: "时间待确认", tone: "muted", overdue: false };
    }
    const diff = dayDiff(date);
    const time = clockText(date);
    const open = status === "pending" || status === "in_progress";
    const overdue = serverOverdue !== undefined && serverOverdue !== null
      ? Boolean(serverOverdue)
      : open && date.getTime() < Date.now();

    let label;
    if (diff === 0) label = "今天 " + time;
    else if (diff === 1) label = "明天 " + time;
    else if (diff === -1) label = "昨天 " + time;
    else if (date.getFullYear() === new Date().getFullYear()) {
      label = date.getMonth() + 1 + "月" + date.getDate() + "日 " + time;
    } else {
      label = date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日 " + time;
    }
    if (overdue) label += " · 已逾期";
    return {
      label,
      tone: overdue ? "danger" : diff === 0 ? "warn" : "default",
      overdue,
    };
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return (
      date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日 " +
      clockText(date)
    );
  }

  function relTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟前";
    const diff = dayDiff(date);
    if (diff === 0) return Math.floor(seconds / 3600) + " 小时前";
    if (diff === -1) return "昨天 " + clockText(date);
    if (date.getFullYear() === new Date().getFullYear()) {
      return date.getMonth() + 1 + "月" + date.getDate() + "日";
    }
    return date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + date.getDate();
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 5) return "夜深了";
    if (hour < 11) return "早上好";
    if (hour < 13) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function todayText() {
    const date = new Date();
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return date.getMonth() + 1 + "月" + date.getDate() + "日 " + weekdays[date.getDay()];
  }

  function toast(type, message) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const iconName = type === "error" ? "alert" : type === "info" ? "info" : "checkCircle";
    const item = document.createElement("div");
    item.className = "toast toast-" + (type || "success");
    item.innerHTML = icon(iconName, 18) + "<span>" + esc(message) + "</span>";
    root.appendChild(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    window.setTimeout(() => {
      item.classList.remove("is-visible");
      window.setTimeout(() => item.remove(), 260);
    }, 2800);
  }

  function openSheet(options) {
    const root = document.getElementById("overlay-root");
    if (!root) return null;
    const layer = document.createElement("div");
    layer.className = "sheet-layer";
    layer.innerHTML =
      '<div class="sheet-backdrop" data-sheet-close></div>' +
      '<section class="sheet ' + (options.className || "") + '" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-grabber" aria-hidden="true"></div>' +
      '<header class="sheet-head"><div class="sheet-heading">' +
      '<h2 id="sheet-title">' + esc(options.title || "") + "</h2>" +
      (options.subtitle ? "<p>" + esc(options.subtitle) + "</p>" : "") +
      '</div><button type="button" class="icon-btn sheet-close" data-sheet-close aria-label="关闭">' +
      icon("x", 20) + "</button></header>" +
      '<div class="sheet-body">' + (options.content || "") + "</div>" +
      (options.footer ? '<footer class="sheet-footer">' + options.footer + "</footer>" : "") +
      "</section>";
    root.appendChild(layer);
    document.body.classList.add("has-sheet");

    let closed = false;
    function onKey(event) {
      if (event.key === "Escape") close();
    }
    function close() {
      if (closed) return;
      closed = true;
      layer.classList.remove("is-open");
      document.removeEventListener("keydown", onKey);
      window.setTimeout(() => {
        layer.remove();
        if (!document.querySelector(".sheet-layer")) {
          document.body.classList.remove("has-sheet");
        }
      }, 240);
      if (typeof options.onClose === "function") options.onClose();
    }
    layer.addEventListener("click", (event) => {
      if (event.target.closest("[data-sheet-close]")) close();
    });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => layer.classList.add("is-open"));

    const focusTarget = layer.querySelector("[data-autofocus], input, textarea, button.sheet-close");
    if (focusTarget) {
      window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 80);
    }
    return { element: layer, close };
  }

  function emptyState(iconName, title, text, actionHtml) {
    return (
      '<div class="empty-state">' +
      '<div class="empty-orb">' + icon(iconName || "inbox", 30) + "</div>" +
      "<h3>" + esc(title) + "</h3>" +
      (text ? "<p>" + esc(text) + "</p>" : "") +
      (actionHtml || "") +
      "</div>"
    );
  }

  function skeletonList(count) {
    let html = '<div class="skeleton-list" aria-hidden="true">';
    for (let index = 0; index < (count || 3); index += 1) {
      html +=
        '<div class="skeleton-card"><span class="sk sk-pill"></span><span class="sk sk-title"></span>' +
        '<span class="sk sk-line"></span><span class="sk sk-meta"></span></div>';
    }
    return html + "</div>";
  }

  function skeletonDetail() {
    return (
      '<div class="skeleton-detail" aria-hidden="true">' +
      '<span class="sk sk-pill"></span><span class="sk sk-hero"></span><span class="sk sk-line"></span>' +
      '<span class="sk sk-line short"></span><div class="skeleton-panel"><span class="sk sk-meta"></span>' +
      '<span class="sk sk-meta"></span><span class="sk sk-meta"></span></div></div>'
    );
  }

  function errorState(message, retryAction) {
    return (
      '<div class="empty-state error-state">' +
      '<div class="empty-orb">' + icon("alert", 30) + "</div>" +
      "<h3>出了点问题</h3><p>" + esc(message || "请稍后重试") + "</p>" +
      (retryAction
        ? '<button type="button" class="btn btn-outline btn-inline" data-action="' + esc(retryAction) + '">' +
          icon("refresh", 16) + "重新加载</button>"
        : "") +
      "</div>"
    );
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_error) {
      /* 回退到 execCommand */
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (_error) {
      return false;
    }
  }

  function historyLine(item) {
    const meta = HISTORY_META[item.action] || { icon: "info", tone: "violet", label: item.action };
    const operator = item.operator ? item.operator.display_name : "系统";
    const details = item.meta || {};
    let text = "";
    if (item.action === "create") {
      const target = details.assignee ? details.assignee.display_name : "";
      text = esc(operator) + " 创建待办" + (target ? "，指派给 " + esc(target) : "");
    } else if (item.action === "assign") {
      text = esc(operator) + " 确认接收，开始处理";
    } else if (item.action === "transfer") {
      const from = details.from_assignee ? details.from_assignee.display_name : "";
      const to = details.to_assignee ? details.to_assignee.display_name : "";
      text = esc(operator) + " 将待办" +
        (from && from !== operator ? "从 " + esc(from) + " " : "") +
        (to ? "转交给 " + esc(to) : "完成转交");
    } else if (item.action === "reject") {
      text = esc(operator) + " 驳回待办";
    } else if (item.action === "complete") {
      text = esc(operator) + " 标记完成";
    } else {
      text = esc(operator) + " " + esc(meta.label);
    }
    const reason = item.action === "reject" && details.reason
      ? '<p class="timeline-reason">“' + esc(details.reason) + "”</p>"
      : "";
    return (
      '<li class="timeline-item tone-' + meta.tone + '">' +
      '<span class="timeline-dot">' + icon(meta.icon, 14) + "</span>" +
      '<div class="timeline-content"><p class="timeline-text">' + text + "</p>" + reason +
      '<time datetime="' + esc(item.created_at) + '">' + esc(fmtDateTime(item.created_at)) + "</time></div></li>"
    );
  }

  window.UI = {
    STATUS,
    ACTIONS,
    esc,
    icon,
    statusOf,
    statusChip,
    avatar,
    initials,
    dueText,
    fmtDateTime,
    relTime,
    greeting,
    todayText,
    toast,
    openSheet,
    emptyState,
    skeletonList,
    skeletonDetail,
    errorState,
    copyText,
    historyLine,
  };
})();
