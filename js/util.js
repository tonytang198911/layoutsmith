/* 通用小工具 */
window.LS = window.LS || {};
(function (LS) {
  'use strict';

  LS.$ = function (sel, root) { return (root || document).querySelector(sel); };
  LS.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  LS.uid = function (p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  LS.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  LS.round = function (v, d) { var m = Math.pow(10, d == null ? 2 : d); return Math.round((+v || 0) * m) / m; };
  LS.num = function (v, fb) { var n = parseFloat(v); return isFinite(n) ? n : (fb || 0); };
  LS.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  LS.icon = function (name, cls) {
    return '<svg class="i ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  };
  LS.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, a); }, ms);
    };
  };
  LS.hexToRgba = function (hex, a) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex || '000000', 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (a == null ? 1 : a) + ')';
  };
  LS.isHex = function (v) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim()); };
  var _hexCtx = null;
  LS.toHex = function (color, fb) {
    fb = fb || '#000000';
    if (!color) return fb;
    var s = String(color).trim();
    if (LS.isHex(s)) return LS.normHex(s, fb);
    if (s === 'transparent' || s === 'none') return fb;
    try {
      _hexCtx = _hexCtx || document.createElement('canvas').getContext('2d');
      _hexCtx.fillStyle = '#000000';
      _hexCtx.fillStyle = s;
      var v = _hexCtx.fillStyle;
      if (v.charAt(0) === '#' && v.length === 7) return v.toLowerCase();
      var m = v.match(/rgba?\(([^)]+)\)/);
      if (m) {
        var parts = m[1].split(',').map(function (x) { return parseFloat(x); });
        return '#' + [parts[0], parts[1], parts[2]].map(function (n) {
          n = Math.max(0, Math.min(255, Math.round(n)));
          return ('0' + n.toString(16)).slice(-2);
        }).join('');
      }
    } catch (e) {}
    return fb;
  };
  LS.normHex = function (v, fb) {
    var s = String(v || '').trim();
    if (!s) return fb || '#000000';
    if (s[0] !== '#') s = '#' + s;
    if (/^#([0-9a-f]{3})$/i.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : (fb || '#000000');
  };
  LS.timeAgo = function (ts) {
    var d = Date.now() - (ts || 0), m = 60000, h = 3600000, day = 86400000;
    if (d < m) return '刚刚';
    if (d < h) return Math.floor(d / m) + ' 分钟前';
    if (d < day) return Math.floor(d / h) + ' 小时前';
    if (d < day * 2) return '昨天';
    var dt = new Date(ts);
    var sameYear = dt.getFullYear() === new Date().getFullYear();
    return (sameYear ? '' : dt.getFullYear() + '年') + (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  };
  LS.fmtNum = function (v, d) {
    var n = LS.num(v);
    if (d == null) d = 1;
    var s = n.toFixed(d);
    if (d > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  };

  /* Toast */
  LS.toast = function (msg, type, ms) {
    var root = LS.$('#toasts');
    if (!root) return;
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    var icon = type === 'err' ? 'close' : (type === 'warn' ? 'help' : 'check');
    t.innerHTML = LS.icon(icon) + '<span>' + LS.esc(msg) + '</span>';
    root.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .2s, transform .2s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(function () { t.remove(); }, 220);
    }, ms || (type === 'err' ? 3600 : 2200));
  };

  /* 模态框 */
  LS.openModal = function (id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('hidden');
    return m;
  };
  LS.closeModal = function (id) {
    var m = document.getElementById(id);
    if (m) m.classList.add('hidden');
  };
  LS.closeAllModals = function () {
    LS.$$('.modal-layer').forEach(function (m) { m.classList.add('hidden'); });
  };
  document.addEventListener('click', function (e) {
    var closer = e.target.closest('[data-close]');
    if (closer) { LS.closeModal(closer.getAttribute('data-close')); return; }
    if (e.target.classList && e.target.classList.contains('modal-layer')) {
      e.target.classList.add('hidden');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = LS.$$('.modal-layer:not(.hidden)');
      if (open.length) { open[open.length - 1].classList.add('hidden'); }
    }
  });

  function buildDialog(opts) {
    var layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.innerHTML =
      '<div class="modal" style="width:' + (opts.width || 400) + 'px">' +
      '<header class="modal-head"><div><h2>' + LS.esc(opts.title) + '</h2>' +
      (opts.sub ? '<p>' + LS.esc(opts.sub) + '</p>' : '') + '</div>' +
      '<button class="icon-btn" data-role="cancel">' + LS.icon('close') + '</button></header>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      '<footer class="modal-foot"><button class="btn" data-role="cancel">取消</button>' +
      '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-role="ok">' + LS.esc(opts.okText || '确定') + '</button></footer>' +
      '</div>';
    document.body.appendChild(layer);
    return layer;
  }

  LS.confirm = function (opts) {
    if (typeof opts === 'string') opts = { title: '确认', message: opts };
    return new Promise(function (resolve) {
      var layer = buildDialog({
        title: opts.title || '确认',
        sub: opts.message || '',
        okText: opts.okText || '删除',
        danger: opts.danger !== false,
        body: opts.detail ? '<p class="note">' + LS.esc(opts.detail) + '</p>' : ''
      });
      function done(v) { layer.remove(); resolve(v); }
      layer.querySelector('[data-role=ok]').onclick = function () { done(true); };
      layer.querySelectorAll('[data-role=cancel]').forEach(function (b) { b.onclick = function () { done(false); }; });
      layer.addEventListener('mousedown', function (e) { if (e.target === layer) done(false); });
      setTimeout(function () { layer.querySelector('[data-role=ok]').focus(); }, 30);
    });
  };

  LS.prompt = function (opts) {
    return new Promise(function (resolve) {
      var layer = buildDialog({
        title: opts.title || '重命名',
        okText: opts.okText || '保存',
        danger: false,
        body: '<label class="field"><span class="field-label">' + LS.esc(opts.label || '名称') + '</span>' +
          '<input class="input" id="dlg-input" value="' + LS.esc(opts.value || '') + '" autocomplete="off"></label>'
      });
      var input = layer.querySelector('#dlg-input');
      function done(v) { layer.remove(); resolve(v); }
      layer.querySelector('[data-role=ok]').onclick = function () { done(input.value.trim() || null); };
      layer.querySelectorAll('[data-role=cancel]').forEach(function (b) { b.onclick = function () { done(null); }; });
      layer.addEventListener('mousedown', function (e) { if (e.target === layer) done(null); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || null); }
      });
      setTimeout(function () { input.focus(); input.select(); }, 30);
    });
  };

  LS.download = function (url, filename) {
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 100);
  };
  LS.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    LS.download(url, filename);
    setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
  };
  LS.dataURLToBlob = function (dataURL) {
    var parts = String(dataURL || '').split(',');
    if (parts.length < 2) return null;
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1]);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };
  LS.safeName = function (s) {
    return String(s || '未命名').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名';
  };

  /* 右键/更多菜单 */
  LS.menu = function (x, y, items) {
    closeMenu();
    var menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.id = 'ctxmenu';
    items.forEach(function (it) {
      if (it.sep) { menu.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      if (it.danger) b.className = 'danger';
      b.innerHTML = (it.icon ? LS.icon(it.icon) : '') + '<span>' + LS.esc(it.label) + '</span>';
      b.onclick = function (ev) { ev.stopPropagation(); closeMenu(); it.action && it.action(); };
      menu.appendChild(b);
    });
    menu.style.left = '0px';
    menu.style.top = '0px';
    document.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    setTimeout(function () { document.addEventListener('mousedown', onDocDown); }, 0);
  };
  function onDocDown(e) { if (!e.target.closest('#ctxmenu')) closeMenu(); }
  function closeMenu() {
    var m = document.getElementById('ctxmenu');
    if (m) m.remove();
    document.removeEventListener('mousedown', onDocDown);
  }
  LS.closeMenu = closeMenu;

  /* 颜色调色板 */
  LS.SWATCHES = ['#0f172a', '#55657d', '#ffffff', '#2457f5', '#0f8f8e', '#d64545', '#e8a33d', '#7c5cff'];

})(window.LS);
