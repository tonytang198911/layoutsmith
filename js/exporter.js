/* 导出：PNG / JPG / SVG / 打印 PDF */
(function (LS) {
  'use strict';

  var exp = { format: 'png', artboardId: null, dpi: 150 };
  var MAX_PIXELS = 80e6;

  function E() { return LS.editor; }

  function findAb(id) {
    var abs = E().artboards();
    return abs.filter(function (a) { return a.lsArtboardId === id; })[0] || abs[0];
  }

  function pxSize(ab, dpi) {
    return {
      w: Math.max(1, Math.round(ab.width / 25.4 * dpi)),
      h: Math.max(1, Math.round(ab.height / 25.4 * dpi))
    };
  }

  /* 把当前画布按画板范围栅格化，返回 canvas */
  function renderArtboardCanvas(ab, pxPerMM, opts) {
    opts = opts || {};
    var c = E().canvas();
    var zoom = c.getZoom();
    var vp = c.viewportTransform;
    var left = ab.left * zoom + vp[4];
    var top = ab.top * zoom + vp[5];
    var cw = ab.width * zoom;
    var ch = ab.height * zoom;
    var others = E().artboards().filter(function (a) { return a !== ab; });
    var savedVis = others.map(function (a) { return [a, a.visible]; });
    others.forEach(function (a) { a.visible = false; });
    var savedFill = ab.fill, savedShadow = ab.shadow;
    ab.set('shadow', null);
    if (opts.transparent) ab.set('fill', null);
    else if (opts.background) ab.set('fill', opts.background);
    var el;
    try {
      el = c.toCanvasElement(pxPerMM / zoom, { left: left, top: top, width: cw, height: ch });
    } finally {
      ab.set({ fill: savedFill, shadow: savedShadow });
      savedVis.forEach(function (p) { p[0].visible = p[1]; });
      c.requestRenderAll();
    }
    return el;
  }

  function renderArtboard(ab, pxPerMM, opts) {
    opts = opts || {};
    var el = renderArtboardCanvas(ab, pxPerMM, opts);
    var type = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return {
      data: el.toDataURL(type, opts.quality == null ? 1 : opts.quality),
      w: el.width, h: el.height
    };
  }

  /* 项目卡片缩略图：把画板放进 640×400 的浅灰底里，短边留白 */
  function thumb(ab) {
    var scale = Math.min(600 / ab.width, 340 / ab.height);
    var src = renderArtboardCanvas(ab, Math.max(scale, 0.01), { background: ab.fill ? null : '#ffffff' });
    var out = document.createElement('canvas');
    out.width = 640; out.height = 400;
    var ctx = out.getContext('2d');
    var w = src.width, h = src.height;
    ctx.fillStyle = '#e9eef7';
    ctx.fillRect(0, 0, 640, 400);
    // 背景：画板本身放大模糊，给卡片一点颜色
    try {
      var cover = Math.max(640 / w, 400 / h);
      ctx.save();
      ctx.filter = 'blur(30px) saturate(1.15)';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(src, (640 - w * cover) / 2, (400 - h * cover) / 2, w * cover, h * cover);
      ctx.restore();
      ctx.fillStyle = 'rgba(245,247,251,.42)';
      ctx.fillRect(0, 0, 640, 400);
    } catch (e) {}
    var x = Math.round((640 - w) / 2), y = Math.round((400 - h) / 2);
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.drawImage(src, x, y);
    return out.toDataURL('image/jpeg', 0.84);
  }

  /* SVG 字符串；隐藏其他画板 */
  function artboardSVG(ab, transparent) {
    var c = E().canvas();
    var saved = [];
    E().artboards().forEach(function (a) {
      if (a !== ab || transparent) {
        saved.push([a, a.excludeFromExport]);
        a.excludeFromExport = true;
      }
    });
    var savedShadow = ab.shadow;
    ab.set('shadow', null);
    var svg;
    try {
      svg = c.toSVG({
        viewBox: { x: ab.left, y: ab.top, width: ab.width, height: ab.height },
        width: ab.width + 'mm',
        height: ab.height + 'mm',
        suppressPreamble: true
      });
    } finally {
      ab.set('shadow', savedShadow);
      saved.forEach(function (p) { p[0].excludeFromExport = p[1]; });
      c.requestRenderAll();
    }
    return svg;
  }

  /* ───────── 弹窗 ───────── */
  function openDialog() {
    var abs = E().artboards();
    if (!abs.length) { LS.toast('先新建一个画板', 'warn'); return; }
    var active = E().activeArtboard() || abs[0];
    exp.artboardId = active.lsArtboardId;
    exp.dpi = E().state.dpi || 150;
    var sel = LS.$('#ex-artboard');
    sel.innerHTML = abs.map(function (a) {
      return '<option value="' + a.lsArtboardId + '">' + LS.esc(a.lsName || '画板') + ' · ' + LS.fmtNum(a.width) + ' × ' + LS.fmtNum(a.height) + ' mm</option>';
    }).join('');
    sel.value = exp.artboardId;
    LS.$('#ex-dpi').value = String(exp.dpi);
    var projectName = (LS.$('#proj-name') && LS.$('#proj-name').value) || '画板';
    LS.$('#ex-name').value = LS.safeName(projectName + ' - ' + (active.lsName || '画板'));
    updateUI();
    LS.openModal('modal-export');
  }

  function fmtSize(ab) {
    var s = pxSize(ab, exp.dpi);
    return s.w + ' × ' + s.h + ' px';
  }

  function updateUI() {
    var ab = findAb(exp.artboardId);
    if (!ab) return;
    LS.$$('#ex-format button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-fmt') === exp.format);
    });
    var raster = exp.format === 'png' || exp.format === 'jpg';
    LS.$('#ex-raster-row').classList.toggle('hidden', !raster);
    LS.$('#ex-jpg-row').classList.toggle('hidden', exp.format !== 'jpg');
    LS.$('#ex-transparent-row').classList.toggle('hidden', exp.format === 'jpg' || exp.format === 'pdf');
    LS.$('#ex-size').value = raster ? fmtSize(ab) : (LS.fmtNum(ab.width) + ' × ' + LS.fmtNum(ab.height) + ' mm');
    var note = LS.$('#ex-note');
    var s = pxSize(ab, exp.dpi);
    var mp = (s.w * s.h / 1e6);
    if (exp.format === 'png') {
      var mpText = mp >= 100 ? (mp / 100).toFixed(1) + ' 亿' : mp.toFixed(0) + ' 百万';
      note.innerHTML = mp > 60
        ? '<b style="color:#b7791f">这张图约 ' + mpText + '像素，浏览器可能内存不足。</b> 建议把 DPI 调到 72–100，或改用 SVG / PDF 交给印刷厂。'
        : 'PNG 无损位图，带透明通道。画板外的内容会被裁掉。';
    } else if (exp.format === 'jpg') {
      note.textContent = 'JPG 有损压缩，固定白底，适合微信/邮件预览。';
    } else if (exp.format === 'svg') {
      note.textContent = '矢量导出，按 1:1 毫米尺寸，文字仍是文字。印刷厂需要装同款字体，或改用 PDF / 高 DPI PNG。';
    } else {
      note.textContent = '会打开打印窗口：目标选择「存储为 PDF」，纸张已按实物尺寸 ' + LS.fmtNum(ab.width) + ' × ' + LS.fmtNum(ab.height) + ' mm 设置。';
    }
    var base = LS.$('#ex-name').value.replace(/\.(png|jpg|jpeg|svg|pdf)$/i, '');
    LS.$('#ex-name').dataset.base = base;
  }

  function ensureBase() {
    var inp = LS.$('#ex-name');
    if (!inp.dataset.base) {
      var v = inp.value.replace(/\.(png|jpg|jpeg|svg|pdf)$/i, '');
      inp.dataset.base = v;
    }
    return inp.dataset.base;
  }

  /* ───────── 执行导出 ───────── */
  function run() {
    var ab = findAb(exp.artboardId);
    if (!ab) return;
    var fileBase = LS.safeName((LS.$('#ex-name').value || '画板').replace(/\.(png|jpg|jpeg|svg|pdf)$/i, ''));
    var transparent = LS.$('#ex-transparent').checked;

    if (exp.format === 'pdf') {
      doPDF(ab, transparent);
      return;
    }
    if (exp.format === 'svg') {
      var svg = artboardSVG(ab, transparent);
      LS.downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), fileBase + '.svg');
      LS.closeModal('modal-export');
      LS.toast('SVG 已导出');
      return;
    }

    var s = pxSize(ab, exp.dpi);
    if (s.w * s.h > MAX_PIXELS || s.w > 20000 || s.h > 20000) {
      LS.toast('像素太大（' + s.w + '×' + s.h + '），请降低 DPI 或改用 SVG / PDF', 'err', 5000);
      return;
    }
    LS.closeModal('modal-export');
    LS.toast('正在生成 ' + s.w + '×' + s.h + ' 图片…');
    setTimeout(function () {
      try {
        var res = renderArtboard(ab, exp.dpi / 25.4, {
          format: exp.format === 'jpg' ? 'jpeg' : 'png',
          quality: exp.format === 'jpg' ? LS.num(LS.$('#ex-quality').value, 92) / 100 : 1,
          transparent: exp.format === 'png' && transparent,
          background: exp.format === 'jpg' ? '#ffffff' : null
        });
        var ext = exp.format === 'jpg' ? '.jpg' : '.png';
        var blob = LS.dataURLToBlob(res.data);
        if (blob) LS.downloadBlob(blob, fileBase + ext);
        else LS.download(res.data, fileBase + ext);
        LS.toast('已导出 ' + fileBase + ext);
      } catch (e) {
        LS.toast('导出失败：' + (e && e.message || '图片太大'), 'err', 4500);
      }
    }, 60);
  }

  function doPDF(ab, transparent) {
    var svg = artboardSVG(ab, transparent);
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + LS.esc(ab.lsName || '画板') + '</title>' +
      '<style>@page{size:' + ab.width + 'mm ' + ab.height + 'mm;margin:0}html,body{margin:0;padding:0;background:#fff}' +
      'svg{display:block;width:' + ab.width + 'mm;height:' + ab.height + 'mm}</style></head><body>' + svg + '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { LS.toast('打印窗口被拦截，请允许弹出窗口', 'err'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    LS.closeModal('modal-export');
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (e) {}
    }, 700);
    LS.toast('在打印窗口选择「存储为 PDF」');
  }

  function init() {
    LS.$$('#ex-format button').forEach(function (b) {
      b.addEventListener('click', function () {
        exp.format = b.getAttribute('data-fmt');
        updateUI();
      });
    });
    LS.$('#ex-artboard').addEventListener('change', function () {
      exp.artboardId = this.value;
      updateUI();
    });
    LS.$('#ex-dpi').addEventListener('change', function () {
      exp.dpi = LS.num(this.value, 150);
      updateUI();
    });
    LS.$('#ex-quality').addEventListener('input', function () {
      LS.$('#ex-q-val').textContent = this.value;
    });
    LS.$('#ex-transparent').addEventListener('change', updateUI);
    LS.$('#ex-name').addEventListener('input', function () { this.dataset.base = this.value; });
    LS.$('#ex-run').addEventListener('click', run);
  }

  LS.exporter = {
    init: init,
    openDialog: openDialog,
    renderArtboard: renderArtboard,
    renderArtboardCanvas: renderArtboardCanvas,
    thumb: thumb,
    artboardSVG: artboardSVG,
    pxSize: pxSize
  };
})(window.LS);
