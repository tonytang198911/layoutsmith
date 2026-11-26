/* 首页 · 项目管理 */
(function (LS) {
  'use strict';

  var projects = [];
  var sortMode = 'recent';
  var query = '';
  var opening = false;
  var preset = null;

  var PRESETS = [
    { w: 1000, h: 2000, label: '竖版' },
    { w: 1200, h: 2400, label: '大幅' },
    { w: 800, h: 1800, label: '细长' },
    { w: 600, h: 1200, label: '小尺寸 / 桌卡' },
    { w: 2000, h: 1000, label: '横版' },
    { w: 1500, h: 3000, label: '超大立面' },
    { w: 210, h: 297, label: 'A4 打印测试' },
    { w: 500, h: 500, label: '方形' }
  ];

  function $(s) { return LS.$(s); }

  function init() {
    $('#btn-new').addEventListener('click', openNewModal);
    $('#btn-new-2').addEventListener('click', openNewModal);
    var bd = $('#btn-demo'); if (bd) bd.addEventListener('click', function () { if (LS.demo) LS.demo.open(); });
    $('#search-input').addEventListener('input', function () { query = this.value; renderGrid(); });
    $('#sort-select').addEventListener('change', function () { sortMode = this.value; renderGrid(); });
    $('#project-grid').addEventListener('click', onGridClick);
    $('#project-grid').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var card = e.target.closest('.proj-card');
        if (card && card.dataset.id) location.hash = '#/p/' + card.dataset.id;
      }
    });
    $('#btn-import').addEventListener('click', function () { $('#file-project').click(); });
    $('#file-project').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      setTimeout(function () { e.target.value = ''; }, 2000);
    });
    initNewModal();
  }

  function show() {
    var st = LS.editor && LS.editor.state;
    if (st && st.meta && st.dirty) LS.editor.saveNow(true);
    $('#screen-editor').classList.remove('active');
    $('#screen-home').classList.add('active');
    document.title = '排版大师 · Layoutsmith';
    if (LS.editor && LS.editor.state.canvas) LS.editor.state.meta = null;
    render();
  }

  function render() {
    LS.store.list().then(function (list) {
      projects = (list || []).slice();
      renderGrid();
    }).catch(function () {
      projects = [];
      renderGrid();
    });
  }

  function renderGrid() {
    var grid = $('#project-grid');
    var list = projects.filter(function (p) {
      return !query || String(p.name || '').toLowerCase().indexOf(query.toLowerCase()) >= 0;
    });
    list.sort(function (a, b) {
      if (sortMode === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
      if (sortMode === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    $('#proj-count').textContent = projects.length + ' 个项目';
    var empty = $('#home-empty');
    var note = $('#home-empty p');
    if (!projects.length) {
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
    } else if (!list.length) {
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
      empty.querySelector('h3').textContent = '没有找到项目';
      note.textContent = '换个关键词试试。';
    } else {
      empty.classList.add('hidden');
      grid.classList.remove('hidden');
    }

    var html = '<button class="proj-card new" data-new="1" type="button"><span class="plus-ring">' + LS.icon('plus') + '</span><b>新建项目</b><span>1000 × 2000 mm 起</span></button>';
    html += list.map(function (p) {
      var thumbStyle = p.thumb ? "background-image:url('" + p.thumb + "')" : '';
      return '<article class="proj-card" data-id="' + p.id + '" tabindex="0" role="button" aria-label="' + LS.esc(p.name) + '">' +
        '<div class="proj-thumb" style="' + thumbStyle + '">' +
        (p.thumb ? '' : '<span class="ph">' + LS.icon('frame') + '</span>') +
        '<span class="proj-size">' + LS.fmtNum(p.w, 0) + ' × ' + LS.fmtNum(p.h, 0) + ' mm</span>' +
        '<button class="proj-more" data-more="' + p.id + '" title="更多">' + LS.icon('more') + '</button>' +
        '</div>' +
        '<div class="proj-info"><div class="proj-name">' + LS.esc(p.name || '未命名项目') + '</div>' +
        '<div class="proj-meta"><span>' + LS.timeAgo(p.updatedAt) + '</span><span>·</span><span>' + (p.dpi || 150) + ' DPI</span>' +
        (p.artboardCount > 1 ? '<span>·</span><span>' + p.artboardCount + ' 个画板</span>' : '') +
        '</div></div></article>';
    }).join('');
    grid.innerHTML = html;
  }

  function onGridClick(e) {
    var more = e.target.closest('[data-more]');
    if (more) {
      e.stopPropagation();
      var id = more.getAttribute('data-more');
      var r = more.getBoundingClientRect();
      LS.menu(r.right - 160, r.bottom + 6, [
        { label: '打开', icon: 'frame', action: function () { location.hash = '#/p/' + id; } },
        { label: '重命名', icon: 'type', action: function () { rename(id); } },
        { label: '复制项目', icon: 'copy', action: function () { duplicate(id); } },
        { label: '下载项目文件', icon: 'download', action: function () { backup(id); } },
        { sep: true },
        { label: '删除项目', icon: 'trash', danger: true, action: function () { remove(id); } }
      ]);
      return;
    }
    if (e.target.closest('[data-new]')) { openNewModal(); return; }
    var card = e.target.closest('.proj-card[data-id]');
    if (card) location.hash = '#/p/' + card.dataset.id;
  }

  function rename(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    LS.prompt({ title: '重命名项目', label: '项目名称', value: p.name || '' }).then(function (v) {
      if (!v) return;
      LS.store.updateMeta(id, { name: v }).then(function () {
        LS.toast('已重命名');
        render();
      });
    });
  }

  function duplicate(id) {
    LS.store.get(id).then(function (r) {
      if (!r) return;
      var meta = Object.assign({}, r.meta, {
        id: LS.uid('p'),
        name: (r.meta.name || '未命名') + ' 副本',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      var doc = r.doc ? { data: JSON.parse(JSON.stringify(r.doc.data)) } : { data: null };
      LS.store.save(meta, doc.data).then(function () {
        LS.toast('已复制项目');
        render();
      });
    });
  }

  function backup(id) {
    LS.store.get(id).then(function (r) {
      if (!r) { LS.toast('项目不存在', 'err'); return; }
      var payload = { type: 'layoutsmith-project', version: 1, meta: r.meta, doc: r.doc ? r.doc.data : null };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      LS.downloadBlob(blob, LS.safeName(r.meta.name || '项目') + '.layoutsmith.json');
      LS.toast('项目文件已下载，可换电脑导入');
    });
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { LS.toast('不是有效的项目文件', 'err'); return; }
      if (!data || (data.type !== 'layoutsmith-project' && data.type !== 'lightbox-project') || !data.meta) {
        LS.toast('不是排版大师的项目文件', 'err'); return;
      }
      var old = data.meta;
      var meta = {
        id: LS.uid('p'),
        name: (old.name || '导入的项目') + ' (导入)',
        w: old.w || 1000, h: old.h || 2000,
        dpi: old.dpi || 150,
        bg: old.bg, transparent: !!old.transparent,
        createdAt: old.createdAt || Date.now(),
        updatedAt: Date.now(),
        thumb: old.thumb || '',
        artboardCount: old.artboardCount || 1
      };
      var doc = data.doc && data.doc.canvas ? data.doc : null;
      LS.store.save(meta, doc).then(function () {
        LS.toast('已导入「' + meta.name + '」');
        render();
      }).catch(function () { LS.toast('导入失败：存储空间可能不足', 'err'); });
    };
    reader.onerror = function () { LS.toast('读取文件失败', 'err'); };
    reader.readAsText(file);
  }

  function remove(id) {
    var p = projects.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    LS.confirm({ title: '删除项目？', message: '「' + (p.name || '未命名') + '」会从这台电脑上删除，无法恢复。', okText: '删除', danger: true }).then(function (ok) {
      if (!ok) return;
      LS.store.remove(id).then(function () {
        LS.toast('已删除');
        render();
      });
    });
  }

  /* ───────── 新建项目 ───────── */
  function initNewModal() {
    var grid = $('#np-presets');
    grid.innerHTML = PRESETS.map(function (p, i) {
      return '<button class="preset" data-preset="' + i + '"><b>' + p.w + ' × ' + p.h + ' mm</b><span>' + p.label + '</span></button>';
    }).join('');
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('[data-preset]');
      if (!b) return;
      setPreset(PRESETS[+b.getAttribute('data-preset')]);
    });
    $('#np-w').addEventListener('input', function () { clearPreset(); });
    $('#np-h').addEventListener('input', function () { clearPreset(); });
    $('#np-swap').addEventListener('click', function () {
      var w = $('#np-w').value; $('#np-w').value = $('#np-h').value; $('#np-h').value = w;
      clearPreset();
    });
    $('#np-bg').addEventListener('input', function () { $('#np-bg-hex').value = this.value; });
    $('#np-bg-hex').addEventListener('input', function () {
      if (LS.isHex(this.value)) $('#np-bg').value = LS.normHex(this.value);
    });
    $('#np-create').addEventListener('click', createProject);
    $('#np-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') createProject(); });
    $('#modal-new').addEventListener('mousedown', function (e) {
      if (e.target === $('#modal-new')) LS.closeModal('modal-new');
    });
  }

  function setPreset(p) {
    if (!p) return;
    preset = p;
    $('#np-w').value = p.w;
    $('#np-h').value = p.h;
    LS.$$('#np-presets .preset').forEach(function (b) {
      b.classList.toggle('active', +b.getAttribute('data-preset') === PRESETS.indexOf(p));
    });
  }
  function clearPreset() {
    preset = null;
    LS.$$('#np-presets .preset').forEach(function (b) { b.classList.remove('active'); });
  }

  function openNewModal() {
    $('#np-name').value = '未命名项目';
    setPreset(PRESETS[0]);
    $('#np-dpi').value = '150';
    $('#np-bg').value = '#ffffff';
    $('#np-bg-hex').value = '#ffffff';
    $('#np-transparent').checked = false;
    LS.openModal('modal-new');
    setTimeout(function () { var n = $('#np-name'); n.focus(); n.select(); }, 60);
  }

  function createProject() {
    var name = ($('#np-name').value || '').trim() || '未命名项目';
    var w = Math.max(1, Math.round(LS.num($('#np-w').value, 1000)));
    var h = Math.max(1, Math.round(LS.num($('#np-h').value, 2000)));
    if (w > 30000 || h > 30000) { LS.toast('尺寸太大（上限 30000mm）', 'err'); return; }
    var transparent = $('#np-transparent').checked;
    var meta = {
      id: LS.uid('p'),
      name: name,
      w: w, h: h,
      dpi: LS.num($('#np-dpi').value, 150),
      bg: transparent ? null : LS.normHex($('#np-bg').value, '#ffffff'),
      transparent: transparent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumb: '',
      artboardCount: 1
    };
    LS.store.save(meta, null).then(function () {
      LS.closeModal('modal-new');
      location.hash = '#/p/' + meta.id;
    }).catch(function (e) {
      LS.toast('创建失败：' + (e && e.message || '浏览器存储不可用'), 'err');
    });
  }

  /* ───────── 打开项目 ───────── */
  function openProject(id) {
    if (opening) return;
    opening = true;
    var st = LS.editor && LS.editor.state;
    if (st && st.meta && st.meta.id !== id && st.dirty) LS.editor.saveNow(true);
    LS.store.get(id).then(function (r) {
      opening = false;
      if (!r) {
        LS.toast('项目不存在或已被删除', 'err');
        location.hash = '#/';
        return;
      }
      $('#screen-home').classList.remove('active');
      $('#screen-editor').classList.add('active');
      document.title = (r.meta.name || '未命名项目') + ' · 排版大师';
      // 先切换界面再初始化画布，保证拿到真实尺寸
      LS.editor.open(r.meta, r.doc ? r.doc.data : null);
    }).catch(function (err) {
      opening = false;
      LS.toast('打开项目失败：' + (err && err.message || ''), 'err');
    });
  }

  LS.home = {
    init: init,
    show: show,
    render: render,
    renderGrid: renderGrid,
    openProject: openProject,
    backup: backup,
    importFile: importFile,
    newProject: openNewModal
  };
})(window.LS);
