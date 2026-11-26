(function (LS) {
  'use strict';
  if (!LS || !LS.ai) return;

  var PIN_MAX = 10;
  var state = {
    status: null,
    boards: [],
    pins: [],
    selected: {},
    boardId: '',
    tab: 'pins',
    busy: false,
    loading: false,
    editConfig: false,
    poll: 0,
    error: ''
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return LS.esc(v); }
  function pinMax() {
    var total = (LS.ai && LS.ai.attachmentMax) || 6;
    return Math.max(0, Math.min(PIN_MAX, total - (LS.ai.state.attachments || []).length));
  }
  function selectedCount() { return Object.keys(state.selected).length; }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function show(id, yes) { var el = $(id); if (el) el.classList.toggle('hidden', !yes); }

  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function showError(msg) {
    state.error = msg || '';
    var el = $('pin-error');
    if (el) {
      el.textContent = state.error;
      el.classList.toggle('hidden', !state.error);
    }
  }

  function open(settings) {
    state.editConfig = !!settings;
    state.error = '';
    LS.openModal('modal-pinterest');
    refreshStatus();
  }

  function close() {
    stopPoll();
    LS.closeModal('modal-pinterest');
  }

  function stopPoll() {
    if (state.poll) { clearInterval(state.poll); state.poll = 0; }
  }

  function refreshStatus() {
    state.loading = true;
    render();
    api('/api/pinterest/status').then(function (status) {
      state.status = status;
      state.loading = false;
      render();
      if (status.connected && !state.editConfig) {
        if (!state.boards.length) loadBoards();
        else loadPins(false);
      }
    }).catch(function (err) {
      state.loading = false;
      state.status = null;
      state.error = err.message || String(err);
      render();
    });
  }

  function render() {
    var st = state.status || {};
    var configured = !!st.configured;
    var connected = !!st.connected;
    var live = connected && !state.editConfig;
    var setup = (!configured && !connected) || state.editConfig;
    var connect = configured && !connected && !state.editConfig;
    show('pin-setup', setup);
    show('pin-connect', connect);
    show('pin-browser', live);
    show('pin-tabs', live);
    show('pin-disconnect', live);
    show('pin-settings', live);
    show('pin-loading', state.loading && !setup);
    if (setup) {
      var app = $('pin-app-id');
      var redir = $('pin-redirect');
      var secret = $('pin-app-secret');
      if (app && !app.value) app.value = st.appId || '1644778';
      if (redir && !redir.value) redir.value = st.redirectUri || 'http://localhost:8787/api/pinterest/callback';
      if (secret) secret.placeholder = configured ? '已保存，留空保持不变' : '在 Pinterest App 的 Configure 里复制';
      setText('pin-head-sub', '连接你的 Pinterest 账号，选中的图片会加入 AI 参考');
      show('pin-error', !!state.error);
      renderFoot();
      return;
    }
    if (connect) {
      setText('pin-head-sub', '连接你的 Pinterest 账号，选中的图片会加入 AI 参考');
      setText('pin-connect-note', state.error || '授权完成后会自动回到这里。');
      renderFoot();
      return;
    }
    if (live) {
      setText('pin-head-sub', '选中的图片会作为 AI 参考加入当前对话；当前还能选 ' + pinMax() + ' 张');
      renderTabs();
      renderBrowser();
    } else {
      setText('pin-head-sub', '连接你的 Pinterest 账号，选中的图片会加入 AI 参考');
    }
    renderFoot();
  }

  function renderTabs() {
    var tabs = document.querySelectorAll('#pin-tabs .pin-tab');
    Array.prototype.forEach.call(tabs, function (b) {
      b.classList.toggle('active', b.getAttribute('data-pin-tab') === state.tab);
    });
  }

  function renderFoot() {
    var st = state.status || {};
    var live = !!st.connected && !state.editConfig;
    var max = pinMax();
    var n = selectedCount();
    var add = $('pin-add');
    if (add) {
      add.disabled = state.busy || n <= 0 || !live;
      add.textContent = state.busy ? '正在加入…' : '添加到聊天';
    }
    setText('pin-selected', max <= 0
      ? (live ? 'AI 参考已满，先移除已有参考' : '已选 ' + n)
      : ('已选 ' + n + ' / ' + max));
  }

  function renderBrowser() {
    var st = state.status || {};
    if (!st.connected) return;
    show('pin-loading', !!state.loading);
    var boardSelect = $('pin-board-select');
    if (boardSelect) {
      var opts = state.boards.map(function (b) {
        return '<option value="' + esc(b.id) + '"' + (b.id === state.boardId ? ' selected' : '') + '>' + esc(b.name) + '</option>';
      }).join('');
      boardSelect.innerHTML = opts || '<option value="">没有 Board</option>';
      boardSelect.disabled = !state.boards.length || state.tab === 'boards';
    }
    var board = state.boards.filter(function (b) { return b.id === state.boardId; })[0];
    setText('pin-board-meta', board ? (board.pin_count + ' 个 Pin') : (state.boards.length ? '选择一个 Board' : '这个账号还没有 Board'));
    var grid = $('pin-grid');
    var empty = $('pin-empty');
    if (!grid || !empty) return;
    if (state.tab === 'boards') {
      show('pin-empty', !state.boards.length && !state.loading);
      empty.textContent = state.boards.length ? '' : '没有找到 Board。确认授权时选择了 Boards 权限。';
      grid.innerHTML = state.boards.map(function (b) {
        var cover = b.cover
          ? '<img src="' + esc(b.cover) + '" alt="" loading="lazy">'
          : '<span>P</span>';
        return '<button type="button" class="pin-board-card" data-board-id="' + esc(b.id) + '">' +
          '<span class="pin-board-cover">' + cover + '</span>' +
          '<span class="pin-board-info"><b>' + esc(b.name) + '</b><span>' + (b.pin_count || 0) + ' 个 Pin</span></span>' +
          '</button>';
      }).join('');
      return;
    }
    show('pin-empty', !state.pins.length && !state.loading);
    empty.textContent = state.boards.length
      ? (state.loading ? '' : '这个 Board 还没有 Pin，换一个 Board 看看。')
      : '没有找到 Board。确认授权时选择了 Boards 权限。';
    grid.innerHTML = state.pins.map(function (p) {
      var sel = !!state.selected[p.id];
      var img = p.thumb || p.image;
      return '<button type="button" class="pin-card' + (sel ? ' selected' : '') + '" data-pin-id="' + esc(p.id) + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' +
        (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') +
        (p.boardName ? '<span class="pin-board-badge">' + esc(p.boardName) + '</span>' : '') +
        '<span class="pin-check">✓</span>' +
        '<span class="pin-card-shade">' + esc(p.title || 'Pinterest Pin') + '</span>' +
        '</button>';
    }).join('');
  }

  function loadBoards() {
    if (state.loading) return;
    state.loading = true;
    renderBrowser();
    api('/api/pinterest/boards').then(function (data) {
      state.boards = Array.isArray(data.boards) ? data.boards : [];
      state.loading = false;
      if (!state.boards.some(function (b) { return b.id === state.boardId; })) {
        state.boardId = state.boards[0] ? state.boards[0].id : '';
      }
      render();
      if (state.boardId) loadPins(false);
    }).catch(function (err) {
      state.loading = false;
      state.error = err.message || String(err);
      state.boards = [];
      render();
      LS.toast('读取 Pinterest 失败：' + state.error, 'err', 4600);
    });
  }

  function loadPins(scroll) {
    var boardId = state.boardId;
    if (!boardId) { state.pins = []; state.loading = false; render(); return; }
    state.loading = true;
    renderBrowser();
    api('/api/pinterest/pins?board_id=' + encodeURIComponent(boardId)).then(function (data) {
      state.loading = false;
      var board = state.boards.filter(function (b) { return b.id === boardId; })[0];
      state.pins = (Array.isArray(data.pins) ? data.pins : []).map(function (p) {
        p.boardName = board ? board.name : '';
        return p;
      });
      state.error = '';
      render();
      if (scroll) {
        var body = document.querySelector('.pin-body');
        if (body) body.scrollTop = 0;
      }
    }).catch(function (err) {
      state.loading = false;
      state.pins = [];
      state.error = err.message || String(err);
      render();
      LS.toast('读取 Pinterest Pins 失败：' + state.error, 'err', 4600);
    });
  }

  function togglePin(id) {
    var pin = state.pins.filter(function (p) { return p.id === id; })[0];
    if (!pin) return;
    if (state.selected[id]) {
      delete state.selected[id];
    } else {
      var max = pinMax();
      if (max <= 0) { LS.toast('AI 参考已满，先移除已有的参考', 'warn', 3200); return; }
      if (selectedCount() >= max) { LS.toast('最多还能选 ' + max + ' 张', 'warn', 2800); return; }
      state.selected[id] = pin;
    }
    renderBrowser();
    renderFoot();
  }

  function selectBoard(id) {
    if (!id) return;
    state.boardId = id;
    state.tab = 'pins';
    state.pins = [];
    renderTabs();
    loadPins(true);
  }

  function saveConfig() {
    var appId = ($('pin-app-id') || {}).value || '';
    var secret = ($('pin-app-secret') || {}).value || '';
    var token = ($('pin-access-token') || {}).value || '';
    var redirect = ($('pin-redirect') || {}).value || '';
    if (!appId.trim()) { showError('请填写 Pinterest App ID'); return; }
    if (!secret.trim() && !token.trim() && !(state.status && (state.status.configured || state.status.connected))) {
      showError('请填写 App Secret，或粘贴 Pinterest 生成的 Access Token');
      return;
    }
    var btn = $('pin-save');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    showError('');
    api('/api/pinterest/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: appId.trim(), appSecret: secret.trim(), redirectUri: redirect.trim(), accessToken: token.trim() })
    }).then(function (status) {
      var sec = $('pin-app-secret');
      var tok = $('pin-access-token');
      if (sec) sec.value = '';
      if (tok) tok.value = '';
      state.status = status;
      state.editConfig = false;
      state.boards = [];
      state.pins = [];
      state.boardId = '';
      state.selected = {};
      LS.toast('Pinterest 应用信息已保存', 'ok');
      render();
      if (status.connected) loadBoards();
    }).catch(function (err) {
      showError(err.message || String(err));
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = '保存并继续'; }
    });
  }

  function startConnect() {
    var note = $('pin-connect-note');
    if (note) note.textContent = '正在打开 Pinterest 授权页…';
    api('/api/pinterest/auth').then(function (data) {
      var url = data && data.url;
      if (!url) throw new Error('没有拿到授权地址');
      var pop = window.open(url, 'pinterest-oauth', 'width=680,height=820,noopener=no');
      if (!pop) {
        if (note) note.innerHTML = '浏览器拦截了弹窗，请 <a href="' + esc(url) + '" target="_blank" rel="noopener">点这里打开 Pinterest 授权</a>。';
        return;
      }
      if (note) note.textContent = '授权完成后会自动回到这里…';
      stopPoll();
      var started = Date.now();
      state.poll = setInterval(function () {
        if (Date.now() - started > 120000) {
          stopPoll();
          if (note) note.textContent = '授权还没有完成。可以关闭授权窗口后重试。';
          return;
        }
        api('/api/pinterest/status').then(function (status) {
          state.status = status;
          if (status.connected) {
            stopPoll();
            try { pop.close(); } catch (e) {}
            state.editConfig = false;
            render();
            LS.toast('Pinterest 已连接', 'ok');
            loadBoards();
          }
        }).catch(function () {});
      }, 1400);
    }).catch(function (err) {
      state.error = err.message || String(err);
      if (note) note.textContent = state.error;
      showError(state.error);
    });
  }

  function disconnect() {
    if (!window.confirm('断开 Pinterest？已加入 AI 的图片参考不会删除。')) return;
    api('/api/pinterest/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function (status) {
      state.status = status;
      state.boards = [];
      state.pins = [];
      state.selected = {};
      state.boardId = '';
      state.editConfig = false;
      state.tab = 'pins';
      render();
      LS.toast('已断开 Pinterest', 'ok');
    }).catch(function (err) {
      LS.toast('断开失败：' + (err.message || err), 'err', 3600);
    });
  }

  function fetchImageData(url) {
    return fetch('/api/pinterest/image?url=' + encodeURIComponent(url)).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error((j.error && j.error.message) || ('HTTP ' + r.status)); });
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { reject(new Error('读取图片失败')); };
        fr.readAsDataURL(blob);
      });
    });
  }

  function addSelected() {
    var pins = Object.keys(state.selected).map(function (id) { return state.selected[id]; }).filter(function (p) { return p && p.image; });
    if (!pins.length) { LS.toast('先选几张 Pinterest 图片', 'warn'); return; }
    var max = pinMax();
    if (max <= 0) { LS.toast('AI 参考已满，先移除已有参考', 'warn'); return; }
    pins = pins.slice(0, max);
    state.busy = true;
    renderFoot();
    var added = 0, failed = 0;
    var chain = Promise.resolve();
    pins.forEach(function (p) {
      chain = chain.then(function () {
        if (added >= max) return;
        return fetchImageData(p.image).then(function (data) {
          if (!data) { failed++; return; }
          return LS.ai.addPinterestImage(p.title || 'Pinterest Pin', data).then(function (ok) {
            if (ok) added++; else failed++;
          });
        }).catch(function () { failed++; });
      });
    });
    chain.then(function () {
      state.busy = false;
      if (added) {
        state.selected = {};
        close();
        LS.toast('已加入 ' + added + ' 张 Pinterest 参考' + (failed ? '，' + failed + ' 张失败' : ''), failed ? 'warn' : 'ok', 3800);
      } else {
        renderFoot();
        LS.toast('Pinterest 图片没有加入成功' + (failed ? '（' + failed + ' 张失败）' : ''), 'err', 4000);
      }
    });
  }

  function init() {
    var modal = $('modal-pinterest');
    if (!modal) return;
    $('pin-save').addEventListener('click', saveConfig);
    $('pin-connect-btn').addEventListener('click', startConnect);
    $('pin-edit-config').addEventListener('click', function () {
      state.editConfig = true;
      showError('');
      render();
    });
    $('pin-disconnect').addEventListener('click', disconnect);
    $('pin-settings').addEventListener('click', function () {
      state.editConfig = true;
      showError('');
      render();
    });
    $('pin-cancel').addEventListener('click', close);
    $('pin-add').addEventListener('click', addSelected);
    $('pin-refresh').addEventListener('click', function () {
      if (state.tab === 'boards') loadBoards(); else loadPins(true);
    });
    $('pin-board-select').addEventListener('change', function (e) {
      selectBoard(e.target.value);
    });
    $('pin-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pin-tab]');
      if (!b) return;
      state.tab = b.getAttribute('data-pin-tab');
      renderTabs();
      renderBrowser();
    });
    $('pin-grid').addEventListener('click', function (e) {
      var del = e.target.closest('[data-pin-id]');
      if (del) { togglePin(del.getAttribute('data-pin-id')); return; }
      var board = e.target.closest('[data-board-id]');
      if (board) selectBoard(board.getAttribute('data-board-id'));
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close="modal-pinterest"]')) stopPoll();
    });
    refreshStatus();
  }

  LS.pinterest = { open: open, close: close, state: state };
  init();
})(window.LS);
