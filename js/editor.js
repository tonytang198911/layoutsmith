/* 编辑器核心：无限画布、画板、工具、参考线、历史、保存 */
(function (LS) {
  'use strict';

  var S = {
    canvas: null, meta: null, dpi: 150, initialized: false,
    tool: 'select', zoom: 1, snap: true, preview: false,
    guides: [], activeArtboardId: null, selectedGuide: null, artboardLabelRects: {}, artboardDrag: null,
    style: {
      fill: '#dbe5fd', stroke: '#2457f5', strokeWidth: 0,
      textFill: '#0f172a', fontFamily: 'PingFang SC', fontSize: 0
    },
    history: { states: [], idx: -1, lock: false, current: null },
    clipboard: null, drawing: null, pen: null, panning: null, dragGuide: null,
    snapLines: [], space: false, loading: false, saving: false, dirty: false,
    saveTimer: null, commitTimer: null, lastSnap: null, loadToken: 0,
    restoring: false, groupBusy: false
  };

  var SHAPE_TOOLS = ['rect', 'ellipse', 'polygon', 'line'];
  var HIST_PROPS = ['lsName', 'lsLocked', 'lsArtboard', 'lsArtboardId', 'lsSides', 'lsStar', 'lsClipArtboardId', 'lsBoardLocked'];

  function $(s) { return LS.$(s); }
  function canvas() { return S.canvas; }
  function isActive() { return $('#screen-editor').classList.contains('active'); }
  function activeArtboard() {
    if (!S.canvas || !S.activeArtboardId) return null;
    var list = artboards();
    for (var i = 0; i < list.length; i++) {
      if (list[i].lsArtboardId === S.activeArtboardId) return list[i];
    }
    return null;
  }
  function artboards() {
    return S.canvas ? S.canvas.getObjects().filter(function (o) { return o.lsArtboard; }) : [];
  }
  function objects() {
    return S.canvas ? S.canvas.getObjects().filter(function (o) { return !o.lsArtboard; }) : [];
  }
  function docPoint(e) {
    var p = S.canvas.getPointer(e);
    return { x: p.x, y: p.y };
  }
  function screenToDoc(clientX, clientY) {
    var c = S.canvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
    return {
      x: ((clientX == null ? 0 : clientX) - r.left - v[4]) / S.zoom,
      y: ((clientY == null ? 0 : clientY) - r.top - v[5]) / S.zoom
    };
  }
  function docToScreen(x, y) {
    var v = S.canvas.viewportTransform;
    return { x: x * S.zoom + v[4], y: y * S.zoom + v[5] };
  }
  function bboxOf(objs) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objs.forEach(function (o) {
      var b = o.getBoundingRect(true);
      minX = Math.min(minX, b.left); minY = Math.min(minY, b.top);
      maxX = Math.max(maxX, b.left + b.width); maxY = Math.max(maxY, b.top + b.height);
    });
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }

  /* ───────────── 初始化 ───────────── */
  function init() {
    if (S.initialized) return;
    S.initialized = true;
    var c = new fabric.Canvas('c', {
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false,
      enableRetinaScaling: true,
      uniformScaling: false,
      renderOnAddRemove: true,
      backgroundColor: null
    });
    S.canvas = c;

    Object.assign(fabric.Object.prototype, {
      borderColor: '#2457f5',
      cornerColor: '#ffffff',
      cornerStrokeColor: '#2457f5',
      cornerStyle: 'circle',
      cornerSize: 9,
      touchCornerSize: 16,
      transparentCorners: false,
      borderScaleFactor: 1.35,
      padding: 2,
      rotatingPointOffset: 28,
      selectionBackgroundColor: 'rgba(36,87,245,.06)',
      selectionColor: 'rgba(36,87,245,.12)',
      selectionBorderColor: '#2457f5',
      selectionLineWidth: 1.2,
      lockScalingFlip: true,
      objectCaching: false
    });
    fabric.IText.prototype.editingBorderColor = '#2457f5';
    fabric.IText.prototype.cursorColor = '#2457f5';
    fabric.IText.prototype.cursorWidth = 1.5;

    bindCanvas();
    bindUI();
    bindKeyboard();
    bindDnd();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (S.canvas) { S.canvas.requestRenderAll(); refreshUI(); }
      });
    }
    window.addEventListener('resize', LS.debounce(function () { resizeCanvas(); }, 80));
    if (window.ResizeObserver) {
      new ResizeObserver(LS.debounce(function () { resizeCanvas(); }, 40)).observe($('#canvas-wrap'));
    }
    window.addEventListener('beforeunload', function () { if (S.dirty) saveNow(true); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && S.dirty) saveNow(true); });
  }

  function resizeCanvas() {
    if (!S.canvas || !isActive()) return;
    var wrap = $('#canvas-wrap');
    var w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
    if (S.canvas.getWidth() === w && S.canvas.getHeight() === h) { drawRulers(); return; }
    S.canvas.setDimensions({ width: w, height: h });
    drawRulers();
    drawOverlay();
  }

  function bindCanvas() {
    var c = S.canvas;

    c.on('selection:created', refreshUI);
    c.on('selection:updated', refreshUI);
    c.on('selection:cleared', function () { S.snapLines = []; refreshUI(); });

    c.on('object:added', function (e) {
      if (S.loading || S.restoring) return;
      var o = e.target;
      if (!o) return;
      if (o.lsArtboard) {
        if (!o.lsArtboardId) o.lsArtboardId = LS.uid('ab');
        o.set({ selectable: false, evented: false, hasControls: false });
      } else {
        if (!o.lsName) o.lsName = nameFor(o);
        applyLock(o);
        if (!o.selectable && S.canvas.getActiveObject() === o) S.canvas.discardActiveObject();
      }
      if (S.drawing || S.pen || S.groupBusy) { refreshUI(); return; }
      commitSoon(); markDirty(); refreshUI();
    });

    c.on('object:removed', function () {
      if (S.loading || S.restoring || S.groupBusy) return;
      commitSoon(); markDirty(); refreshUI();
    });

    c.on('object:modified', function () {
      if (S.loading || S.restoring) return;
      commitNow(); markDirty(); refreshUI();
    });

    c.on('object:moving', onMoving);
    c.on('text:editing:entered', function () { document.body.classList.add('text-editing'); });
    c.on('text:editing:exited', function (e) {
      document.body.classList.remove('text-editing');
      if (e.target) { applyTextWrap(e.target); e.target.setCoords(); }
      commitNow(); markDirty(); refreshUI();
    });
    c.on('text:changed', function (e) {
      if (e.target) e.target.lsName = textName(e.target);
      LS.props && LS.props.renderLayers();
      drawOverlay();
    });

    c.on('mouse:down', onMouseDown);
    c.on('mouse:move', onMouseMove);
    c.on('mouse:up', onMouseUp);
    document.addEventListener('mousemove', function (e) {
      if (!isActive() || S.artboardDrag || S.preview || S.tool !== 'select' || !S.canvas) return;
      var lab = artboardLabelAt(e) || artboardBorderAt(e);
      var el = S.canvas.upperCanvasEl;
      if (lab && !lab.lsBoardLocked) el.style.cursor = 'grab';
      else if (el.style.cursor === 'grab') el.style.cursor = '';
    });
    c.on('mouse:dblclick', onDblClick);

    c.on('after:render', drawOverlay);

    var upper = c.upperCanvasEl;
    upper.addEventListener('wheel', onWheel, { passive: false });
    upper.addEventListener('mousedown', onUpperDownCapture, true);
    upper.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ───────────── 打开项目 ───────────── */
  function open(meta, doc) {
    init();
    if (doc && doc.data && doc.data.canvas) doc = doc.data;
    S.meta = meta;
    S.dpi = meta.dpi || 150;
    S.loading = true;
    S.guides = [];
    S.selectedGuide = null;
    S.activeArtboardId = null;
    S.drawing = null; S.pen = null;
    S.preview = false;
    S.lastThumb = null;
    $('#stage').classList.remove('preview');
    $('#btn-preview').classList.remove('active');
    $('#proj-name').value = meta.name || '未命名项目';
    $('#proj-name').title = meta.name || '';
    resizeCanvas();

    var token = ++S.loadToken;
    var json = doc && doc.canvas;
    var guides = doc && doc.guides;

    function ready() {
      if (token !== S.loadToken) return;
      applyAllLocks();
      ensureArtboardsBottom(true);
      if (!artboards().length && meta.artboardCount !== 0) {
        addArtboard(0, 0, meta.w || 1000, meta.h || 2000, '画板 1', meta.transparent ? null : (meta.bg || '#ffffff'), true);
      }
      var abs = artboards();
      if (doc && doc.activeArtboardId) S.activeArtboardId = doc.activeArtboardId;
      if (!S.activeArtboardId || !abs.some(function (a) { return a.lsArtboardId === S.activeArtboardId; })) {
        S.activeArtboardId = abs[0] && abs[0].lsArtboardId;
      }
      S.guides = (guides || []).map(function (g) { return { id: g.id || LS.uid('g'), axis: g.axis, pos: g.pos }; });
      S.loading = false;
      resetHistory();
      S.dirty = false;
      setSaveState('saved');
      fitArtboard();
      drawRulers();
      refreshUI();
      S.canvas.requestRenderAll();
      document.dispatchEvent(new CustomEvent('ls:project-open'));
    }

    if (json && json.objects && json.objects.length) {
      S.canvas.loadFromJSON(json, function () {
        S.canvas.renderAll();
        ready();
      });
    } else {
      S.canvas.clear();
      S.canvas.backgroundColor = null;
      ready();
    }
  }

  function leave() {
    saveNow(false).then(function () {
      S.meta = null;
      location.hash = '#/';
    });
  }

  /* ───────────── 保存 ───────────── */
  function collectDoc() {
    return {
      v: 1,
      canvas: S.canvas.toJSON(HIST_PROPS),
      guides: S.guides.map(function (g) { return { id: g.id, axis: g.axis, pos: g.pos }; }),
      activeArtboardId: S.activeArtboardId,
      view: { zoom: S.zoom, offset: { x: S.canvas.viewportTransform[4], y: S.canvas.viewportTransform[5] } }
    };
  }

  function metaForSave() {
    var ab = artboards()[0] || activeArtboard();
    var m = S.meta || {};
    return {
      id: m.id,
      name: ($('#proj-name').value || '').trim() || '未命名项目',
      w: ab ? Math.round(ab.width) : m.w,
      h: ab ? Math.round(ab.height) : m.h,
      dpi: S.dpi,
      createdAt: m.createdAt || Date.now(),
      updatedAt: Date.now(),
      thumb: S.lastThumb || m.thumb || '',
      artboardCount: artboards().length
    };
  }

  function makeThumb() {
    try {
      var ab = activeArtboard();
      if (!ab) return S.lastThumb || '';
      if (LS.exporter && LS.exporter.thumb) return LS.exporter.thumb(ab);
      return S.canvas.toDataURL({ format: 'jpeg', quality: 0.8, multiplier: 0.4 });
    } catch (e) { return S.lastThumb || ''; }
  }

  function saveNow(silent) {
    if (!S.meta || !S.canvas || S.loading) return Promise.resolve();
    clearTimeout(S.saveTimer);
    S.saving = true;
    setSaveState('saving');
    var meta = metaForSave();
    meta.thumb = makeThumb();
    S.lastThumb = meta.thumb;
    var doc = collectDoc();
    return LS.store.save(meta, doc).then(function (saved) {
      if (S.meta && saved) S.meta.updatedAt = saved.updatedAt;
      S.saving = false; S.dirty = false;
      setSaveState('saved');
      if (!silent) { /* toast 由调用方决定 */ }
      return saved;
    }).catch(function (err) {
      S.saving = false;
      setSaveState('error');
      if (!silent) LS.toast('保存失败：' + (err && err.message || '浏览器存储空间可能已满'), 'err');
      return null;
    });
  }

  function scheduleSave() {
    S.dirty = true;
    setSaveState('dirty');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () { saveNow(true); }, 1300);
  }

  function setSaveState(state) {
    var el = $('#save-state');
    if (!el) return;
    var txt = el.querySelector('span');
    if (!txt) {
      el.innerHTML = '<i class="dot"></i><span></span>';
      txt = el.querySelector('span');
    }
    el.className = 'save-state ' + (state === 'saved' ? '' : state);
    txt.textContent = state === 'dirty' ? '未保存' : state === 'saving' ? '保存中…' : state === 'error' ? '保存失败' : '已保存';
  }

  function markDirty() {
    S.dirty = true;
    setSaveState('dirty');
    scheduleSave();
  }

  /* ───────────── 历史 ───────────── */
  function snapshot() {
    return JSON.stringify({
      canvas: S.canvas.toJSON(HIST_PROPS),
      guides: S.guides,
      active: S.activeArtboardId
    });
  }
  function resetHistory() {
    S.history.states = [snapshot()];
    S.history.idx = 0;
    S.history.current = S.history.states[0];
    updateUndoUI();
  }
  function commitSoon() {
    if (S.drawing || S.pen || S.loading || S.restoring) return;
    clearTimeout(S.commitTimer);
    S.commitTimer = setTimeout(commitNow, 30);
  }
  function commitNow() {
    if (S.history.lock || S.loading || S.restoring || S.drawing || S.pen) return;
    var snap = snapshot();
    if (snap === S.history.current) return;
    S.history.states = S.history.states.slice(0, S.history.idx + 1);
    // 带大图的项目不能让撤销栈无限膨胀：限制条数 + 总量
    var total = 0;
    S.history.states.forEach(function (x) { total += x.length; });
    while (S.history.states.length > 3 && (total + snap.length > 70e6 || S.history.states.length >= 50)) {
      total -= S.history.states.shift().length;
    }
    S.history.states.push(snap);
    S.history.idx = S.history.states.length - 1;
    S.history.current = snap;
    updateUndoUI();
    markDirty();
  }
  function undo() { jumpHistory(-1); }
  function redo() { jumpHistory(1); }
  function jumpHistory(dir) {
    var h = S.history;
    if (h.lock) return;
    var idx = h.idx + dir;
    if (idx < 0 || idx >= h.states.length) return;
    h.idx = idx;
    h.current = h.states[idx];
    restoreState(h.states[idx]);
  }
  function restoreState(str) {
    var st;
    try { st = JSON.parse(str); } catch (e) { return; }
    S.restoring = true;
    S.history.lock = true;
    S.pen = null; S.drawing = null; S.snapLines = [];
    S.guides = st.guides || [];
    S.activeArtboardId = st.active;
    S.canvas.discardActiveObject();
    S.canvas.loadFromJSON(st.canvas, function () {
      S.canvas.renderAll();
      applyAllLocks();
      ensureArtboardsBottom(true);
      S.restoring = false;
      S.history.lock = false;
      S.history.current = str;
      updateUndoUI();
      markDirty();
      refreshUI();
      S.canvas.requestRenderAll();
    });
  }
  function updateUndoUI() {
    var u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = S.history.idx <= 0;
    if (r) r.disabled = S.history.idx >= S.history.states.length - 1;
  }

  /* ───────────── 缩放 / 视图 ───────────── */
  function afterViewChange() {
    drawRulers();
    var lab = $('#zoom-label');
    if (lab) lab.textContent = Math.round(S.zoom * 100) + '%';
    S.canvas.requestRenderAll();
    var info = $('#ab-info');
    var ab = activeArtboard();
    if (info) info.textContent = ab ? LS.fmtNum(ab.width) + ' × ' + LS.fmtNum(ab.height) + ' mm' : '—';
  }

  function setZoom(z, sx, sy) {
    z = LS.clamp(z, 0.02, 32);
    var c = S.canvas;
    var w = c.getWidth(), h = c.getHeight();
    if (sx == null) sx = w / 2;
    if (sy == null) sy = h / 2;
    var v = c.viewportTransform;
    var dx = (sx - v[4]) / S.zoom, dy = (sy - v[5]) / S.zoom;
    S.zoom = z;
    c.setViewportTransform([z, 0, 0, z, sx - dx * z, sy - dy * z]);
    afterViewChange();
  }

  function zoomAt(docP, factor, sx, sy) {
    var z = LS.clamp(S.zoom * factor, 0.02, 32);
    S.zoom = z;
    S.canvas.setViewportTransform([z, 0, 0, z, sx - docP.x * z, sy - docP.y * z]);
    afterViewChange();
  }

  function fitArtboard() {
    var ab = activeArtboard();
    if (!ab) { if (artboards().length) fitAllArtboards(); return; }
    var c = S.canvas, w = c.getWidth(), h = c.getHeight();
    var pad = 70;
    var z = Math.min((w - pad * 2) / ab.width, (h - pad * 2) / ab.height);
    z = LS.clamp(z, 0.02, 8);
    S.zoom = z;
    c.setViewportTransform([z, 0, 0, z, (w - ab.width * z) / 2 - ab.left * z, (h - ab.height * z) / 2 - ab.top * z]);
    afterViewChange();
  }

  function fitAllArtboards(extra) {
    var abs = artboards();
    var extraList = Array.isArray(extra) ? extra : [];
    if (!abs.length && !extraList.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    abs.forEach(function (a) {
      minX = Math.min(minX, a.left);
      minY = Math.min(minY, a.top);
      maxX = Math.max(maxX, a.left + a.width);
      maxY = Math.max(maxY, a.top + a.height);
    });
    extraList.forEach(function (o) {
      if (!o || !o.getBoundingRect) return;
      var b = o.getBoundingRect(true);
      minX = Math.min(minX, b.left);
      minY = Math.min(minY, b.top);
      maxX = Math.max(maxX, b.left + b.width);
      maxY = Math.max(maxY, b.top + b.height);
    });
    if (!isFinite(minX) || !isFinite(minY)) return;
    var w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    var c = S.canvas, cw = c.getWidth(), ch = c.getHeight();
    var pad = 70;
    var z = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h);
    z = LS.clamp(z, 0.02, 8);
    S.zoom = z;
    c.setViewportTransform([z, 0, 0, z, (cw - w * z) / 2 - minX * z, (ch - h * z) / 2 - minY * z]);
    afterViewChange();
  }

  function onWheel(e) {
    if (!S.canvas || !isActive()) return;
    e.preventDefault();
    e.stopPropagation();
    var c = S.canvas, rect = c.upperCanvasEl.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      var v = c.viewportTransform;
      var dp = { x: (mx - v[4]) / S.zoom, y: (my - v[5]) / S.zoom };
      var factor = Math.pow(1.0015, -e.deltaY);
      factor = LS.clamp(factor, 0.5, 2);
      zoomAt(dp, factor, mx, my);
    } else {
      var vv = c.viewportTransform.slice();
      if (e.shiftKey) { vv[4] -= e.deltaY || e.deltaX; }
      else { vv[4] -= e.deltaX; vv[5] -= e.deltaY; }
      c.setViewportTransform(vv);
      afterViewChange();
    }
  }

  /* ───────────── 标尺 ───────────── */
  function setupRulerCanvas(el) {
    var parent = el.parentElement;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, parent.clientWidth), h = Math.max(1, parent.clientHeight);
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    var ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function niceStep(zoom) {
    var steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    for (var i = 0; i < steps.length; i++) { if (steps[i] * zoom >= 72) return steps[i]; }
    return 100000;
  }

  function drawRulers() {
    if (!S.canvas || !isActive()) return;
    var top = $('#ruler-top'), left = $('#ruler-left');
    if (!top || !left) return;
    var v = S.canvas.viewportTransform, z = S.zoom;
    var ab = activeArtboard();

    var t = setupRulerCanvas(top);
    t.ctx.fillStyle = '#f8fafd';
    t.ctx.fillRect(0, 0, t.w, t.h);
    if (ab) {
      var ax = ab.left * z + v[4], aw = ab.width * z;
      t.ctx.fillStyle = 'rgba(36,87,245,.07)';
      t.ctx.fillRect(ax, 0, aw, t.h);
    }
    t.ctx.strokeStyle = '#dfe5ef';
    t.ctx.beginPath();
    t.ctx.moveTo(0, t.h - 0.5);
    t.ctx.lineTo(t.w, t.h - 0.5);
    t.ctx.stroke();

    var step = niceStep(z), minor = step / 5;
    var start = Math.floor((0 - v[4]) / z / minor) * minor;
    var end = (t.w - v[4]) / z;
    t.ctx.font = '9px -apple-system, "PingFang SC", sans-serif';
    t.ctx.textBaseline = 'top';
    var i = 0;
    for (var x = start; x <= end + minor && i < 3000; x += minor, i++) {
      var sx = Math.round(x * z + v[4]) + 0.5;
      if (sx < -20 || sx > t.w + 20) continue;
      var isMajor = Math.abs(x / step - Math.round(x / step)) < 0.0001;
      t.ctx.strokeStyle = isMajor ? '#b6c1d2' : '#d7dee9';
      t.ctx.beginPath();
      t.ctx.moveTo(sx, isMajor ? 12 : 16);
      t.ctx.lineTo(sx, t.h);
      t.ctx.stroke();
      if (isMajor) {
        t.ctx.fillStyle = '#8794a8';
        var label = Math.abs(x) < 0.001 ? '0' : (Math.abs(x) >= 1 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
        t.ctx.fillText(label, sx + 3, 2);
      }
    }

    var l = setupRulerCanvas(left);
    l.ctx.fillStyle = '#f8fafd';
    l.ctx.fillRect(0, 0, l.w, l.h);
    if (ab) {
      var ay = ab.top * z + v[5], ah = ab.height * z;
      l.ctx.fillStyle = 'rgba(36,87,245,.07)';
      l.ctx.fillRect(0, ay, l.w, ah);
    }
    l.ctx.strokeStyle = '#dfe5ef';
    l.ctx.beginPath();
    l.ctx.moveTo(l.w - 0.5, 0);
    l.ctx.lineTo(l.w - 0.5, l.h);
    l.ctx.stroke();
    var startY = Math.floor((0 - v[5]) / z / minor) * minor;
    var endY = (l.h - v[5]) / z;
    l.ctx.font = '9px -apple-system, "PingFang SC", sans-serif';
    l.ctx.textBaseline = 'middle';
    var j = 0;
    for (var y = startY; y <= endY + minor && j < 3000; y += minor, j++) {
      var sy = Math.round(y * z + v[5]) + 0.5;
      if (sy < -20 || sy > l.h + 20) continue;
      var majorY = Math.abs(y / step - Math.round(y / step)) < 0.0001;
      l.ctx.strokeStyle = majorY ? '#b6c1d2' : '#d7dee9';
      l.ctx.beginPath();
      l.ctx.moveTo(majorY ? 12 : 16, sy);
      l.ctx.lineTo(l.w, sy);
      l.ctx.stroke();
      if (majorY) {
        l.ctx.save();
        l.ctx.fillStyle = '#8794a8';
        l.ctx.translate(2, sy - 3);
        l.ctx.rotate(-Math.PI / 2);
        l.ctx.textBaseline = 'top';
        var lab = Math.abs(y) < 0.001 ? '0' : (Math.abs(y) >= 1 ? String(Math.round(y)) : String(Math.round(y * 10) / 10));
        l.ctx.fillText(lab, 0, 0);
        l.ctx.restore();
      }
    }
  }

  /* ───────────── 画布叠加层 ───────────── */
  function drawOverlay() {
    if (!S.canvas || !isActive()) return;
    var ctx = S.canvas.getContext();
    var w = S.canvas.getWidth(), h = S.canvas.getHeight();
    var v = S.canvas.viewportTransform, z = S.zoom;
    ctx.save();
    ctx.setTransform(S.canvas.getRetinaScaling(), 0, 0, S.canvas.getRetinaScaling(), 0, 0);

    var list = artboards();
    var active = activeArtboard();
    S.artboardLabelRects = {};

    if (S.preview && active) {
      var sx = active.left * z + v[4], sy = active.top * z + v[5];
      var sw = active.width * z, sh = active.height * z;
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(sx, sy, sw, sh);
      ctx.fillStyle = 'rgba(230,234,241,.94)';
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(15,23,42,.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sw), Math.round(sh));
      ctx.restore();
      return;
    }

    list.forEach(function (ab) {
      var x = ab.left * z + v[4], y = ab.top * z + v[5];
      var ww = ab.width * z, hh = ab.height * z;
      if (x + ww < -20 || y + hh < -20 || x > w + 20 || y > h + 20) return;
      var isAct = active && ab.lsArtboardId === active.lsArtboardId;
      ctx.strokeStyle = isAct ? '#2457f5' : 'rgba(15,23,42,.22)';
      ctx.lineWidth = isAct ? 1.4 : 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(ww), Math.round(hh));

      var label = (ab.lsBoardLocked ? '🔒  ' : '⠿  ') + (ab.lsName || '画板') + '  ' + LS.fmtNum(ab.width) + ' × ' + LS.fmtNum(ab.height) + ' mm';
      ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
      var tw = ctx.measureText(label).width;
      var lx = Math.round(x), ly = Math.round(y) - 21;
      if (ly < 2) ly = Math.round(y) + 6;
      var labelW = isAct ? tw + 14 : tw + 12;
      S.artboardLabelRects[ab.lsArtboardId] = { x: lx, y: ly, w: labelW, h: 17 };
      if (isAct) {
        ctx.fillStyle = '#2457f5';
        roundRect(ctx, lx, ly, labelW, 17, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 7, ly + 9);
      } else {
        ctx.fillStyle = 'rgba(15,23,42,.05)';
        roundRect(ctx, lx, ly, labelW, 17, 4);
        ctx.fill();
        ctx.fillStyle = '#55657d';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 6, ly + 9);
      }
    });

    S.guides.forEach(function (g) {
      var sel = S.selectedGuide === g.id;
      ctx.strokeStyle = sel ? '#0f8f8e' : '#4fb8b6';
      ctx.lineWidth = sel ? 1.6 : 1;
      ctx.setLineDash(sel ? [] : [5, 4]);
      ctx.beginPath();
      if (g.axis === 'x') {
        var gx = Math.round(g.pos * z + v[4]) + 0.5;
        ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
      } else {
        var gy = Math.round(g.pos * z + v[5]) + 0.5;
        ctx.moveTo(0, gy); ctx.lineTo(w, gy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (sel) {
        ctx.fillStyle = '#0f8f8e';
        if (g.axis === 'x') {
          ctx.beginPath(); ctx.arc(g.pos * z + v[4], 10, 3, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(10, g.pos * z + v[5], 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    });

    if (S.snapLines.length) {
      ctx.strokeStyle = '#e0559b';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      S.snapLines.forEach(function (l) {
        if (l.axis === 'x') {
          var lx2 = Math.round(l.pos * z + v[4]) + 0.5;
          ctx.moveTo(lx2, 0); ctx.lineTo(lx2, h);
        } else {
          var ly2 = Math.round(l.pos * z + v[5]) + 0.5;
          ctx.moveTo(0, ly2); ctx.lineTo(w, ly2);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (S.pen) {
      var pts = S.pen.points;
      var cur = S.pen.cursor;
      ctx.strokeStyle = '#2457f5';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach(function (p, idx) {
        var sp = docToScreen(p.x, p.y);
        if (idx === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      });
      if (cur) { var sc = docToScreen(cur.x, cur.y); ctx.lineTo(sc.x, sc.y); }
      ctx.stroke();
      if (pts.length > 2 && cur) {
        var s0 = docToScreen(pts[0].x, pts[0].y), scc = docToScreen(cur.x, cur.y);
        var closeDist = Math.hypot(s0.x - scc.x, s0.y - scc.y);
        if (closeDist < 10) {
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(scc.x, scc.y); ctx.lineTo(s0.x, s0.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      pts.forEach(function (p) {
        var sp2 = docToScreen(p.x, p.y);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#2457f5';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(sp2.x - 3, sp2.y - 3, 6, 6); ctx.fill(); ctx.stroke();
      });
      if (pts.length > 2) {
        var f = docToScreen(pts[0].x, pts[0].y);
        ctx.strokeStyle = '#0f8f8e';
        ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI * 2); ctx.stroke();
      }
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ───────────── 画板 ───────────── */
  function addArtboard(x, y, w, h, name, bg, silent) {
    var id = LS.uid('ab');
    var rect = new fabric.Rect({
      left: x, top: y, width: Math.max(1, w), height: Math.max(1, h),
      fill: bg === null ? null : (bg || '#ffffff'), strokeWidth: 0, selectable: false, evented: false, hasControls: false,
      shadow: new fabric.Shadow({ color: 'rgba(15,23,42,.16)', blur: 22, offsetX: 0, offsetY: 6 }),
      lsArtboard: true, lsArtboardId: id, lsName: name || ('画板 ' + (artboards().length + 1))
    });
    var count = artboards().length;
    S.canvas.insertAt(rect, count, false);
    ensureArtboardsBottom();
    S.activeArtboardId = id;
    if (!silent) {
      commitNow(); markDirty();
    }
    refreshUI();
    S.canvas.requestRenderAll();
    return rect;
  }

  function nextArtboardPos(w, h) {
    var abs = artboards();
    if (!abs.length) return { x: 0, y: 0 };
    var right = -Infinity;
    var top = Infinity;
    abs.forEach(function (a) {
      right = Math.max(right, a.left + a.width);
      top = Math.min(top, a.top);
    });
    var active = activeArtboard();
    return { x: Math.round(right + 100), y: Math.round(active ? active.top : top) };
  }

  function setActiveArtboard(id, opts) {
    var ab = null;
    artboards().forEach(function (a) { if (a.lsArtboardId === id) ab = a; });
    if (!ab) return;
    S.activeArtboardId = id;
    S.selectedGuide = null;
    if (S.canvas.getActiveObject()) {
      S.canvas.discardActiveObject();
      S.canvas.requestRenderAll();
    }
    refreshUI();
    if (!opts || !opts.noFit) afterViewChange();
    if (!opts || !opts.silent) { markDirty(); }
  }

  function updateArtboard(id, patch) {
    var ab = null;
    artboards().forEach(function (a) { if (a.lsArtboardId === id) ab = a; });
    if (!ab) return;
    if (ab.lsBoardLocked) { LS.toast('画板已锁定，先解锁再修改画板属性', 'warn', 3200); return; }
    if (patch.name != null) ab.lsName = patch.name;
    if (patch.fill != null) ab.set('fill', patch.fill);
    if (patch.x != null) ab.set('left', patch.x);
    if (patch.y != null) ab.set('top', patch.y);
    if (patch.w != null) ab.set('width', Math.max(1, patch.w));
    if (patch.h != null) ab.set('height', Math.max(1, patch.h));
    ab.setCoords();
    syncClipsToBoard(ab);
    S.canvas.requestRenderAll();
    commitSoon(); markDirty(); refreshUI(); drawRulers();
  }

  function deleteArtboard(id) {
    var abs = artboards();
    var ab = abs.find(function (a) { return a.lsArtboardId === id; });
    if (!ab) return;
    if (ab.lsBoardLocked) { LS.toast('画板已锁定，先解锁再删除', 'warn', 3200); return; }
    S.canvas.remove(ab);
    if (S.activeArtboardId === id) {
      var rest = artboards();
      S.activeArtboardId = rest[0] ? rest[0].lsArtboardId : null;
    }
    commitNow(); markDirty(); refreshUI(); afterViewChange();
  }

  function moveArtboardTo(id, x, y, opts) {
    var abs = artboards();
    var ab = abs.filter(function (a) { return a.lsArtboardId === id; })[0];
    if (!ab) return false;
    if (ab.lsBoardLocked) return false;
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) return false;
    x = Math.max(-100000, Math.min(100000, x));
    y = Math.max(-100000, Math.min(100000, y));
    var dx = x - ab.left, dy = y - ab.top;
    if (!dx && !dy) return true;
    var contents = boardContents(ab);
    ab.set({ left: x, top: y });
    ab.setCoords();
    contents.forEach(function (it) {
      it.o.set({ left: it.left + dx, top: it.top + dy });
      it.o.setCoords();
    });
    shiftClipsForBoard(ab.lsArtboardId, dx, dy);
    S.canvas.requestRenderAll();
    drawRulers();
    drawOverlay();
    if (!opts || !opts.silent) {
      commitNow();
      markDirty();
      refreshUI();
      if (LS.props && LS.props.showPanel) LS.props.showPanel();
    }
    return true;
  }

  function artboardAt(p) {
    var list = artboards();
    for (var i = list.length - 1; i >= 0; i--) {
      var a = list[i];
      if (p.x >= a.left && p.x <= a.left + a.width && p.y >= a.top && p.y <= a.top + a.height) return a;
    }
    return null;
  }

  function ensureArtboardsBottom(force) {
    var abs = artboards();
    for (var i = abs.length - 1; i >= 0; i--) {
      S.canvas.sendToBack(abs[i]);
    }
  }

  /* ───────────── 工具 ───────────── */
  function setTool(t) {
    if (S.pen) finishPen(false);
    S.tool = t;
    LS.$$('.tool[data-tool]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === t);
    });
    var c = S.canvas;
    if (!c) return;
    var selectable = t === 'select';
    c.selection = selectable;
    c.skipTargetFind = !selectable;
    c.defaultCursor = t === 'hand' ? 'grab' : (t === 'zoom' ? 'zoom-in' : (t === 'select' ? 'default' : 'crosshair'));
    c.hoverCursor = t === 'select' ? 'move' : 'crosshair';
    if (!selectable) { S.snapLines = []; }
    if (t === 'image') { $('#file-image').click(); setTool('select'); }
    if (t === 'zoom') { c.defaultCursor = 'zoom-in'; }
    LS.props && LS.props.renderProps();
    drawOverlay();
  }

  /* ───────────── 鼠标交互 ───────────── */
  function onMouseDown(opt) {
    if (!isActive()) return;
    var e = opt.e;
    if (e.button === 1 || S.space || S.tool === 'hand') return;
    var p = docPoint(e);
    S.selectedGuide = null;

    if (S.tool === 'zoom') {
      var z = e.altKey ? S.zoom / 2 : S.zoom * 2;
      var r0 = S.canvas.upperCanvasEl.getBoundingClientRect();
      zoomAt(p, z / S.zoom, e.clientX - r0.left, e.clientY - r0.top);
      return;
    }
    if (S.tool === 'artboard') { startArtboardDraw(p, e); return; }
    if (SHAPE_TOOLS.indexOf(S.tool) >= 0) { startShapeDraw(p, e); return; }
    if (S.tool === 'pen') { penClick(p, e); return; }
    if (S.tool === 'text') { createTextAt(p); return; }
    if (S.tool === 'image') { $('#file-image').click(); setTool('select'); return; }

    if (S.tool === 'select' && !S.preview) {
      var lab = artboardLabelAt(e);
      if (lab) { startArtboardDrag(lab, e, p); return; }
      if (!opt.target) {
        var edge = artboardBorderAt(e);
        if (edge) { startArtboardDrag(edge, e, p); return; }
      }
    }

    if (!opt.target) {
      var ab = artboardAt(p);
      if (ab) {
        if (ab.lsArtboardId !== S.activeArtboardId) {
          S.activeArtboardId = ab.lsArtboardId;
          refreshUI(); afterViewChange();
        }
        if (LS.props && LS.props.showPanel) LS.props.showPanel();
      } else if (S.activeArtboardId) {
        S.activeArtboardId = null;
        S.selectedGuide = null;
        S.canvas.discardActiveObject();
        if (LS.props && LS.props.hidePanel) LS.props.hidePanel();
        refreshUI(); afterViewChange();
      }
      S.canvas.requestRenderAll();
    }
  }

  function artboardLabelAt(ev) {
    if (!S.artboardLabelRects || !S.canvas) return null;
    var r = S.canvas.upperCanvasEl.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    var ids = Object.keys(S.artboardLabelRects);
    for (var i = 0; i < ids.length; i++) {
      var box = S.artboardLabelRects[ids[i]];
      if (x >= box.x - 3 && x <= box.x + box.w + 3 && y >= box.y - 3 && y <= box.y + box.h + 3) {
        var id = ids[i];
        var list = artboards();
        for (var j = 0; j < list.length; j++) if (list[j].lsArtboardId === id) return list[j];
      }
    }
    return null;
  }

  function artboardBorderAt(ev) {
    if (!S.canvas) return null;
    var r = S.canvas.upperCanvasEl.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    var z = S.zoom, v = S.canvas.viewportTransform;
    var list = artboards();
    for (var i = list.length - 1; i >= 0; i--) {
      var a = list[i];
      var l = a.left * z + v[4], t = a.top * z + v[5];
      var w = a.width * z, h = a.height * z;
      if (x < l - 6 || x > l + w + 6 || y < t - 6 || y > t + h + 6) continue;
      var dEdge = Math.min(Math.abs(x - l), Math.abs(x - (l + w)), Math.abs(y - t), Math.abs(y - (t + h)));
      if (dEdge <= 6) return a;
    }
    return null;
  }

  function boardContents(ab) {
    var cx0 = ab.left, cy0 = ab.top, cx1 = ab.left + ab.width, cy1 = ab.top + ab.height;
    return objects().filter(function (o) {
      var b = o.getBoundingRect(true);
      var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      return cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1;
    }).map(function (o) { return { o: o, left: o.left, top: o.top }; });
  }

  function makeBoardClip(ab) {
    var cp = new fabric.Rect({
      left: ab.left, top: ab.top, width: ab.width, height: ab.height,
      originX: 'left', originY: 'top', absolutePositioned: true,
      fill: '#000000', stroke: null, selectable: false, evented: false
    });
    cp.lsClipArtboardId = ab.lsArtboardId;
    return cp;
  }

  function boardForObject(o) {
    if (!o || !S.canvas) return null;
    var b = o.getBoundingRect(true);
    var best = null, bestArea = 0;
    artboards().forEach(function (ab) {
      var x1 = Math.max(b.left, ab.left);
      var y1 = Math.max(b.top, ab.top);
      var x2 = Math.min(b.left + b.width, ab.left + ab.width);
      var y2 = Math.min(b.top + b.height, ab.top + ab.height);
      var area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      if (area > bestArea) { bestArea = area; best = ab; }
    });
    return bestArea > 0 ? best : null;
  }

  function shiftClipsForBoard(id, dx, dy) {
    if (!id || (!dx && !dy)) return;
    objects().forEach(function (o) {
      var cp = o.clipPath;
      if (cp && cp.lsClipArtboardId === id) {
        cp.set({ left: (cp.left || 0) + dx, top: (cp.top || 0) + dy });
        cp.setCoords();
        o.set('dirty', true);
      }
    });
  }

  function syncClipsToBoard(ab) {
    if (!ab) return;
    objects().forEach(function (o) {
      var cp = o.clipPath;
      if (cp && cp.lsClipArtboardId === ab.lsArtboardId) {
        cp.set({ left: ab.left, top: ab.top, width: ab.width, height: ab.height });
        cp.setCoords();
        o.set('dirty', true);
      }
    });
  }

  function clipSelectionToArtboard() {
    if (!S.canvas) return 0;
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) { LS.toast('先选中要裁切的元素', 'warn'); return 0; }
    var active = activeArtboard();
    var done = 0;
    objs.forEach(function (o) {
      var ab = boardForObject(o) || active;
      if (!ab) return;
      o.clipPath = makeBoardClip(ab);
      o.set('dirty', true);
      o.setCoords();
      done++;
    });
    if (!done) { LS.toast('没找到元素所在的画板，先把元素放到画板内再裁切', 'warn', 3600); return 0; }
    S.canvas.requestRenderAll();
    commitNow();
    markDirty();
    refreshUI();
    LS.toast('已裁切到画板：画板外的部分会隐藏 · ⌘Z 撤销', 'ok', 3600);
    return done;
  }

  function unclipSelection() {
    if (!S.canvas) return 0;
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    var done = 0;
    objs.forEach(function (o) {
      if (o.clipPath) {
        o.clipPath = null;
        o.set('dirty', true);
        o.setCoords();
        done++;
      }
    });
    if (done) {
      S.canvas.requestRenderAll();
      commitNow();
      markDirty();
      refreshUI();
      LS.toast('已取消画板裁切', 'ok');
    }
    return done;
  }

  function snapBoardDrag(d, dx, dy) {
    if (!S.snap) return { dx: dx, dy: dy };
    var th = 6 / Math.max(0.02, S.zoom);
    var xs = [], ys = [];
    artboards().forEach(function (a) {
      if (a === d.ab) return;
      xs.push(a.left, a.left + a.width / 2, a.left + a.width);
      ys.push(a.top, a.top + a.height / 2, a.top + a.height);
    });
    S.guides.forEach(function (g) { if (g.axis === 'x') xs.push(g.pos); else ys.push(g.pos); });
    var l = d.baseLeft + dx, t = d.baseTop + dy;
    var mx = [l, l + d.ab.width / 2, l + d.ab.width];
    var my = [t, t + d.ab.height / 2, t + d.ab.height];
    var bx = null, by = null;
    mx.forEach(function (m) {
      xs.forEach(function (c) {
        var diff = c - m;
        if (Math.abs(diff) <= th && (bx === null || Math.abs(diff) < Math.abs(bx))) bx = diff;
      });
    });
    my.forEach(function (m) {
      ys.forEach(function (c) {
        var diff = c - m;
        if (Math.abs(diff) <= th && (by === null || Math.abs(diff) < Math.abs(by))) by = diff;
      });
    });
    return { dx: dx + (bx || 0), dy: dy + (by || 0) };
  }

  function startArtboardDrag(ab, e, p) {
    if (!ab) return;
    e.preventDefault();
    if (ab.lsBoardLocked) {
      setActiveArtboard(ab.lsArtboardId, { noFit: true, silent: true });
      LS.toast('画板已锁定，先在右侧或画板列表解锁再移动', 'warn', 3400);
      return;
    }
    setActiveArtboard(ab.lsArtboardId, { noFit: true, silent: true });
    S.artboardDrag = {
      ab: ab, startX: p.x, startY: p.y, baseLeft: ab.left, baseTop: ab.top,
      objs: boardContents(ab), dx: 0, dy: 0, moved: false,
      clips: objects().filter(function (o) {
        return o.clipPath && o.clipPath.lsClipArtboardId === ab.lsArtboardId;
      }).map(function (o) {
        return { o: o, cp: o.clipPath, left: o.clipPath.left || 0, top: o.clipPath.top || 0 };
      })
    };
    S.canvas.selection = false;
    S.canvas.skipTargetFind = true;
    S.canvas.upperCanvasEl.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onBoardDragMove);
    document.addEventListener('mouseup', onBoardDragEnd);
    S.canvas.requestRenderAll();
    drawOverlay();
  }

  function onBoardDragMove(ev) {
    var d = S.artboardDrag;
    if (!d) return;
    var p = screenToDoc(ev.clientX, ev.clientY);
    var dx = p.x - d.startX, dy = p.y - d.startY;
    if (!d.moved && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
    d.moved = true;
    var s = snapBoardDrag(d, dx, dy);
    dx = s.dx; dy = s.dy;
    if (d.dx === dx && d.dy === dy) return;
    d.dx = dx; d.dy = dy;
    d.ab.set({ left: d.baseLeft + dx, top: d.baseTop + dy });
    d.ab.setCoords();
    d.objs.forEach(function (it) {
      it.o.set({ left: it.left + dx, top: it.top + dy });
      it.o.setCoords();
    });
    (d.clips || []).forEach(function (c) {
      c.cp.set({ left: c.left + dx, top: c.top + dy });
      c.cp.setCoords();
      c.o.set('dirty', true);
    });
    S.canvas.requestRenderAll();
    drawRulers();
    drawOverlay();
  }

  function onBoardDragEnd() {
    var d = S.artboardDrag;
    if (!d) return;
    S.artboardDrag = null;
    document.removeEventListener('mousemove', onBoardDragMove);
    document.removeEventListener('mouseup', onBoardDragEnd);
    S.canvas.selection = true;
    S.canvas.skipTargetFind = false;
    S.canvas.upperCanvasEl.style.cursor = '';
    if (d.moved) {
      commitNow();
      markDirty();
      drawRulers();
      refreshUI();
    } else {
      refreshUI();
    }
    S.canvas.requestRenderAll();
    if (LS.props && LS.props.showPanel) LS.props.showPanel();
  }

  function onMouseMove(opt) {
    if (!isActive()) return;
    var p = docPoint(opt.e);
    if (S.drawing) { updateShapeDraw(p, opt.e); return; }
    if (S.pen) {
      S.pen.cursor = snapPoint(p, null);
      S.canvas.requestRenderAll();
      return;
    }
  }

  function onMouseUp(opt) {
    if (S.drawing) { finishShapeDraw(); return; }
    if (S.snapLines.length) { S.snapLines = []; S.canvas.requestRenderAll(); }
  }

  function onDblClick(opt) {
    if (S.pen) { finishPen(false); return; }
    if (S.tool === 'select' && opt.target && opt.target.type === 'textbox') {
      if (!opt.target.isEditing) {
        S.canvas.setActiveObject(opt.target);
        opt.target.enterEditing();
        opt.target.selectAll();
      }
    }
  }

  function onUpperDownCapture(e) {
    if (!S.canvas || !isActive()) return;
    if (e.button === 1 || S.space || S.tool === 'hand') {
      e.preventDefault(); e.stopPropagation();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (S.tool !== 'select') return;
    var p = screenToDoc(e.clientX, e.clientY);
    var g = guideNear(p);
    if (g) {
      e.preventDefault(); e.stopPropagation();
      S.selectedGuide = g.id;
      startGuideDrag(g, e, false);
      S.canvas.requestRenderAll();
    }
  }

  function startPan(e) {
    S.panning = { x: e.clientX, y: e.clientY, vx: S.canvas.viewportTransform[4], vy: S.canvas.viewportTransform[5] };
    S.canvas.upperCanvasEl.style.cursor = 'grabbing';
    var move = function (ev) {
      var v = S.canvas.viewportTransform.slice();
      v[4] = S.panning.vx + (ev.clientX - S.panning.x);
      v[5] = S.panning.vy + (ev.clientY - S.panning.y);
      S.canvas.setViewportTransform(v);
      afterViewChange();
    };
    var up = function () {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      S.panning = null;
      if (S.canvas) S.canvas.upperCanvasEl.style.cursor = S.space ? 'grab' : '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /* 吸附 */
  function snapTargets(exclude) {
    var xs = [], ys = [];
    var ab = activeArtboard();
    artboards().forEach(function (a) {
      if (a === exclude) return;
      xs.push(a.left, a.left + a.width / 2, a.left + a.width);
      ys.push(a.top, a.top + a.height / 2, a.top + a.height);
    });
    S.guides.forEach(function (g) {
      if (g.axis === 'x') xs.push(g.pos); else ys.push(g.pos);
    });
    var skip = exclude ? [exclude].concat(exclude._objects || []) : [];
    objects().forEach(function (o) {
      if (skip.indexOf(o) >= 0 || !o.visible) return;
      var b = o.getBoundingRect(true);
      if (b.width > 100000) return;
      xs.push(b.left, b.left + b.width / 2, b.left + b.width);
      ys.push(b.top, b.top + b.height / 2, b.top + b.height);
    });
    return { xs: xs, ys: ys };
  }

  function snapPoint(p, exclude) {
    if (!S.snap) return p;
    var th = 7 / S.zoom;
    var t = snapTargets(exclude);
    var out = { x: p.x, y: p.y }, lines = [];
    var bx = nearest(t.xs, p.x, th);
    if (bx != null) { out.x = bx; }
    var by = nearest(t.ys, p.y, th);
    if (by != null) { out.y = by; }
    return out;
  }

  function nearest(arr, v, th) {
    var best = null, bd = th;
    for (var i = 0; i < arr.length; i++) {
      var d = Math.abs(arr[i] - v);
      if (d < bd) { bd = d; best = arr[i]; }
    }
    return best;
  }

  function onMoving(opt) {
    if (!S.snap || !opt.target || opt.target.lsArtboard) { S.snapLines = []; return; }
    if (opt.e && opt.e.altKey) { S.snapLines = []; S.canvas.requestRenderAll(); return; }
    var target = opt.target;
    var b = target.getBoundingRect(true);
    var th = 7 / S.zoom;
    var t = snapTargets(target);
    var ax = [b.left, b.left + b.width / 2, b.left + b.width];
    var ay = [b.top, b.top + b.height / 2, b.top + b.height];
    var bx = bestSnap(ax, t.xs, th), by = bestSnap(ay, t.ys, th);
    S.snapLines = [];
    if (bx) {
      target.set({ left: target.left + bx.delta });
      S.snapLines.push({ axis: 'x', pos: bx.target });
    }
    if (by) {
      target.set({ top: target.top + by.delta });
      S.snapLines.push({ axis: 'y', pos: by.target });
    }
    target.setCoords();
    S.canvas.requestRenderAll();
  }

  function bestSnap(anchors, targets, th) {
    var best = null;
    anchors.forEach(function (a) {
      targets.forEach(function (t) {
        var d = t - a;
        if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.delta))) {
          best = { delta: d, target: t };
        }
      });
    });
    return best;
  }

  /* ───────────── 画图形 / 画板 ───────────── */
  function startArtboardDraw(p, e) {
    var start = { x: Math.round(p.x), y: Math.round(p.y) };
    var rect = new fabric.Rect({
      left: start.x, top: start.y, width: 1, height: 1,
      fill: 'rgba(36,87,245,.05)', stroke: '#2457f5', strokeWidth: 1 / S.zoom,
      strokeDashArray: [6 / S.zoom, 4 / S.zoom], selectable: false, evented: false, lsTemp: true
    });
    S.canvas.add(rect);
    S.drawing = { kind: 'artboard', obj: rect, start: start, alt: false };
    S.canvas.requestRenderAll();
  }

  function startShapeDraw(p, e) {
    var c = S.canvas;
    c.skipTargetFind = true;
    c.selection = false;
    var start = snapPoint(p, null);
    var obj;
    if (S.tool === 'rect') {
      obj = new fabric.Rect({
        left: start.x, top: start.y, width: 1, height: 1, rx: 0, ry: 0,
        fill: S.style.fill,
        stroke: S.style.strokeWidth > 0 ? S.style.stroke : null,
        strokeWidth: S.style.strokeWidth
      });
    } else if (S.tool === 'ellipse') {
      obj = new fabric.Ellipse({
        left: start.x, top: start.y, rx: 0.5, ry: 0.5,
        fill: S.style.fill,
        stroke: S.style.strokeWidth > 0 ? S.style.stroke : null,
        strokeWidth: S.style.strokeWidth
      });
    } else if (S.tool === 'polygon') {
      obj = new fabric.Polygon(polyPoints(6, false, 100), {
        left: start.x, top: start.y, scaleX: 0.001, scaleY: 0.001,
        fill: S.style.fill,
        stroke: S.style.strokeWidth > 0 ? S.style.stroke : null,
        strokeWidth: S.style.strokeWidth,
        lsSides: 6, lsStar: false
      });
    } else {
      obj = new fabric.Line([start.x, start.y, start.x, start.y], {
        stroke: S.style.stroke, strokeWidth: S.style.strokeWidth || 2,
        fill: null
      });
    }
    obj.lsTemp = true;
    c.add(obj);
    S.drawing = { obj: obj, start: start, alt: !!e.altKey };
  }

  function updateShapeDraw(p, e) {
    var d = S.drawing, obj = d.obj;
    if (!obj) return;
    var sp = snapPoint(p, null);
    var x1 = d.start.x, y1 = d.start.y, x2 = sp.x, y2 = sp.y;
    if (d.kind === 'artboard') {
      var aw = Math.abs(x2 - x1), ah = Math.abs(y2 - y1);
      if (e.shiftKey) { var am = Math.max(aw, ah); aw = am; ah = am; }
      obj.set({
        left: Math.min(x1, x2), top: Math.min(y1, y2),
        width: Math.max(aw, 1), height: Math.max(ah, 1)
      });
      obj.setCoords();
      S.canvas.requestRenderAll();
      return;
    }
    if (S.tool === 'line') {
      if (e.shiftKey) {
        var ang = Math.atan2(y2 - y1, x2 - x1);
        var snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        var len = Math.hypot(x2 - x1, y2 - y1);
        x2 = x1 + Math.cos(snapped) * len;
        y2 = y1 + Math.sin(snapped) * len;
      }
      obj.set({ x1: x1, y1: y1, x2: x2, y2: y2 });
      obj.setCoords();
      S.canvas.requestRenderAll();
      return;
    }
    var w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    var left = Math.min(x1, x2), top = Math.min(y1, y2);
    if (e.shiftKey) {
      var m = Math.max(w, h);
      w = m; h = m;
      left = x2 >= x1 ? x1 : x1 - m;
      top = y2 >= y1 ? y1 : y1 - m;
    }
    if (e.altKey) { left = x1 - w / 2; top = y1 - h / 2; }
    w = Math.max(w, 0.5); h = Math.max(h, 0.5);

    if (S.tool === 'rect') {
      obj.set({ left: left, top: top, width: w, height: h });
    } else if (S.tool === 'ellipse') {
      obj.set({ left: left, top: top, rx: w / 2, ry: h / 2 });
    } else if (S.tool === 'polygon') {
      setPolyScale(obj, left, top, w, h);
    }
    obj.setCoords();
    S.canvas.requestRenderAll();
  }

  function finishShapeDraw() {
    var d = S.drawing;
    S.drawing = null;
    if (!d || !d.obj) return;
    var obj = d.obj;
    obj.set('lsTemp', false);
    if (d.kind === 'artboard') {
      S.canvas.remove(obj);
      var bb = { left: obj.left, top: obj.top, width: obj.width, height: obj.height };
      if (bb.width < 20 || bb.height < 20) {
        var p = { x: d.start.x, y: d.start.y };
        var hit = artboardAt(p);
        if (hit) setActiveArtboard(hit.lsArtboardId);
        else {
          addArtboard(Math.round(d.start.x), Math.round(d.start.y), 1000, 2000, '画板 ' + (artboards().length + 1), '#ffffff');
          fitArtboard();
        }
      } else {
        var ab = addArtboard(Math.round(bb.left), Math.round(bb.top), Math.round(bb.width), Math.round(bb.height),
          '画板 ' + (artboards().length + 1), '#ffffff');
        fitArtboard();
      }
      setTool('select');
      commitNow(); markDirty(); refreshUI();
      return;
    }
    var b = obj.getBoundingRect(true);
    if (b.width < 2 && b.height < 2) {
      S.canvas.remove(obj);
      S.canvas.requestRenderAll();
      setTool('select');
      return;
    }
    setTool('select');
    S.canvas.setActiveObject(obj);
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
  }

  function cancelDrawing() {
    if (S.drawing && S.drawing.obj) S.canvas.remove(S.drawing.obj);
    S.drawing = null;
    S.canvas.requestRenderAll();
  }

  function polyPoints(n, star, radius) {
    n = Math.max(3, Math.min(60, n || 6));
    var pts = [], R = radius, r = radius * 0.46;
    for (var i = 0; i < n * (star ? 2 : 1); i++) {
      var ang = -Math.PI / 2 + i * Math.PI * 2 / (n * (star ? 2 : 1));
      var rad = star && i % 2 ? r : R;
      pts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
    }
    return pts;
  }

  function polyDims(pts) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function setPolyScale(obj, left, top, w, h) {
    var d = polyDims(obj.points);
    obj.set({ left: left, top: top, scaleX: w / d.w, scaleY: h / d.h });
    obj.setCoords();
  }

  /* ───────────── 文字 ───────────── */
  function createTextAt(p) {
    var ab = activeArtboard();
    var h = ab ? ab.height : 2000;
    var fs = LS.round(LS.clamp(h * 0.045, 6, 400), 1);
    var w = ab ? Math.min(ab.width * 0.68, 760) : 700;
    var t = new fabric.Textbox('双击编辑文字', {
      left: p.x, top: p.y, width: w, fontSize: fs,
      fontFamily: S.style.fontFamily || 'PingFang SC',
      fill: S.style.textFill || '#0f172a',
      fontWeight: '400', lineHeight: 1.25, charSpacing: 0,
      textAlign: 'left', splitByGrapheme: true,
      lsName: '文字',
      editingBorderColor: '#2457f5', cursorColor: '#2457f5'
    });
    S.canvas.add(t);
    setTool('select');
    S.canvas.setActiveObject(t);
    t.enterEditing();
    t.selectAll();
    commitNow(); markDirty(); refreshUI();
  }

  function textName(t) {
    var s = String(t.text || '').replace(/\s+/g, ' ').trim();
    return s ? (s.length > 16 ? s.slice(0, 16) + '…' : s) : '文字';
  }

  function applyTextWrap(t) {
    if (!t || !t.text) return;
    var cjk = /[\u3000-\u9fff\uff00-\uffef]/.test(t.text);
    if (t.splitByGrapheme !== cjk) {
      t.set('splitByGrapheme', cjk);
      if (t.initDimensions) t.initDimensions();
      t.setCoords();
    }
  }

  /* ───────────── 钢笔 ───────────── */
  function penClick(p, e) {
    if (e.detail > 1) { finishPen(false); return; }
    if (!S.pen) S.pen = { points: [], cursor: null };
    var sp = snapPoint(p, null);
    if (S.pen.points.length >= 3) {
      var f = S.pen.points[0];
      var fsp = docToScreen(f.x, f.y), csp = docToScreen(sp.x, sp.y);
      if (Math.hypot(fsp.x - csp.x, fsp.y - csp.y) < 10) { finishPen(true); return; }
    }
    S.pen.points.push(sp);
    S.pen.cursor = sp;
    S.canvas.requestRenderAll();
  }

  function finishPen(closed) {
    var pen = S.pen;
    S.pen = null;
    if (!pen || pen.points.length < 2) {
      drawOverlay();
      S.canvas.requestRenderAll();
      return;
    }
    var cmds = [];
    pen.points.forEach(function (p, i) { cmds.push([i ? 'L' : 'M', p.x, p.y]); });
    if (closed) cmds.push(['Z']);
    var path = new fabric.Path(cmds, {
      fill: closed ? S.style.fill : null,
      stroke: S.style.stroke || '#2457f5',
      strokeWidth: S.style.strokeWidth || 2,
      strokeLineJoin: 'round', strokeLineCap: 'round',
    });
    S.canvas.add(path);
    S.canvas.setActiveObject(path);
    setTool('select');
    commitNow(); markDirty(); refreshUI();
  }

  function cancelPen() {
    S.pen = null;
    S.canvas.requestRenderAll();
  }

  /* ───────────── 参考线 ───────────── */
  function addGuide(axis, pos) {
    var g = { id: LS.uid('g'), axis: axis, pos: pos };
    S.guides.push(g);
    return g;
  }
  function guideNear(p) {
    var th = 5 / S.zoom;
    var found = null;
    S.guides.forEach(function (g) {
      var d = Math.abs((g.axis === 'x' ? p.x : p.y) - g.pos);
      if (d < th && (!found || d < found.d)) found = { g: g, d: d };
    });
    return found ? found.g : null;
  }
  function startGuideDrag(guide, startEvent, isNew) {
    S.dragGuide = { guide: guide, isNew: !!isNew, remove: false };
    S.selectedGuide = guide.id;
    var move = function (ev) {
      var dg = S.dragGuide;
      if (!dg) return;
      var p = screenToDoc(ev.clientX, ev.clientY);
      var r = S.canvas.upperCanvasEl.getBoundingClientRect();
      var overRuler = guide.axis === 'x' ? (ev.clientY < r.top + 4) : (ev.clientX < r.left + 4);
      dg.remove = overRuler;
      var val = guide.axis === 'x' ? p.x : p.y;
      if (ev.shiftKey) val = Math.round(val);
      else val = Math.round(val * 2) / 2;
      if (S.snap && !ev.altKey) {
        var t = snapTargets(null);
        var arr = guide.axis === 'x' ? t.xs : t.ys;
        var n = nearest(arr, val, 7 / S.zoom);
        if (n != null) val = n;
      }
      guide.pos = val;
      S.canvas.requestRenderAll();
    };
    var up = function (ev) {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      var dg = S.dragGuide;
      S.dragGuide = null;
      if (!dg) return;
      var r = S.canvas.upperCanvasEl.getBoundingClientRect();
      if (ev.clientY < r.top + 4 || ev.clientX < r.left + 4 || dg.remove) {
        S.guides = S.guides.filter(function (g) { return g.id !== dg.guide.id; });
        if (S.selectedGuide === dg.guide.id) S.selectedGuide = null;
      } else if (dg.isNew) {
        // 新参考线已在数组里
      }
      commitNow(); markDirty(); refreshUI();
      S.canvas.requestRenderAll();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  function deleteSelectedGuide() {
    if (!S.selectedGuide) return;
    S.guides = S.guides.filter(function (g) { return g.id !== S.selectedGuide; });
    S.selectedGuide = null;
    commitNow(); markDirty(); refreshUI();
    S.canvas.requestRenderAll();
  }
  function clearGuides() {
    if (!S.guides.length) return;
    S.guides = [];
    S.selectedGuide = null;
    commitNow(); markDirty(); refreshUI();
    S.canvas.requestRenderAll();
  }

  /* ───────────── 对象操作 ───────────── */
  function nameFor(obj) {
    var base = {
      rect: '矩形', ellipse: '椭圆', circle: '圆形', polygon: '多边形', line: '直线',
      path: '路径', textbox: '文字', text: '文字', 'i-text': '文字', image: '图片', group: '编组', triangle: '三角形'
    }[obj.type] || '对象';
    if (obj.type === 'textbox' || obj.type === 'text') return textName(obj);
    var n = 1;
    objects().forEach(function (o) { if (o !== obj && o.lsName && o.lsName.indexOf(base) === 0) n++; });
    return base + ' ' + n;
  }

  function boardLockedFor(obj) {
    if (!obj || obj.lsArtboard || !S.canvas) return false;
    var b = obj.getBoundingRect(true);
    return artboards().some(function (ab) {
      if (!ab.lsBoardLocked) return false;
      var x1 = Math.max(b.left, ab.left);
      var y1 = Math.max(b.top, ab.top);
      var x2 = Math.min(b.left + b.width, ab.left + ab.width);
      var y2 = Math.min(b.top + b.height, ab.top + ab.height);
      return x2 > x1 && y2 > y1;
    });
  }

  function applyLock(obj) {
    if (obj.lsArtboard) {
      obj.set({ selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true });
      return;
    }
    var locked = !!obj.lsLocked || boardLockedFor(obj);
    obj.set({
      selectable: !locked, evented: !locked,
      lockMovementX: locked, lockMovementY: locked,
      lockRotation: locked, lockScalingX: locked, lockScalingY: locked,
      hasControls: !locked, hoverCursor: locked ? 'default' : 'move'
    });
  }
  function applyAllLocks() {
    S.canvas.getObjects().forEach(applyLock);
  }

  function toggleArtboardLock(id) {
    var ab = null;
    artboards().forEach(function (a) { if (a.lsArtboardId === id) ab = a; });
    if (!ab) return false;
    ab.lsBoardLocked = !ab.lsBoardLocked;
    if (ab.lsBoardLocked) {
      S.canvas.discardActiveObject();
      S.activeArtboardId = id;
    }
    applyAllLocks();
    S.canvas.requestRenderAll();
    drawOverlay();
    commitNow();
    markDirty();
    refreshUI();
    LS.toast(ab.lsBoardLocked ? '画板已锁定：图层不可选中、移动或修改' : '画板已解锁，可以继续编辑', ab.lsBoardLocked ? 'ok' : 'ok', 3200);
    return ab.lsBoardLocked;
  }

  function deleteSelection() {
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) return;
    S.groupBusy = true;
    objs.forEach(function (o) { S.canvas.remove(o); });
    S.canvas.discardActiveObject();
    S.groupBusy = false;
    commitNow(); markDirty(); refreshUI();
    S.canvas.requestRenderAll();
  }

  function serialize(objs) {
    return objs.map(function (o) { return o.toObject(HIST_PROPS); });
  }
  function copySelection() {
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) return false;
    S.clipboard = serialize(objs);
    LS.toast('已复制 ' + objs.length + ' 个对象');
    return true;
  }
  function pasteObjects(data, offset) {
    if (!data || !data.length) return;
    fabric.util.enlivenObjects(data, function (objs) {
      var off = offset == null ? 10 : offset;
      S.groupBusy = true;
      objs.forEach(function (o) {
        o.set({ left: (o.left || 0) + off, top: (o.top || 0) + off, lsLocked: false });
        applyLock(o);
        S.canvas.add(o);
      });
      S.groupBusy = false;
      if (objs.length) {
        S.canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas: S.canvas }));
      }
      S.canvas.requestRenderAll();
      commitNow(); markDirty(); refreshUI();
    });
  }
  function duplicateSelection() {
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) return;
    pasteObjects(serialize(objs), 10);
  }

  function groupSelection() {
    var active = S.canvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') { LS.toast('先选中至少两个对象', 'warn'); return; }
    var objs = active.getObjects().slice();
    S.groupBusy = true;
    S.canvas.discardActiveObject();
    objs.forEach(function (o) { S.canvas.remove(o); });
    var g = new fabric.Group(objs, { lsName: '编组' });
    S.canvas.add(g);
    S.groupBusy = false;
    S.canvas.setActiveObject(g);
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
  }

  function ungroupSelection() {
    var g = S.canvas.getActiveObject();
    if (!g || g.type !== 'group') return;
    var items = g.getObjects().slice();
    var gIdx = S.canvas.getObjects().indexOf(g);
    S.groupBusy = true;
    g._restoreObjectsState();
    S.canvas.remove(g);
    items.forEach(function (o, i) {
      if (S.canvas.getObjects().indexOf(o) >= 0) S.canvas.remove(o);
      S.canvas.insertAt(o, Math.max(0, gIdx + i), false);
      applyLock(o);
    });
    S.groupBusy = false;
    S.canvas.setActiveObject(new fabric.ActiveSelection(items, { canvas: S.canvas }));
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
  }

  function arrange(dir) {
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) return;
    objs.forEach(function (o) {
      if (dir === 'front') S.canvas.bringToFront(o);
      else if (dir === 'back') S.canvas.sendToBack(o);
      else if (dir === 'forward') S.canvas.bringForward(o);
      else if (dir === 'backward') S.canvas.sendBackwards(o);
    });
    ensureArtboardsBottom();
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
  }

  function align(kind) {
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) return;
    var target;
    if (objs.length > 1) target = bboxOf(objs);
    else {
      var ab = activeArtboard();
      target = ab ? { left: ab.left, top: ab.top, width: ab.width, height: ab.height } : bboxOf(objs);
    }
    objs.forEach(function (o) {
      var b = o.getBoundingRect(true);
      var dx = 0, dy = 0;
      if (kind === 'left') dx = target.left - b.left;
      if (kind === 'centerX') dx = target.left + target.width / 2 - (b.left + b.width / 2);
      if (kind === 'right') dx = target.left + target.width - b.left - b.width;
      if (kind === 'top') dy = target.top - b.top;
      if (kind === 'centerY') dy = target.top + target.height / 2 - (b.top + b.height / 2);
      if (kind === 'bottom') dy = target.top + target.height - b.top - b.height;
      o.set({ left: o.left + dx, top: o.top + dy });
      o.setCoords();
    });
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
  }

  function flip(dir) {
    var objs = S.canvas.getActiveObjects();
    objs.forEach(function (o) {
      if (o.lsArtboard) return;
      if (dir === 'h') o.set('flipX', !o.flipX); else o.set('flipY', !o.flipY);
      o.setCoords();
    });
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
  }

  function selectAll() {
    var objs = objects().filter(function (o) { return o.selectable !== false && o.visible !== false; });
    if (!objs.length) return;
    S.canvas.discardActiveObject();
    S.canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas: S.canvas }));
    S.canvas.requestRenderAll();
    refreshUI();
  }

  function selectObjects(objs) {
    S.canvas.discardActiveObject();
    if (!objs || !objs.length) { S.canvas.requestRenderAll(); return; }
    if (objs.length === 1) S.canvas.setActiveObject(objs[0]);
    else S.canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas: S.canvas }));
    S.canvas.requestRenderAll();
    refreshUI();
  }

  /* 布尔运算 */
  function runBoolean(op) {
    var objs = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (objs.length < 2) { LS.toast('选中两个及以上的图形', 'warn'); return; }
    objs.sort(function (a, b) { return S.canvas.getObjects().indexOf(a) - S.canvas.getObjects().indexOf(b); });
    var bad = objs.find(function (o) { return !LS.bool.supports(o); });
    if (bad) { LS.toast('「' + (bad.lsName || bad.type) + '」不支持路径运算：请用形状或钢笔路径（文字、图片不能直接参与）', 'warn', 4200); return; }
    var res = LS.bool.run(objs, op);
    if (res.error) { LS.toast(res.error, 'err'); return; }
    var base = objs[0];
    var look = base;
    if (base.type === 'group' && base.getObjects && base.getObjects().length) {
      var kids = base.getObjects();
      look = kids.filter(function (k) { return !!k.fill; })[0] || kids[0];
    }
    var idx = S.canvas.getObjects().indexOf(base);
    var name = { unite: '合并图形', subtract: '相减图形', intersect: '交集图形', exclude: '排除图形' }[op] || '图形';
    var path = new fabric.Path(res.commands, {
      fill: look.fill, stroke: look.stroke, strokeWidth: look.strokeWidth,
      strokeDashArray: look.strokeDashArray, strokeLineCap: look.strokeLineCap,
      strokeLineJoin: look.strokeLineJoin, opacity: base.opacity,
      shadow: look.shadow, fillRule: 'evenodd', visible: base.visible !== false,
      lsName: name
    });
    S.groupBusy = true;
    objs.forEach(function (o) { S.canvas.remove(o); });
    S.canvas.add(path);
    var objsNow = S.canvas.getObjects();
    S.canvas.moveTo(path, Math.max(0, Math.min(idx, objsNow.length - 1)));
    ensureArtboardsBottom();
    S.groupBusy = false;
    S.canvas.setActiveObject(path);
    S.canvas.requestRenderAll();
    commitNow(); markDirty(); refreshUI();
    LS.toast('已' + ({ unite: '合并', subtract: '相减', intersect: '取交集', exclude: '排除重叠' }[op]));
  }

  /* 文字/图形外观记忆 */
  function rememberStyle(patch) {
    Object.assign(S.style, patch || {});
  }

  /* ───────────── 键盘 ───────────── */
  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (!isActive()) return;
      var t = e.target;
      var mod = e.metaKey || e.ctrlKey;
      var k = e.key;
      if (LS.$$('.modal-layer:not(.hidden)').length) return;
      if (mod && (k === 's' || k === 'S')) {
        e.preventDefault();
        saveNow(false).then(function () { LS.toast('已保存到本地'); });
        return;
      }
      if (mod && (k === 'e' || k === 'E')) {
        e.preventDefault();
        if (LS.exporter) LS.exporter.openDialog();
        return;
      }
      if (mod && (k === '0' || k === '1' || k === '=' || k === '+' || k === '-' || k === '_')) {
        e.preventDefault();
        if (k === '0') { if (e.shiftKey) fitAllArtboards(); else fitArtboard(); }
        else if (k === '1') setZoom(1);
        else if (k === '-' || k === '_') setZoom(S.zoom / 1.25);
        else setZoom(S.zoom * 1.25);
        return;
      }
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      var act = S.canvas && S.canvas.getActiveObject();
      if (act && act.isEditing) {
        if (e.key === 'Escape') { act.exitEditing(); S.canvas.requestRenderAll(); }
        return;
      }
      if (k === ' ' && !mod) {
        if (!S.space) {
          S.space = true;
          S.canvas.upperCanvasEl.style.cursor = 'grab';
          S.canvas.defaultCursor = 'grab';
        }
        e.preventDefault();
        return;
      }

      if (mod) {
        if (k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        if (k.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
        if (k.toLowerCase() === 'c') { if (copySelection()) e.preventDefault(); return; }
        if (k.toLowerCase() === 'x') {
          if (copySelection()) { deleteSelection(); e.preventDefault(); }
          return;
        }
        if (k.toLowerCase() === 'v') { if (S.clipboard) { pasteObjects(S.clipboard, 10); e.preventDefault(); } return; }
        if (k.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
        if (k.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
        if (k === ']') { e.preventDefault(); arrange(e.shiftKey ? 'front' : 'forward'); return; }
        if (k === '[') { e.preventDefault(); arrange(e.shiftKey ? 'back' : 'backward'); return; }
        if (k.toLowerCase() === 'p' && e.shiftKey) { e.preventDefault(); togglePreview(); return; }
        return;
      }

      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        if (S.selectedGuide) deleteSelectedGuide(); else deleteSelection();
        return;
      }
      if (k === 'Enter' && S.pen) { e.preventDefault(); finishPen(false); return; }
      if (k === 'Escape') {
        if (S.pen) { cancelPen(); return; }
        if (S.drawing) { cancelDrawing(); return; }
        if (S.selectedGuide) { S.selectedGuide = null; S.canvas.requestRenderAll(); return; }
        S.canvas.discardActiveObject();
        S.canvas.requestRenderAll();
        refreshUI();
        return;
      }
      if (k.indexOf('Arrow') === 0) {
        var objs = S.canvas.getActiveObjects();
        if (!objs.length) return;
        e.preventDefault();
        var step = e.shiftKey ? 10 : 1;
        var dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        var dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        objs.forEach(function (o) {
          if (o.lsArtboard) return;
          o.set({ left: o.left + dx, top: o.top + dy });
          o.setCoords();
        });
        S.canvas.requestRenderAll();
        LS.props && LS.props.renderProps();
        clearTimeout(S.arrowTimer);
        S.arrowTimer = setTimeout(function () { commitNow(); markDirty(); }, 250);
        return;
      }
      var map = { v: 'select', a: 'artboard', r: 'rect', o: 'ellipse', p: 'polygon', l: 'line', n: 'pen', t: 'text', i: 'image', h: 'hand', z: 'zoom' };
      var tool = map[k.toLowerCase()];
      if (tool) {
        if (tool === 'image') { $('#file-image').click(); return; }
        setTool(tool);
        return;
      }
      if (k === '?' || k === '/') { showHelp(); return; }
    });

    document.addEventListener('keyup', function (e) {
      if (e.key === ' ') {
        S.space = false;
        if (S.canvas) {
          S.canvas.upperCanvasEl.style.cursor = '';
          S.canvas.defaultCursor = S.tool === 'hand' ? 'grab' : (S.tool === 'select' ? 'default' : 'crosshair');
        }
      }
    });
  }

  function showHelp() {
    var rows = [
      ['V / A', '选择 / 画板'], ['R / O / P / L', '矩形 / 椭圆 / 多边形 / 直线'], ['N / T', '钢笔 / 文字'],
      ['空格 + 拖动', '平移画布'], ['⌘ + 滚轮', '缩放'], ['⌘0 / ⌘1', '适应画板 / 100%'],
      ['⌘Z / ⇧⌘Z', '撤销 / 重做'], ['⌘C / ⌘V / ⌘D', '复制 / 粘贴 / 再制'], ['⌘G / ⇧⌘G', '编组 / 解组'],
      ['⌘] / ⌘[', '上移 / 下移一层'], ['方向键', '微移 1mm（⇧ 10mm）'], ['⌫', '删除'],
      ['⇧P', '预览裁切'], ['⌘E', '导出'], ['⌘S', '保存'],
      ['从标尺拖出', '新建参考线，拖回标尺删除']
    ];
    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      rows.map(function (r) { return '<tr><td style="padding:5px 0;color:#55657d;white-space:nowrap">' + LS.esc(r[1]) + '</td><td style="padding:5px 0 5px 16px;text-align:right"><kbd>' + LS.esc(r[0]) + '</kbd></td></tr>'; }).join('') +
      '</table>';
    var layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.innerHTML = '<div class="modal" style="width:540px"><header class="modal-head"><div><h2>快捷键</h2>' +
      '<p>Mac 用 ⌘，Windows 用 Ctrl</p></div><button class="icon-btn" data-close="x">' + LS.icon('close') + '</button></header>' +
      '<div class="modal-body" style="padding-bottom:18px">' + html + '</div></div>';
    document.body.appendChild(layer);
    layer.querySelector('[data-close]').onclick = function () { layer.remove(); };
    layer.onmousedown = function (e) { if (e.target === layer) layer.remove(); };
  }

  /* ───────────── 拖入 / 粘贴图片 ───────────── */
  function bindDnd() {
    var wrap = $('#canvas-wrap');
    ['dragenter', 'dragover'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        if (!isActive()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        wrap.classList.add('drag-over');
      });
    });
    wrap.addEventListener('dragleave', function () { wrap.classList.remove('drag-over'); });
    wrap.addEventListener('drop', function (e) {
      if (!isActive()) return;
      e.preventDefault();
      wrap.classList.remove('drag-over');
      var p = screenToDoc(e.clientX, e.clientY);
      var assetId = '';
      try { assetId = e.dataTransfer.getData('application/x-lbs-asset') || ''; } catch (err) {}
      if (assetId && LS.brand) {
        LS.brand.insertAssetById(assetId, p);
        setTool('select');
        return;
      }
      var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f) { return /^image\//.test(f.type) || /\.svg$/i.test(f.name); });
      files.forEach(function (f, i) { insertImageFile(f, { x: p.x + i * 30, y: p.y + i * 30 }); });
      if (files.length) setTool('select');
    });

    document.addEventListener('paste', function (e) {
      if (!isActive()) return;
      var act = S.canvas.getActiveObject();
      if (act && act.isEditing) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) {
            e.preventDefault();
            var ab = activeArtboard() || { left: 0, top: 0, width: 1000, height: 1000 };
            insertImageFile(f, { x: ab.left + ab.width / 2, y: ab.top + ab.height / 2 });
            return;
          }
        }
      }
    });

    $('#file-image').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      var ab = activeArtboard();
      var center = ab ? { x: ab.left + ab.width / 2, y: ab.top + ab.height / 2 } : { x: 0, y: 0 };
      files.forEach(function (f, i) { insertImageFile(f, { x: center.x + i * 40, y: center.y + i * 40 }); });
      e.target.value = '';
      if (files.length) setTool('select');
    });
  }

  function mimeFor(file) {
    var n = (file.name || '').toLowerCase();
    if (/\.svg$/.test(n)) return 'image/svg+xml';
    if (/\.png$/.test(n)) return 'image/png';
    if (/\.jpe?g$/.test(n)) return 'image/jpeg';
    if (/\.webp$/.test(n)) return 'image/webp';
    if (/\.gif$/.test(n)) return 'image/gif';
    return file.type || 'image/png';
  }

  function loadFabricImage(url, cb) {
    fabric.Image.fromURL(url, function (img) {
      if (img && img.width && img.height) { cb(img); return; }
      // 有些浏览器的 dataURL 类型不对，退回原生 Image 再试一次
      var el = new Image();
      el.onload = function () {
        var w = el.naturalWidth || 300, h = el.naturalHeight || 300;
        el.width = w; el.height = h;
        try {
          var im = new fabric.Image(el);
          im.set({ width: w, height: h });
          cb(im);
        } catch (e) { cb(null); }
      };
      el.onerror = function () { cb(null); };
      el.src = url;
    }, { crossOrigin: null });
  }

  function insertImageURL(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      loadFabricImage(url, function (img) {
        if (!img) { LS.toast('图片加载失败，换一张试试', 'err'); resolve(null); return; }
        var ab = activeArtboard();
        var maxW = opts.maxW || (ab ? ab.width * 0.6 : 800);
        var maxH = opts.maxH || (ab ? ab.height * 0.6 : 800);
        var iw = img.width || 300, ih = img.height || 300;
        var scale = Math.min(maxW / iw, maxH / ih);
        if (scale > 8) scale = 8;
        var px = opts.at ? opts.at.x : (ab ? ab.left + ab.width / 2 : 0);
        var py = opts.at ? opts.at.y : (ab ? ab.top + ab.height / 2 : 0);
        img.set({
          left: px - iw * scale / 2,
          top: py - ih * scale / 2,
          scaleX: scale, scaleY: scale,
          lsName: opts.name || '图片'
        });
        img.setCoords();
        S.canvas.add(img);
        if (opts.select !== false) S.canvas.setActiveObject(img);
        S.canvas.requestRenderAll();
        commitNow(); markDirty(); refreshUI();
        resolve(img);
      });
    });
  }

  function insertImageFile(file, at) {
    if (!file) return Promise.resolve(null);
    var mime = mimeFor(file);
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var url = String(reader.result || '');
        if (url.indexOf('data:') === 0 && mime) {
          url = url.replace(/^data:[^;]*;/, 'data:' + mime + ';');
        }
        insertImageURL(url, {
          name: (file.name || '图片').replace(/\.[^.]+$/, ''),
          at: at
        }).then(resolve);
      };
      reader.onerror = function () { LS.toast('读取图片失败', 'err'); resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  /* ───────────── 预览 / 导出入口 ───────────── */
  function togglePreview() {
    S.preview = !S.preview;
    $('#stage').classList.toggle('preview', S.preview);
    $('#btn-preview').classList.toggle('active', S.preview);
    if (S.preview) {
      S.canvas.discardActiveObject();
      S.canvas.selection = false;
      S.canvas.skipTargetFind = true;
    } else {
      setTool(S.tool);
    }
    S.canvas.requestRenderAll();
    LS.props && LS.props.renderAll();
  }

  /* ───────────── 面板刷新 ───────────── */
  function refreshUI() {
    if (!S.canvas) return;
    updateUndoUI();
    var ab = activeArtboard();
    var info = $('#ab-info');
    if (info) info.textContent = ab ? LS.fmtNum(ab.width) + ' × ' + LS.fmtNum(ab.height) + ' mm' : '—';
    var sel = S.canvas.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    var sinfo = $('#sel-info');
    if (sinfo) {
      if (S.selectedGuide) sinfo.textContent = '已选中参考线 · 拖动设置位置，⌫ 删除';
      else if (S.preview) sinfo.textContent = '预览中 · 画板外内容会被裁掉';
      else if (!sel.length) sinfo.textContent = ab ? '画板「' + (ab.lsName || '未命名') + '」· 未选择对象' : '未选择对象';
      else if (sel.length === 1) {
        var o = sel[0];
        sinfo.textContent = (o.lsName || '对象') + ' · ' + LS.fmtNum(o.getBoundingRect(true).width) + ' × ' + LS.fmtNum(o.getBoundingRect(true).height) + ' mm';
      } else sinfo.textContent = '已选择 ' + sel.length + ' 个对象';
    }
    if (LS.props) LS.props.renderAll();
    drawOverlay();
  }

  /* ───────────── 导出入口 ───────────── */
  function openExport() {
    if (LS.exporter) LS.exporter.openDialog();
  }

  /* ───────────── UI 事件 ───────────── */
  function bindUI() {
    $('#toolrail').addEventListener('click', function (e) {
      var b = e.target.closest('.tool[data-tool]');
      if (!b) return;
      var t = b.getAttribute('data-tool');
      if (t === 'image') { $('#file-image').click(); return; }
      setTool(t);
    });

    $('#btn-back').addEventListener('click', leave);
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);
    $('#btn-preview').addEventListener('click', togglePreview);
    $('#btn-export').addEventListener('click', openExport);
    $('#btn-zoom-in').addEventListener('click', function () { setZoom(S.zoom * 1.25); });
    $('#btn-zoom-out').addEventListener('click', function () { setZoom(S.zoom / 1.25); });
    $('#btn-fit').addEventListener('click', fitArtboard);
    $('#btn-snap').addEventListener('click', function () {
      S.snap = !S.snap;
      this.classList.toggle('on', S.snap);
      LS.toast(S.snap ? '吸附已开启' : '吸附已关闭');
    });
    $('#btn-snap').classList.toggle('on', S.snap);

    $('#zoom-label').addEventListener('click', function () {
      LS.prompt({ title: '缩放比例', label: '输入百分比（如 150），或输入 fit 适应画板', value: String(Math.round(S.zoom * 100)), okText: '应用' }).then(function (v) {
        if (!v) return;
        if (/fit/i.test(v)) { fitArtboard(); return; }
        var n = parseFloat(v);
        if (n > 0) setZoom(n / 100);
      });
    });

    $('#proj-name').addEventListener('change', function () {
      S.meta && (S.meta.name = this.value);
      this.title = this.value;
      document.title = (this.value || '未命名项目') + ' · 排版大师';
      markDirty();
    });
    $('#proj-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });

    $('#hint-close').addEventListener('click', function () { $('#stage-hint').style.display = 'none'; });
    $('#btn-help').addEventListener('click', showHelp);

    $('#btn-add-artboard').addEventListener('click', function () {
      var abs = artboards();
      var ab = activeArtboard();
      var w = ab ? ab.width : 1000, h = ab ? ab.height : 2000;
      var p = nextArtboardPos(w, h);
      addArtboard(p.x, p.y, w, h, '画板 ' + (abs.length + 1), ab ? ab.fill : '#ffffff');
      fitAllArtboards();
    });

    $('#btn-del-layer').addEventListener('click', function () {
      if (S.selectedGuide) deleteSelectedGuide(); else deleteSelection();
    });
    $('#btn-dup-layer').addEventListener('click', duplicateSelection);

    // 标尺拖参考线
    $('.ruler-top').addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var p = screenToDoc(e.clientX, e.clientY);
      var g = addGuide('x', Math.round(p.x));
      S.canvas.requestRenderAll();
      startGuideDrag(g, e, true);
    });
    $('.ruler-left').addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var p = screenToDoc(e.clientX, e.clientY);
      var g = addGuide('y', Math.round(p.y));
      S.canvas.requestRenderAll();
      startGuideDrag(g, e, true);
    });
    $('#ruler-corner').addEventListener('click', function () { fitArtboard(); });

    $('#file-font').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) LS.fonts.upload(f);
    });

    // 画板 tab 切换由 panels 处理
    LS.fonts.init();
  }

  /* ───────────── 公开 API ───────────── */
  LS.editor = {
    init: init,
    open: open,
    leave: leave,
    state: S,
    canvas: canvas,
    artboards: artboards,
    activeArtboard: activeArtboard,
    objects: objects,
    addArtboard: addArtboard,
    setActiveArtboard: setActiveArtboard,
    updateArtboard: updateArtboard,
    deleteArtboard: deleteArtboard,
    moveArtboardTo: moveArtboardTo,
    toggleArtboardLock: toggleArtboardLock,
    isBoardLocked: boardLockedFor,
    clipSelectionToArtboard: clipSelectionToArtboard,
    unclipSelection: unclipSelection,
    setTool: setTool,
    setZoom: setZoom,
    fitArtboard: fitArtboard,
    fitAllArtboards: fitAllArtboards,
    nextArtboardPos: nextArtboardPos,
    zoomAt: zoomAt,
    commit: commitNow,
    commitNow: commitNow,
    commitSoon: commitSoon,
    markDirty: markDirty,
    saveNow: saveNow,
    refreshUI: refreshUI,
    scheduleSave: scheduleSave,
    undo: undo,
    redo: redo,
    deleteSelection: deleteSelection,
    duplicateSelection: duplicateSelection,
    copySelection: copySelection,
    pasteObjects: pasteObjects,
    groupSelection: groupSelection,
    ungroupSelection: ungroupSelection,
    arrange: arrange,
    align: align,
    flip: flip,
    selectAll: selectAll,
    selectObjects: selectObjects,
    runBoolean: runBoolean,
    rememberStyle: rememberStyle,
    applyLock: applyLock,
    insertImageFile: insertImageFile,
    insertImageURL: insertImageURL,
    togglePreview: togglePreview,
    clearGuides: clearGuides,
    deleteSelectedGuide: deleteSelectedGuide,
    drawRulers: drawRulers,
    drawOverlay: drawOverlay,
    docToScreen: docToScreen,
    screenToDoc: screenToDoc,
    applyTextWrap: applyTextWrap,
    polyPoints: polyPoints,
    polyDims: polyDims,
    showHelp: showHelp,
    getTool: function () { return S.tool; },
    applyFont: function (family) {
      S.style.fontFamily = family;
      var objs = S.canvas ? S.canvas.getActiveObjects() : [];
      var changed = false;
      objs.forEach(function (o) {
        if (/text/.test(o.type)) { o.set('fontFamily', family); o.setCoords(); changed = true; }
      });
      if (changed) { S.canvas.requestRenderAll(); commitNow(); refreshUI(); }
    },
    setDpi: function (dpi) { S.dpi = dpi; markDirty(); }
  };

})(window.LS);
