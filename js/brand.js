/* 品牌库：素材、模板、品牌色与字体 */
(function (LS) {
  'use strict';

  var HIST_PROPS = ['lsName', 'lsLocked', 'lsArtboard', 'lsArtboardId', 'lsSides', 'lsStar'];
  var CATS = [
    { id: 'logo', label: 'Logo' },
    { id: 'graphic', label: '图形' },
    { id: 'photo', label: '图片' },
    { id: 'other', label: '其他' }
  ];
  var S = {
    kit: null, assets: [], templates: [],
    loaded: false, filter: 'all', tab: 'assets', category: 'graphic',
    saveTimer: null
  };

  function $(s) { return LS.$(s); }
  function $$(s) { return LS.$$(s); }
  function esc(v) { return LS.esc(v); }
  function uid(p) { return LS.uid(p || 'id'); }
  function catLabel(id) {
    var c = CATS.filter(function (x) { return x.id === id; })[0];
    return c ? c.label : '其他';
  }
  function fmtBytes(n) {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function hasEditor() {
    return !!(LS.editor && LS.editor.state.canvas && $('#screen-editor').classList.contains('active') && LS.editor.activeArtboard());
  }

  /* ═════════ 数据 ═════════ */
  function defaultKit() {
    return {
      id: 'brand',
      name: '我的品牌',
      colors: [
        { id: uid('c'), name: '主色', hex: '#2457f5' },
        { id: uid('c'), name: '辅助色', hex: '#0f8f8e' },
        { id: uid('c'), name: '墨色', hex: '#0f172a' },
        { id: uid('c'), name: '暖色', hex: '#ffb347' },
        { id: uid('c'), name: '浅底', hex: '#f5f7fb' }
      ],
      fonts: ['PingFang SC', 'Helvetica Neue'],
      updatedAt: Date.now()
    };
  }

  function init() {
    bind();
    load();
  }

  function load() {
    return Promise.all([
      LS.store.brandGet(),
      LS.store.assetsList(),
      LS.store.templatesList()
    ]).then(function (res) {
      S.kit = res[0] || defaultKit();
      if (!res[0]) LS.store.brandSave(S.kit);
      S.assets = (res[1] || []).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      S.templates = (res[2] || []).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      S.loaded = true;
      renderAll();
      if (LS.editor && LS.editor.state.canvas) LS.props && LS.props.renderAll();
    }).catch(function () {
      S.kit = defaultKit();
      S.loaded = true;
      renderAll();
    });
  }

  function saveKit() {
    if (!S.kit) return Promise.resolve();
    S.kit.updatedAt = Date.now();
    return LS.store.brandSave(S.kit);
  }
  function touchKit() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () {
      saveKit();
      renderTab();
      updateMeta();
      if (LS.editor && LS.editor.state.canvas) LS.props && LS.props.renderAll();
    }, 260);
  }

  /* ═════════ 打开 / 渲染 ═════════ */
  function open(tab) {
    if (!S.loaded) { load().then(function () { open(tab); }); return; }
    if (tab) S.tab = tab;
    renderModal();
    LS.openModal('modal-brand');
    setTimeout(function () { $('#brand-meta').textContent = ''; updateMeta(); }, 30);
  }

  function renderAll() {
    renderTab();
    renderModal();
    updateMeta();
  }

  function updateMeta() {
    var el = $('#brand-meta');
    if (el) el.textContent = S.assets.length + ' 个素材 · ' + S.templates.length + ' 个模板';
  }

  function updateModalTabs() {
    $$('#brand-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-btab') === S.tab);
    });
    ['assets', 'templates', 'identity'].forEach(function (name) {
      var pane = $('#brand-pane-' + name);
      if (pane) pane.classList.toggle('hidden', name !== S.tab);
    });
  }

  function renderTab() {
    var el = $('#brand-tab-body');
    if (!el) return;
    if (!S.loaded || !S.kit) {
      el.innerHTML = '<div class="brand-tab-empty">正在读取品牌库…</div>';
      return;
    }
    var kit = S.kit;
    var assets = S.assets.slice();
    var tpls = S.templates.slice(0, 3);
    var colors = kit.colors || [];
    var fonts = kit.fonts || [];

    var html = '<div class="brand-tab-head"><b>' + esc(kit.name || '我的品牌') + '</b>' +
      '<button class="icon-btn" data-brand-act="manage" title="管理品牌库">' + LS.icon('settings') + '</button></div>';

    html += '<div class="brand-sec"><div class="brand-sec-head"><span class="brand-sec-title">品牌素材' +
      (S.assets.length ? ' · ' + S.assets.length : '') + '</span>' +
      '<span class="mini"><button class="icon-btn" data-brand-act="upload" title="上传素材">' + LS.icon('plus') + '</button>' +
      '<button class="link-btn" data-brand-act="manage">管理</button></span></div>';
    if (assets.length) {
      html += '<div class="brand-mini-grid">' + assets.map(function (a) {
        return '<button class="brand-mini-asset" draggable="true" data-asset-id="' + a.id + '" title="插入「' + esc(a.name) + '」">' +
          '<span class="thumb"><img src="' + (a.thumb || a.data) + '" alt=""></span>' +
          '<span class="nm">' + esc(a.name) + '</span></button>';
      }).join('') + '</div>';
    } else {
      html += '<div class="brand-tab-empty">还没有品牌素材。<button class="link-btn" data-brand-act="upload">上传 Logo / 图形</button></div>';
    }
    html += '</div>';

    html += '<div class="brand-sec"><div class="brand-sec-head"><span class="brand-sec-title">品牌模板</span>' +
      '<span class="mini"><button class="link-btn" data-brand-act="save-template">存为模板</button></span></div>';
    if (tpls.length) {
      html += tpls.map(function (t) {
        return '<button class="brand-mini-tpl" data-template-id="' + t.id + '" title="应用「' + esc(t.name) + '」">' +
          '<span class="thumb" style="background:' + (t.bg || '#eef2f8') + '"><img src="' + (t.thumb || '') + '" alt=""></span>' +
          '<span class="mt"><b>' + esc(t.name) + '</b><span>' + LS.fmtNum(t.w, 0) + ' × ' + LS.fmtNum(t.h, 0) + ' mm</span></span>' +
          '<span class="go">应用</span></button>';
      }).join('');
      if (S.templates.length > 3) {
        html += '<button class="link-btn" data-brand-act="manage-templates" style="margin-top:2px">查看全部 ' + S.templates.length + ' 个 →</button>';
      }
    } else {
      html += '<div class="brand-tab-empty">还没有模板。排好一个画板后点「存为模板」，以后做系列稿可以直接套。</div>';
    }
    html += '</div>';

    html += '<div class="brand-sec"><div class="brand-sec-head"><span class="brand-sec-title">品牌色</span>' +
      '<button class="link-btn" data-brand-act="manage-identity">管理</button></div>' +
      '<div class="brand-colors">' + colors.map(function (c) {
        return '<button class="brand-swatch" data-brand-color="' + c.hex + '" style="background:' + c.hex + '" title="' + esc(c.name || c.hex) + '"></button>';
      }).join('') + (colors.length ? '' : '<span class="brand-tab-empty">还没有品牌色</span>') + '</div></div>';

    html += '<div class="brand-sec"><div class="brand-sec-head"><span class="brand-sec-title">品牌字体</span>' +
      '<button class="link-btn" data-brand-act="manage-identity">管理</button></div>' +
      '<div class="brand-font-chips">' + fonts.slice(0, 5).map(function (f) {
        return '<button class="brand-font-chip" data-brand-font="' + esc(f) + '" title="应用到选中文字">' + esc(f) + '</button>';
      }).join('') + (fonts.length ? '' : '<span class="brand-tab-empty">还没有品牌字体</span>') + '</div></div>';

    el.innerHTML = html;
  }

  function renderModal() {
    if (!S.kit) return;
    updateModalTabs();
    updateMeta();
    renderAssets();
    renderTemplates();
    renderIdentity();
  }

  function renderAssets() {
    var f = $('#brand-filters');
    if (!f) return;
    var counts = { all: S.assets.length };
    CATS.forEach(function (c) { counts[c.id] = 0; });
    S.assets.forEach(function (a) { counts[a.category] = (counts[a.category] || 0) + 1; });
    f.innerHTML = [{ id: 'all', label: '全部' }].concat(CATS).map(function (c) {
      return '<button data-filter="' + c.id + '" class="' + (S.filter === c.id ? 'active' : '') + '">' +
        c.label + ' <span style="color:var(--faint);font-size:12px">' + (counts[c.id] || 0) + '</span></button>';
    }).join('');

    var list = S.assets.filter(function (a) { return S.filter === 'all' || a.category === S.filter; });
    var grid = $('#brand-grid');
    var empty = $('#brand-assets-empty');
    if (grid) {
      grid.innerHTML = list.map(function (a) {
        return '<div class="brand-card">' +
          '<div class="brand-card-thumb"><img src="' + (a.thumb || a.data) + '" alt=""></div>' +
          '<div class="brand-card-body"><div class="brand-card-name" title="' + esc(a.name) + '">' + esc(a.name) + '</div>' +
          '<div class="brand-card-meta">' + catLabel(a.category) + ' · ' + LS.fmtNum(a.w, 0) + '×' + LS.fmtNum(a.h, 0) + ' · ' + fmtBytes(a.size) + '</div></div>' +
          '<div class="brand-card-actions"><button class="btn btn-sm" data-ba="insert" data-id="' + a.id + '">插入画板</button>' +
          '<button class="icon-btn tiny" data-ba="delete" data-id="' + a.id + '" title="删除">' + LS.icon('trash') + '</button></div>' +
          '</div>';
      }).join('');
    }
    if (empty) empty.classList.toggle('hidden', list.length > 0);
    if (grid) grid.classList.toggle('hidden', list.length === 0);
  }

  function renderTemplates() {
    var grid = $('#brand-tpl-grid');
    var empty = $('#brand-tpl-empty');
    if (grid) {
      grid.innerHTML = S.templates.map(function (t) {
        var canApply = hasEditor();
        return '<div class="brand-tpl-card">' +
          '<div class="brand-tpl-thumb" style="aspect-ratio:' + Math.max(0.66, Math.min(1.6, (t.w || 1) / (t.h || 1))) + ';background:' + (t.bg || '#eef2f8') + '"><img src="' + (t.thumb || '') + '" alt=""></div>' +
          '<div class="brand-tpl-info"><div style="min-width:0"><div class="brand-tpl-name">' + esc(t.name) + '</div>' +
          '<div class="brand-tpl-size">' + LS.fmtNum(t.w, 0) + ' × ' + LS.fmtNum(t.h, 0) + ' mm</div></div></div>' +
          '<div class="brand-tpl-actions">' +
          '<button class="btn btn-sm" data-bt="apply" data-id="' + t.id + '" ' + (canApply ? '' : 'disabled title="先打开一个项目"') + '>应用</button>' +
          '<button class="btn btn-sm" data-bt="new" data-id="' + t.id + '">新建</button>' +
          '<button class="icon-btn" data-bt="more" data-id="' + t.id + '" title="更多">' + LS.icon('more') + '</button>' +
          '</div></div>';
      }).join('');
    }
    if (empty) empty.classList.toggle('hidden', S.templates.length > 0);
    if (grid) grid.classList.toggle('hidden', S.templates.length === 0);
    var saveBtn = $('#brand-save-template');
    if (saveBtn) {
      saveBtn.disabled = !hasEditor();
      saveBtn.title = hasEditor() ? '' : '先打开一个项目';
    }
    var emptySave = $('#brand-tpl-empty-save');
    if (emptySave) {
      emptySave.disabled = !hasEditor();
      emptySave.title = hasEditor() ? '' : '先打开一个项目';
    }
  }

  function renderIdentity() {
    var el = $('#brand-identity');
    if (!el || !S.kit) return;
    var kit = S.kit;
    var colors = kit.colors || [];
    var fonts = kit.fonts || [];
    el.innerHTML =
      '<div>' +
        '<div class="brand-panel"><h3>品牌</h3><p class="sub">显示在左侧品牌页签顶部。</p>' +
        '<div class="brand-field"><input class="input" id="brand-name-input" value="' + esc(kit.name || '') + '" maxlength="60" autocomplete="off">' +
        '<button class="btn btn-sm" id="brand-name-save">保存</button></div>' +
        '<p class="brand-identity-note">品牌库和项目分开保存。项目里插入的素材会变成普通图片，不依赖这里。</p></div>' +
        '<div class="brand-panel"><h3>品牌色</h3><p class="sub">会出现在右侧填充/描边色板和左侧品牌页签里。</p>' +
        '<div class="brand-color-list">' + colors.map(function (c) {
          return '<div class="brand-color-row">' +
            '<input type="color" data-bcolor-id="' + c.id + '" value="' + LS.toHex(c.hex, '#2457f5') + '" title="颜色">' +
            '<input class="input" data-bcolor-name="' + c.id + '" value="' + esc(c.name || '') + '" placeholder="颜色名称" maxlength="24">' +
            '<button class="icon-btn tiny" data-bcolor-del="' + c.id + '" title="删除">' + LS.icon('trash') + '</button>' +
            '</div>';
        }).join('') + '</div>' +
        '<button class="btn btn-sm btn-block" data-bcolor-add style="margin-top:9px">' + LS.icon('plus') + '添加品牌色</button></div>' +
      '</div>' +
      '<div>' +
        '<div class="brand-panel"><h3>品牌字体</h3><p class="sub">填本机已安装或已上传的字体名；点行尾的 T 应用到选中文字。</p>' +
        '<div class="brand-font-list">' + fonts.map(function (f) {
          return '<div class="brand-font-row"><span class="font-name" title="' + esc(f) + '">' + esc(f) + '</span>' +
            '<button class="icon-btn tiny" data-bfont-apply="' + esc(f) + '" title="应用到选中文字">' + LS.icon('type') + '</button>' +
            '<button class="icon-btn tiny" data-bfont-del="' + esc(f) + '" title="删除">' + LS.icon('trash') + '</button></div>';
        }).join('') + '</div>' +
        '<div class="brand-add-row"><input class="input" id="brand-font-input" placeholder="例如 PingFang SC" maxlength="60" autocomplete="off">' +
        '<button class="btn btn-sm" data-bfont-add>添加</button></div>' +
        '<p class="brand-identity-note">品牌字体不会打包进项目文件；换电脑后需要先安装或上传同款字体。</p></div>' +
        '<div class="brand-panel"><h3>模板怎么用</h3><p class="sub" style="margin-bottom:0">在左侧「品牌」里点模板会套到当前画板；在品牌库模板页可以「应用」到当前画板，或「新建」一个同尺寸项目。<br><br>保存模板会记录与当前画板相交的文字、图形和图片；画板外的多余对象不会带进来。</p></div>' +
      '</div>';
  }

  /* ═════════ 素材 ═════════ */
  function mimeFor(file) {
    var n = (file.name || '').toLowerCase();
    if (/\.svg$/.test(n)) return 'image/svg+xml';
    if (/\.png$/.test(n)) return 'image/png';
    if (/\.jpe?g$/.test(n)) return 'image/jpeg';
    if (/\.webp$/.test(n)) return 'image/webp';
    if (/\.gif$/.test(n)) return 'image/gif';
    return file.type || 'image/png';
  }

  function makeThumb(img, w, h) {
    var cw = 300, ch = 210, pad = 14;
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#f5f7fb';
    ctx.fillRect(0, 0, cw, ch);
    var s = Math.min((cw - pad * 2) / Math.max(1, w), (ch - pad * 2) / Math.max(1, h));
    var dw = Math.max(1, w * s), dh = Math.max(1, h * s);
    try { ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh); } catch (e) {}
    return cv.toDataURL('image/jpeg', 0.82);
  }

  function uploadFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return /^image\//.test(f.type) || /\.svg$/i.test(f.name);
    });
    if (!list.length) { LS.toast('只支持 PNG / JPG / WebP / SVG', 'warn'); return; }
    var cat = S.category || 'graphic';
    var jobs = list.map(function (file) {
      return new Promise(function (resolve) {
        if (file.size > 20 * 1024 * 1024) { LS.toast('「' + file.name + '」超过 20MB，跳过', 'warn'); resolve(null); return; }
        var mime = mimeFor(file);
        var reader = new FileReader();
        reader.onload = function () {
          var url = String(reader.result || '');
          if (url.indexOf('data:') === 0) url = url.replace(/^data:[^;]*;/, 'data:' + mime + ';');
          var img = new Image();
          img.onload = function () {
            var w = img.naturalWidth || 300, h = img.naturalHeight || 300;
            resolve({
              id: uid('asset'),
              name: (file.name || '素材').replace(/\.[^.]+$/, ''),
              category: cat,
              mime: mime,
              data: url,
              thumb: makeThumb(img, w, h),
              w: w, h: h,
              size: file.size,
              createdAt: Date.now()
            });
          };
          img.onerror = function () { LS.toast('「' + file.name + '」读取失败', 'err'); resolve(null); };
          img.src = url;
        };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(file);
      });
    });
    Promise.all(jobs).then(function (recs) {
      var valid = recs.filter(Boolean);
      if (!valid.length) return;
      Promise.all(valid.map(function (r) { return LS.store.assetAdd(r); })).then(function () {
        S.assets = valid.concat(S.assets);
        renderAll();
        LS.toast('已加入 ' + valid.length + ' 个品牌素材');
      });
    });
  }

  function insertAssetById(id, at) {
    var a = S.assets.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    insertAsset(a, at);
  }

  function insertAsset(a, at) {
    if (!hasEditor()) { LS.toast('先打开一个项目，再插入品牌素材', 'warn'); return; }
    var ab = LS.editor.activeArtboard();
    var ratio = a.category === 'photo' ? 0.6 : (a.category === 'logo' ? 0.32 : 0.42);
    LS.editor.insertImageURL(a.data, {
      name: a.name || '品牌素材',
      at: at || { x: ab.left + ab.width / 2, y: ab.top + ab.height / 2 },
      maxW: ab.width * ratio,
      maxH: ab.height * ratio
    });
  }

  function deleteAsset(id) {
    var a = S.assets.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    LS.confirm({ title: '删除品牌素材？', message: '「' + a.name + '」会从品牌库删除；已经插入项目里的复制品不受影响。', okText: '删除', danger: true }).then(function (ok) {
      if (!ok) return;
      LS.store.assetRemove(id).then(function () {
        S.assets = S.assets.filter(function (x) { return x.id !== id; });
        renderAll();
        LS.toast('已删除素材');
      });
    });
  }

  /* ═════════ 模板 ═════════ */
  function inArtboard(o, ab) {
    var b = o.getBoundingRect(true);
    return !(b.left > ab.left + ab.width || b.left + b.width < ab.left ||
      b.top > ab.top + ab.height || b.top + b.height < ab.top);
  }

  function serializeObjects(objs, ab) {
    return new Promise(function (resolve) {
      var out = [], pending = objs.length;
      if (!pending) return resolve([]);
      objs.forEach(function (o) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          if (--pending === 0) resolve(out);
        }
        try {
          o.clone(function (cl) {
            try {
              cl.set({ left: (cl.left || 0) - ab.left, top: (cl.top || 0) - ab.top });
              out.push(cl.toObject(HIST_PROPS));
            } catch (e) {}
            finish();
          }, HIST_PROPS);
        } catch (e) { finish(); }
      });
    });
  }

  function saveTemplatePrompt() {
    if (!hasEditor()) { LS.toast('先打开一个项目', 'warn'); return; }
    var ab = LS.editor.activeArtboard();
    var meta = LS.editor.state.meta || {};
    var def = (meta.name || '画板') + ' · ' + (ab.lsName || '画板');
    LS.prompt({ title: '保存为品牌模板', label: '模板名称', value: def, okText: '保存模板' }).then(function (name) {
      if (!name) return;
      saveCurrentTemplate(name);
    });
  }

  function saveCurrentTemplate(name) {
    if (!hasEditor()) return Promise.resolve(null);
    var ab = LS.editor.activeArtboard();
    var objs = LS.editor.objects().filter(function (o) { return inArtboard(o, ab); });
    LS.toast('正在保存模板…');
    return serializeObjects(objs, ab).then(function (objects) {
      var tpl = {
        id: uid('tpl'),
        name: name || (ab.lsName || '品牌模板'),
        w: Math.max(1, Math.round(ab.width)),
        h: Math.max(1, Math.round(ab.height)),
        bg: typeof ab.fill === 'string' ? ab.fill : null,
        objects: objects,
        thumb: '',
        createdAt: Date.now()
      };
      try {
        var px = Math.min(640 / ab.width, 800 / ab.height);
        var el = LS.exporter.renderArtboardCanvas(ab, px, { background: ab.fill ? null : '#ffffff' });
        tpl.thumb = el.toDataURL('image/jpeg', 0.88);
      } catch (e) {}
      return LS.store.templateAdd(tpl).then(function () {
        S.templates.unshift(tpl);
        renderAll();
        LS.toast('已保存模板「' + tpl.name + '」');
        return tpl;
      });
    });
  }

  function insertTemplateObjects(tpl, ab) {
    return new Promise(function (resolve) {
      try {
        fabric.util.enlivenObjects(tpl.objects || [], function (objs) {
        if (!objs || !objs.length) { resolve([]); return; }
        var tw = Math.max(1, +tpl.w || ab.width);
        var th = Math.max(1, +tpl.h || ab.height);
        var s = Math.min(ab.width / tw, ab.height / th);
        var x = ab.left + (ab.width - tw * s) / 2;
        var y = ab.top + (ab.height - th * s) / 2;
        var c = LS.editor.canvas();
        var g = new fabric.Group(objs, { left: x, top: y, scaleX: s, scaleY: s, lsName: '模板 · ' + tpl.name });
        c.add(g);
        g.setCoords();
        g._restoreObjectsState();
        c.remove(g);
        objs.forEach(function (o) {
          LS.editor.applyLock(o);
          c.add(o);
        });
        c.setActiveObject(new fabric.ActiveSelection(objs, { canvas: c }));
        c.requestRenderAll();
        resolve(objs);
        });
      } catch (e) { resolve([]); }
    });
  }

  function applyTemplate(tpl, opts) {
    opts = opts || {};
    if (!hasEditor()) { LS.toast('先打开一个项目', 'warn'); return Promise.resolve(); }
    var ab = LS.editor.activeArtboard();
    if (tpl.bg) LS.editor.updateArtboard(ab.lsArtboardId, { fill: tpl.bg });
    return insertTemplateObjects(tpl, ab).then(function (objs) {
      if (!objs.length) { LS.toast('模板是空的', 'warn'); return; }
      LS.editor.commitNow(); LS.editor.markDirty(); LS.editor.refreshUI();
      if (!opts.silent) {
        LS.closeModal('modal-brand');
        LS.toast('已应用模板「' + tpl.name + '」');
      }
    });
  }

  function applyTemplateById(id) {
    var t = S.templates.filter(function (x) { return x.id === id; })[0];
    if (t) applyTemplate(t);
  }

  function createFromTemplate(tpl) {
    if (!tpl) return;
    if (hasEditor() && LS.editor.state.dirty) LS.editor.saveNow(true);
    var meta = {
      id: uid('p'),
      name: tpl.name || '品牌模板',
      w: Math.max(1, Math.round(tpl.w)),
      h: Math.max(1, Math.round(tpl.h)),
      dpi: 150,
      bg: tpl.bg || null,
      transparent: !tpl.bg,
      thumb: tpl.thumb || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      artboardCount: 1
    };
    LS.store.save(meta, null).then(function () {
      $('#screen-home').classList.remove('active');
      $('#screen-editor').classList.add('active');
      document.title = meta.name + ' · 排版大师';
      LS.editor.open(meta, null);
      var ab = LS.editor.activeArtboard();
      if (ab) {
        if (tpl.bg) LS.editor.updateArtboard(ab.lsArtboardId, { fill: tpl.bg });
        insertTemplateObjects(tpl, ab).then(function (objs) {
          LS.editor.commitNow();
          LS.editor.fitArtboard();
          LS.editor.saveNow(true);
          try { history.replaceState(null, '', '#/p/' + meta.id); } catch (e) { location.hash = '#/p/' + meta.id; }
          LS.closeModal('modal-brand');
          LS.toast('已从模板新建项目「' + meta.name + '」');
        });
      } else {
        LS.closeModal('modal-brand');
      }
    });
  }

  function renameTemplate(id) {
    var t = S.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    LS.prompt({ title: '重命名模板', label: '模板名称', value: t.name }).then(function (name) {
      if (!name) return;
      t.name = name;
      LS.store.templateAdd(t).then(function () {
        renderAll();
        LS.toast('已重命名');
      });
    });
  }

  function deleteTemplate(id) {
    var t = S.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    LS.confirm({ title: '删除模板？', message: '「' + t.name + '」会从品牌库删除，已经用它创建的项目不受影响。', okText: '删除', danger: true }).then(function (ok) {
      if (!ok) return;
      LS.store.templateRemove(id).then(function () {
        S.templates = S.templates.filter(function (x) { return x.id !== id; });
        renderAll();
        LS.toast('已删除模板');
      });
    });
  }

  /* ═════════ 品牌色 / 字体 ═════════ */
  function getColors() { return (S.kit && S.kit.colors) ? S.kit.colors : []; }
  function getFonts() { return (S.kit && S.kit.fonts) ? S.kit.fonts : []; }

  function applyColor(hex) {
    if (!hasEditor()) { LS.toast('先打开一个项目', 'warn'); return; }
    var c = LS.editor.canvas();
    var objs = c.getActiveObjects().filter(function (o) { return !o.lsArtboard; });
    if (!objs.length) {
      LS.editor.rememberStyle({ fill: hex, textFill: hex });
      LS.toast('已设为新图形的默认颜色');
      return;
    }
    objs.forEach(function (o) {
      if (o.type === 'image' || o.type === 'group') return;
      o.set('fill', hex);
      o.dirty = true;
      o.setCoords();
    });
    c.requestRenderAll();
    LS.editor.rememberStyle({ fill: hex, textFill: hex });
    LS.editor.commitNow(); LS.editor.markDirty(); LS.editor.refreshUI();
    LS.toast('已应用品牌色');
  }

  function applyFont(family) {
    if (!hasEditor()) { LS.toast('先打开一个项目', 'warn'); return; }
    LS.editor.applyFont(family);
    LS.toast('字体已应用 / 已设为默认');
  }

  function addColor() {
    if (!S.kit.colors) S.kit.colors = [];
    S.kit.colors.push({ id: uid('c'), name: '品牌色 ' + (S.kit.colors.length + 1), hex: '#2457f5' });
    saveKit();
    renderIdentity();
    renderTab();
    if (LS.editor && LS.editor.state.canvas) LS.props && LS.props.renderAll();
  }

  function deleteColor(id) {
    S.kit.colors = (S.kit.colors || []).filter(function (c) { return c.id !== id; });
    saveKit();
    renderIdentity();
    renderTab();
    if (LS.editor && LS.editor.state.canvas) LS.props && LS.props.renderAll();
  }

  function addFont() {
    var input = $('#brand-font-input');
    var v = (input && input.value || '').trim();
    if (!v) { if (input) input.focus(); return; }
    if ((S.kit.fonts || []).indexOf(v) >= 0) { LS.toast('这个字体已经在品牌字体里了', 'warn'); return; }
    S.kit.fonts.push(v);
    saveKit();
    renderIdentity();
    renderTab();
    if (input) input.value = '';
    LS.toast('已加入品牌字体');
  }

  function deleteFont(f) {
    S.kit.fonts = (S.kit.fonts || []).filter(function (x) { return x !== f; });
    saveKit();
    renderIdentity();
    renderTab();
  }

  /* ═════════ 事件 ═════════ */
  function bind() {
    $('#btn-brand').addEventListener('click', function () { open('assets'); });
    $('#np-brand').addEventListener('click', function () {
      LS.closeModal('modal-new');
      open('templates');
    });

    $('#brand-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-btab]');
      if (!b) return;
      S.tab = b.getAttribute('data-btab');
      updateModalTabs();
      if (S.tab === 'assets') renderAssets();
      if (S.tab === 'templates') renderTemplates();
      if (S.tab === 'identity') renderIdentity();
    });

    $('#brand-upload').addEventListener('click', function () { $('#file-brand').click(); });
    var emptyUpload = $('#brand-empty-upload');
    if (emptyUpload) emptyUpload.addEventListener('click', function () { $('#file-brand').click(); });
    $('#file-brand').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      if (files.length) uploadFiles(files);
      setTimeout(function () { e.target.value = ''; }, 2000);
    });
    $('#brand-category').addEventListener('change', function () { S.category = this.value; });

    $('#brand-filters').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (!b) return;
      S.filter = b.getAttribute('data-filter');
      renderAssets();
    });

    $('#brand-grid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ba]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      if (b.getAttribute('data-ba') === 'insert') { insertAssetById(id); }
      else if (b.getAttribute('data-ba') === 'delete') { deleteAsset(id); }
    });

    $('#brand-tpl-grid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bt]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var t = S.templates.filter(function (x) { return x.id === id; })[0];
      if (!t) return;
      var act = b.getAttribute('data-bt');
      if (act === 'apply') applyTemplate(t);
      else if (act === 'new') createFromTemplate(t);
      else if (act === 'more') {
        var r = b.getBoundingClientRect();
        LS.menu(r.right - 160, r.bottom + 4, [
          { label: '重命名', icon: 'type', action: function () { renameTemplate(id); } },
          { label: '用此新建项目', icon: 'frame', action: function () { createFromTemplate(t); } },
          { sep: true },
          { label: '删除模板', icon: 'trash', danger: true, action: function () { deleteTemplate(id); } }
        ]);
      }
    });

    $('#brand-save-template').addEventListener('click', saveTemplatePrompt);
    var emptySave = $('#brand-tpl-empty-save');
    if (emptySave) emptySave.addEventListener('click', saveTemplatePrompt);

    $('#brand-identity').addEventListener('click', function (e) {
      var add = e.target.closest('[data-bcolor-add]');
      if (add) { addColor(); return; }
      var del = e.target.closest('[data-bcolor-del]');
      if (del) { deleteColor(del.getAttribute('data-bcolor-del')); return; }
      var fa = e.target.closest('[data-bfont-apply]');
      if (fa) { applyFont(fa.getAttribute('data-bfont-apply')); return; }
      var fd = e.target.closest('[data-bfont-del]');
      if (fd) { deleteFont(fd.getAttribute('data-bfont-del')); return; }
      var fadd = e.target.closest('[data-bfont-add]');
      if (fadd) { addFont(); return; }
      if (e.target.closest('#brand-name-save')) {
        S.kit.name = ($('#brand-name-input').value || '').trim() || '我的品牌';
        saveKit(); renderTab(); updateMeta(); LS.toast('品牌名已保存');
      }
    });

    $('#brand-identity').addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'brand-name-input') {
        S.kit.name = t.value;
        clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(function () {
          saveKit(); renderTab();
        }, 300);
        return;
      }
      var cid = t.getAttribute('data-bcolor-id');
      if (cid) {
        var c = S.kit.colors.filter(function (x) { return x.id === cid; })[0];
        if (c) { c.hex = t.value; touchKit(); }
        return;
      }
      var nid = t.getAttribute('data-bcolor-name');
      if (nid) {
        var c2 = S.kit.colors.filter(function (x) { return x.id === nid; })[0];
        if (c2) { c2.name = t.value; touchKit(); }
      }
    });

    $('#brand-tab-body').addEventListener('click', function (e) {
      var act = e.target.closest('[data-brand-act]');
      if (act) {
        var a = act.getAttribute('data-brand-act');
        if (a === 'manage') open('assets');
        else if (a === 'manage-templates') open('templates');
        else if (a === 'manage-identity') open('identity');
        else if (a === 'save-template') saveTemplatePrompt();
        else if (a === 'upload') open('assets');
        return;
      }
      var asset = e.target.closest('[data-asset-id]');
      if (asset) { insertAssetById(asset.getAttribute('data-asset-id')); return; }
      var tpl = e.target.closest('[data-template-id]');
      if (tpl) { applyTemplateById(tpl.getAttribute('data-template-id')); return; }
      var c = e.target.closest('[data-brand-color]');
      if (c) { applyColor(c.getAttribute('data-brand-color')); return; }
      var f = e.target.closest('[data-brand-font]');
      if (f) { applyFont(f.getAttribute('data-brand-font')); }
    });

    var tabBody = $('#brand-tab-body');
    tabBody.addEventListener('dragstart', function (e) {
      var card = e.target.closest('[data-asset-id]');
      if (!card) return;
      try {
        e.dataTransfer.setData('application/x-lbs-asset', card.getAttribute('data-asset-id'));
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) {}
    });
    $('#brand-grid').addEventListener('dragstart', function (e) {
      var card = e.target.closest('.brand-card');
      if (!card) return;
      var b = card.querySelector('[data-ba="insert"]');
      if (!b) return;
      try {
        e.dataTransfer.setData('application/x-lbs-asset', b.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) {}
    });

    var dz = $('#brand-dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        dz.classList.add('over');
      });
    });
    dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('over');
      if (e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });

    window.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'b' || e.key === 'B')) {
        var onEditor = $('#screen-editor').classList.contains('active');
        var onHome = $('#screen-home').classList.contains('active');
        if (!onEditor && !onHome) return;
        e.preventDefault();
        if ($('#modal-brand').classList.contains('hidden')) open('assets');
        else LS.closeModal('modal-brand');
      }
    });
  }

  /* ═════════ 公开 API ═════════ */
  LS.brand = {
    init: init,
    open: open,
    renderTab: renderTab,
    renderAll: renderAll,
    getColors: getColors,
    getFonts: getFonts,
    insertAssetById: insertAssetById,
    saveTemplatePrompt: saveTemplatePrompt,
    saveCurrentTemplate: saveCurrentTemplate,
    applyTemplate: applyTemplate,
    createFromTemplate: createFromTemplate,
    state: S
  };
})(window.LS);
