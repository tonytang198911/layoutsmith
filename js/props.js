/* 右侧属性面板 + 图层 / 画板列表 */
(function (LS) {
  'use strict';

  var propsEl, layerListEl, abListEl, tab = 'layers';
  var fontUnit = (localStorage.getItem('lbs.fontunit') === 'pt') ? 'pt' : 'mm';
  var MM_PER_PT = 0.352777778;

  function E() { return LS.editor; }
  function S() { return LS.editor.state; }
  function canvas() { return LS.editor.canvas(); }
  function sel() { return canvas().getActiveObjects().filter(function (o) { return !o.lsArtboard; }); }
  function one() { var s = sel(); return s.length === 1 ? s[0] : null; }

  function icon(name) { return LS.icon(name); }
  function esc(v) { return LS.esc(v); }
  function fmt(v, d) { return LS.fmtNum(v, d == null ? 1 : d); }
  function numField(label, p, val, unit, attrs) {
    var dec = attrs && attrs.dec != null ? attrs.dec : 1;
    return '<label class="field"><span class="field-label">' + label + '</span>' +
      '<span class="num"><input class="input" data-p="' + p + '" type="number" step="' + (attrs && attrs.step || 1) + '" value="' + fmt(val, dec) + '" ' + (attrs && attrs.extra || '') + '>' +
      '<span class="unit">' + (unit || '') + '</span></span></label>';
  }
  function abNumField(label, code, val, unit, attrs) {
    return '<label class="field"><span class="field-label">' + label + '</span>' +
      '<span class="num"><input class="input" data-ab="' + code + '" type="number" step="' + (attrs && attrs.step || 1) + '" value="' + fmt(val, 1) + '">' +
      '<span class="unit">' + (unit || '') + '</span></span></label>';
  }
  function colorField(p, color, extra) {
    var c = LS.toHex(color, '#000000');
    return '<div class="color-field"><input type="color" data-p="' + p + 'Color" value="' + c + '" ' + (extra || '') + '>' +
      '<input class="input" data-p="' + p + 'Hex" value="' + c + '" spellcheck="false"></div>';
  }
  function segBtns(p, opts, active, extra) {
    return '<div class="segmented">' + opts.map(function (o) {
      return '<button data-p="' + p + '" data-v="' + o[0] + '" class="' + (String(active) === String(o[0]) ? 'active' : '') + '" ' + (extra || '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function typeIcon(o) {
    if (!o) return 'square';
    if (o.type === 'group') return 'layers';
    return {
      rect: 'square', ellipse: 'circle', circle: 'circle', polygon: 'polygon', line: 'line',
      path: 'pen', textbox: 'type', 'i-text': 'type', text: 'type', image: 'image', triangle: 'polygon'
    }[o.type] || 'square';
  }
  function typeName(o) {
    return {
      rect: '矩形', ellipse: '椭圆', circle: '圆形', polygon: '多边形', line: '直线', path: '路径',
      textbox: '文字', 'i-text': '文字', text: '文字', image: '图片', group: '编组', triangle: '三角形'
    }[o.type] || '对象';
  }
  function bbox(o) { return o.getBoundingRect(true); }

  /* ═════════ 初始化 ═════════ */
  function init() {
    propsEl = LS.$('#props');
    layerListEl = LS.$('#layers-list');
    abListEl = LS.$('#artboards-list');

    LS.$('.panel-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.ptab');
      if (!b) return;
      tab = b.getAttribute('data-tab');
      LS.$$('.ptab').forEach(function (x) { x.classList.toggle('active', x === b); });
      ['layers', 'artboards', 'brand'].forEach(function (name) {
        var pane = LS.$('#tab-' + name);
        if (pane) pane.classList.toggle('hidden', tab !== name);
      });
      var addBtn = LS.$('#btn-add-artboard');
      if (addBtn) addBtn.classList.toggle('hidden', tab === 'brand');
      if (tab === 'brand' && LS.brand) LS.brand.renderTab();
    });

    propsEl.addEventListener('input', onInput);
    propsEl.addEventListener('change', onChange);
    propsEl.addEventListener('click', onClick);

    layerListEl.addEventListener('click', onLayerClick);
    layerListEl.addEventListener('dblclick', onLayerDblClick);
    layerListEl.addEventListener('dragstart', onLayerDragStart);
    layerListEl.addEventListener('dragover', onLayerDragOver);
    layerListEl.addEventListener('dragleave', function (e) {
      var row = e.target.closest('.layer-row'); if (row) row.classList.remove('drag-over');
    });
    layerListEl.addEventListener('drop', onLayerDrop);
    layerListEl.addEventListener('dragend', function () {
      LS.$$('.layer-row.drag-over').forEach(function (r) { r.classList.remove('drag-over'); });
    });

    abListEl.addEventListener('click', onAbClick);
    abListEl.addEventListener('dblclick', onAbDblClick);
    initPropsVisibility();
  }

  function initPropsVisibility() {
    var btn = document.getElementById('btn-props-toggle');
    var right = propsEl;
    if (!btn || !right) return;
    var autoShown = false;
    function applyHidden(hide) {
      right.classList.toggle('hidden', hide);
      btn.classList.toggle('active', !hide);
      btn.setAttribute('aria-pressed', hide ? 'false' : 'true');
      btn.title = hide ? '显示属性面板（选中元素时自动显示）' : '隐藏属性面板';
    }
    function show(manual) {
      applyHidden(false);
      if (manual) autoShown = false;
    }
    function hide(manual) {
      applyHidden(true);
      autoShown = false;
      if (!manual) autoShown = false;
    }
    applyHidden(true);
    btn.addEventListener('click', function () {
      if (right.classList.contains('hidden')) show(true);
      else hide(true);
    });
    var bound = false;
    function bindCanvas() {
      if (bound) return;
      var c = null;
      try { c = canvas(); } catch (e) { c = null; }
      if (!c || !c.on) return;
      c.on('selection:created', onSel);
      c.on('selection:updated', onSel);
      c.on('selection:cleared', onClear);
      bound = true;
    }
    function onSel() {
      if (!sel().length) return;
      if (right.classList.contains('hidden')) {
        applyHidden(false);
        autoShown = true;
      }
    }
    function onClear() {
      if (autoShown) hide(false);
    }
    bindCanvas();
    setTimeout(bindCanvas, 300);
    document.addEventListener('ls:project-open', function () { setTimeout(bindCanvas, 80); });
    LS.props.showPanel = function () { show(true); };
    LS.props.hidePanel = function () { hide(true); };
  }

  /* ═════════ 渲染 ═════════ */
  function renderAll() {
    if (!LS.editor || !LS.editor.state.canvas) return;
    renderLayers();
    renderArtboards();
    renderProps();
    var c = LS.$('#layer-count');
    if (c) c.textContent = LS.editor.objects().length + ' 个对象';
  }

  function renderLayers() {
    if (!layerListEl) return;
    var objs = LS.editor.objects().slice().reverse();
    var active = canvas().getActiveObjects();
    LS.$('#layers-empty').classList.toggle('hidden', objs.length > 0);
    layerListEl.innerHTML = objs.map(function (o, i) {
      var isActive = active.indexOf(o) >= 0;
      var hidden = o.visible === false;
      var locked = !!o.lsLocked;
      return '<li class="layer-row' + (isActive ? ' active' : '') + '" draggable="true" data-idx="' + i + '">' +
        '<span class="licon">' + icon(typeIcon(o)) + '</span>' +
        '<span class="lname" title="' + esc(o.lsName || typeName(o)) + '">' + esc(o.lsName || typeName(o)) + '</span>' +
        '<button class="lbtn' + (hidden ? ' off' : '') + '" data-lbtn="vis" title="' + (hidden ? '显示' : '隐藏') + '">' + icon(hidden ? 'eye-off' : 'eye') + '</button>' +
        '<button class="lbtn' + (locked ? ' off' : '') + '" data-lbtn="lock" title="' + (locked ? '解锁' : '锁定') + '">' + icon(locked ? 'lock' : 'unlock') + '</button>' +
        '</li>';
    }).join('');
  }

  function renderArtboards() {
    if (!abListEl) return;
    var abs = LS.editor.artboards();
    var activeId = S().activeArtboardId;
    abListEl.innerHTML = abs.map(function (a) {
      var act = a.lsArtboardId === activeId;
      return '<li class="ab-item' + (act ? ' active' : '') + '" data-abid="' + a.lsArtboardId + '">' +
        '<span class="ab-thumb">' + icon('frame') + '</span>' +
        '<span class="ab-meta"><b>' + esc(a.lsName || '画板') + '</b>' +
        '<span>' + fmt(a.width, 0) + ' × ' + fmt(a.height, 0) + ' mm</span></span>' +
        '<button class="icon-btn tiny" data-abact="more" title="更多">' + icon('more') + '</button>' +
        '</li>';
    }).join('') + '<button class="ab-item" data-abact="add" style="justify-content:center;color:var(--muted);font-size:12px">' + icon('plus') + ' 新建画板</button>' +
      '<button class="ab-item" data-abact="fitall" style="justify-content:center;color:var(--muted);font-size:12px">' + icon('fit') + ' 适应全部画板</button>';
  }

  function renderProps() {
    if (!propsEl) return;
    var st = S();
    if (!st.canvas) { propsEl.innerHTML = ''; return; }
    if (st.preview) {
      propsEl.innerHTML = '<div class="psec"><div class="psec-head">' + icon('eye') + '预览裁切</div>' +
        '<p class="note" style="margin-bottom:10px">画板以外的内容会被灰底遮住，导出时同样会被裁掉。</p>' +
        '<button class="btn btn-block" data-act="exitPreview">退出预览</button></div>';
      return;
    }
    if (st.selectedGuide) {
      var g = st.guides.filter(function (x) { return x.id === st.selectedGuide; })[0];
      if (g) {
        propsEl.innerHTML = '<div class="sel-head"><span class="badge">' + icon('grid') + '</span><div class="t"><b>' + (g.axis === 'x' ? '垂直参考线' : '水平参考线') + '</b><span>' + (g.axis === 'x' ? 'X' : 'Y') + ' = ' + fmt(g.pos) + ' mm</span></div></div>' +
          '<div class="psec"><div class="psec-head">' + icon('grid') + '参考线位置</div>' +
          '<div class="grid2">' + numField('位置', 'guidePos', g.pos, 'mm') + '</div>' +
          '<div class="grid2" style="margin-top:10px">' +
          '<button class="btn btn-sm" data-act="gridClear">清除全部</button>' +
          '<button class="btn btn-sm btn-danger" data-act="guideDel">删除参考线</button></div>' +
          '<p class="prop-help">参考线会参与吸附：移动对象或拖动图形时靠近即会贴齐。</p></div>';
        return;
      }
    }

    var objs = sel();
    if (!objs.length) {
      // 画板属性
      var ab = LS.editor.activeArtboard();
      var abs = LS.editor.artboards();
      var html = '';
      if (ab) {
        html += '<div class="sel-head"><span class="badge">' + icon('frame') + '</span>' +
          '<div class="t"><b>' + esc(ab.lsName || '画板') + '</b><span>画板 · ' + fmt(ab.width, 0) + ' × ' + fmt(ab.height, 0) + ' mm</span></div></div>' +
          '<div class="psec"><div class="psec-head">' + icon('frame') + '画板设置<span class="right"><button class="link" data-act="fitArtboard">适应视图</button></span></div>' +
          '<label class="field" style="margin-bottom:8px"><span class="field-label">名称</span><input class="input" data-ab="name" value="' + esc(ab.lsName || '') + '"></label>' +
          '<div class="grid2">' +
          abNumField('宽', 'w', ab.width, 'mm') +
          abNumField('高', 'h', ab.height, 'mm') +
          abNumField('X', 'x', ab.left, 'mm') +
          abNumField('Y', 'y', ab.top, 'mm') +
          '</div>' +
          '<div class="field" style="margin-top:8px"><span class="field-label">底色</span>' +
          '<div class="color-field"><input type="color" data-ab="fill" value="' + LS.toHex(ab.fill, '#ffffff') + '"><input class="input" data-ab="fillHex" value="' + LS.toHex(ab.fill, '#ffffff') + '"></div></div>' +
          '<div class="field" style="margin-top:8px"><span class="field-label">导出 DPI</span>' +
          '<select class="select" data-ab="dpi">' + [72, 150, 300, 450].map(function (d) { return '<option value="' + d + '"' + (S().dpi === d ? ' selected' : '') + '>' + d + ' DPI</option>'; }).join('') + '</select></div>' +
          '<div class="grid2" style="margin-top:10px">' +
          '<button class="btn btn-sm" data-act="addArtboard">' + icon('plus') + '新建画板</button>' +
          '<button class="btn btn-sm" data-act="dupArtboard" title="用当前画板尺寸新建一个空画板">' + icon('copy') + '同尺寸新建</button>' +
          '</div>' +
          '<div class="grid2" style="margin-top:6px">' +
          '<button class="btn btn-sm" data-act="exportArtboard">' + icon('download') + '导出此画板</button>' +
          '<button class="btn btn-sm btn-danger" data-act="delArtboard">' + icon('trash') + '删除画板</button>' +
          '</div>' +
          '<p class="ab-prop-note" style="margin-top:8px">共 ' + abs.length + ' 个画板 · 画板外内容不会被导出</p>' +
          '</div>';
      } else {
        html += '<div class="psec"><p class="note">' + (abs.length ? '未选择画板。点击画布上的画板或左侧画板列表选择一个画板。' : '还没有画板，先新建一个。') + '</p>' +
          '<button class="btn btn-primary btn-block" data-act="addArtboard">新建画板</button></div>';
      }
      html += '<div class="psec"><div class="psec-head">' + icon('grid') + '参考线<span class="right"><button class="link" data-act="gridClear">清除</button></span></div>' +
        '<p class="ab-prop-note">从顶部或左侧标尺拖出参考线，拖动可移动，拖回标尺或选中后按 ⌫ 删除。当前 ' + st.guides.length + ' 条。</p>' +
        '<p class="ab-prop-note" style="margin-top:8px">提示：拖入图片 · 双击文字编辑 · <kbd>⌘G</kbd> 编组 · 多选后用路径查找器</p></div>';
      propsEl.innerHTML = html;
      return;
    }

    var a = canvas().getActiveObject();
    var multi = objs.length > 1;
    var single = objs.length === 1 ? objs[0] : null;
    var html2 = '';

    html2 += '<div class="sel-head"><span class="badge">' + icon(multi ? 'layers' : typeIcon(single)) + '</span>' +
      '<div class="t"><b>' + (multi ? objs.length + ' 个对象' : esc(single.lsName || typeName(single))) + '</b>' +
      '<span>' + (multi ? '多选 · 可批量改填充与透明度' : typeName(single) + ' · ' + fmt(bbox(single).width) + ' × ' + fmt(bbox(single).height) + ' mm') + '</span></div>' +
      '<button class="icon-btn tiny" data-act="delete" title="删除">' + icon('trash') + '</button></div>';

    // 路径查找器
    if (objs.length >= 2) {
      var okCount = objs.filter(function (o) { return LS.bool.supports(o); }).length;
      html2 += '<div class="psec"><div class="psec-head">' + icon('unite') + '路径查找器' +
        '<span class="right tiny-label">' + okCount + '/' + objs.length + ' 个可运算</span></div>' +
        '<div class="op-grid">' +
        [['unite', '合并', 'unite'], ['subtract', '相减', 'subtract'], ['intersect', '交集', 'intersect'], ['exclude', '排除', 'exclude']].map(function (o) {
          return '<button class="op-btn" data-act="bool:' + o[0] + '" title="' + o[1] + '">' + icon(o[2]) + '<span>' + o[1] + '</span></button>';
        }).join('') + '</div>' +
        '<p class="ab-prop-note" style="margin-top:8px">合并 = 并集；相减 = 底层减去上层；交集 = 只保留重叠部分；排除 = 去掉重叠部分。</p></div>';
    }


    // 变换（单选）
    if (single) {
      var b = bbox(single);
      html2 += '<div class="psec"><div class="psec-head">' + icon('frame') + '位置与大小</div><div class="grid2">' +
        numField('X', 'left', b.left, 'mm') +
        numField('Y', 'top', b.top, 'mm') +
        numField('宽', 'w', b.width, 'mm') +
        numField('高', 'h', b.height, 'mm') +
        numField('旋转', 'angle', (single.angle || 0), '°', { step: 1 }) +
        '<div class="field"><span class="field-label">翻转</span><div class="grid2">' +
        '<button class="icon-btn sq" data-act="flipH" title="水平翻转">' + icon('flip-h') + '</button>' +
        '<button class="icon-btn sq" data-act="flipV" title="垂直翻转">' + icon('flip-v') + '</button></div></div>' +
        '</div></div>';
    }

    // 文字
    if (single && /text/.test(single.type)) {
      var fsMM = single.fontSize || 12;
      var fsVal = fontUnit === 'pt' ? fsMM / MM_PER_PT : fsMM;
      var fam = single.fontFamily || 'PingFang SC';
      html2 += '<div class="psec"><div class="psec-head">' + icon('type') + '文字' +
        '<span class="right"><button class="link" data-act="scanFonts">本机字体</button><button class="link" data-act="uploadFont">上传</button></span></div>' +
        '<label class="field" style="margin-bottom:8px"><span class="field-label">字体（可输入任意本机字体名）</span>' +
        '<input class="input" data-p="fontFamily" list="font-list" value="' + esc(fam) + '" spellcheck="false"></label>' +
        '<div class="grid2">' +
        '<label class="field"><span class="field-label">字号</span><div style="display:flex;gap:4px;align-items:center">' +
        '<input class="input" data-p="fontSize" type="number" step="1" value="' + fmt(fsVal, 1) + '" style="flex:1;min-width:0">' +
        '<select class="select" data-p="fontUnit" style="width:56px;flex:none;padding-right:18px"><option value="mm"' + (fontUnit === 'mm' ? ' selected' : '') + '>mm</option><option value="pt"' + (fontUnit === 'pt' ? ' selected' : '') + '>pt</option></select></div></label>' +
        '<label class="field"><span class="field-label">字重</span><select class="select" data-p="fontWeight">' +
        ['300', '400', '500', '600', '700', '800'].map(function (w) { return '<option value="' + w + '"' + (String(single.fontWeight) === w ? ' selected' : '') + '>' + w + '</option>'; }).join('') +
        '</select></label></div>' +
        '<div class="grid3" style="margin-top:8px">' +
        '<button class="icon-btn sq ' + (single.fontStyle === 'italic' ? 'on' : '') + '" data-act="italic" title="斜体"><b style="font-style:italic;font-family:Georgia,serif;font-size:14px;font-weight:600">I</b></button>' +
        '<button class="icon-btn sq ' + (single.underline ? 'on' : '') + '" data-act="underline" title="下划线"><b style="text-decoration:underline;font-size:12px">U</b></button>' +
        '<button class="icon-btn sq" data-act="textCase" title="大写"><b style="font-size:12px;letter-spacing:.02em">AA</b></button>' +
        '</div>' +
        '<div class="field" style="margin-top:8px"><span class="field-label">对齐</span>' +
        '<div class="segmented">' +
        ['left', 'center', 'right', 'justify'].map(function (al) {
          var labels = { left: '左', center: '中', right: '右', justify: '两端' };
          return '<button data-p="textAlign" data-v="' + al + '" class="' + (single.textAlign === al ? 'active' : '') + '">' + labels[al] + '</button>';
        }).join('') + '</div></div>' +
        '<div class="grid2" style="margin-top:8px">' +
        numField('行高', 'lineHeight', (single.lineHeight || 1.16), '×', { step: 0.05, dec: 2 }) +
        numField('字距', 'charSpacing', (single.charSpacing || 0), '', { step: 10, dec: 0 }) +
        '</div>' +
        '<label class="field" style="margin-top:8px"><span class="field-label">内容</span>' +
        '<textarea class="text-content" data-p="textContent">' + esc(single.text || '') + '</textarea></label></div>';
    }

    // 填充
    var canPaint = !single || (single.type !== 'image' && single.type !== 'group');
    if (multi) canPaint = true;
    if (canPaint) {
      var fillObj = single || objs[0];
      var kind = !fillObj.fill ? 'none' : (fillObj.fill instanceof fabric.Gradient ? 'grad' : 'solid');
      var htmlFill = '<div class="psec"><div class="psec-head">' + icon('gradient') + '填充</div>' +
        '<div class="fill-kind" style="margin-bottom:8px">' +
        '<button data-p="fillKind" data-v="none" class="' + (kind === 'none' ? 'active' : '') + '">无</button>' +
        '<button data-p="fillKind" data-v="solid" class="' + (kind === 'solid' ? 'active' : '') + '">纯色</button>' +
        '<button data-p="fillKind" data-v="grad" class="' + (kind === 'grad' ? 'active' : '') + '">渐变</button></div>';
      if (kind === 'solid') {
        var fc = fillObj.fill;
        if (typeof fc === 'string') htmlFill += colorField('fill', fc) + swatches('fill');
      } else if (kind === 'grad') {
        htmlFill += gradEditorHtml('fill', getGrad(fillObj, 'fill'));
      }
      htmlFill += '</div>';
      html2 += htmlFill;

      // 描边
      var strokeKind = !fillObj.stroke ? 'none' : (fillObj.stroke instanceof fabric.Gradient ? 'grad' : 'solid');
      var sw = fillObj.strokeWidth || 0;
      var dashKind = (fillObj.strokeDashArray && fillObj.strokeDashArray.length)
        ? (fillObj.strokeLineCap === 'round' ? 'dot' : 'dash') : 'solid';
      html2 += '<div class="psec"><div class="psec-head">' + icon('square') + '描边</div>' +
        '<div class="fill-kind" style="margin-bottom:8px">' +
        '<button data-p="strokeKind" data-v="none" class="' + (strokeKind === 'none' ? 'active' : '') + '">无</button>' +
        '<button data-p="strokeKind" data-v="solid" class="' + (strokeKind === 'solid' ? 'active' : '') + '">纯色</button>' +
        '<button data-p="strokeKind" data-v="grad" class="' + (strokeKind === 'grad' ? 'active' : '') + '">渐变</button></div>' +
        '<div class="grid2">' + numField('粗细', 'strokeWidth', sw, 'mm', { step: 0.5 }) +
        '<label class="field"><span class="field-label">线型</span><select class="select" data-p="strokeStyle">' +
        '<option value="solid"' + (dashKind === 'solid' ? ' selected' : '') + '>实线</option>' +
        '<option value="dash"' + (dashKind === 'dash' ? ' selected' : '') + '>虚线</option>' +
        '<option value="dot"' + (dashKind === 'dot' ? ' selected' : '') + '>点线</option></select></label></div>';
      if (strokeKind === 'solid') {
        html2 += '<div style="margin-top:8px">' + colorField('stroke', typeof fillObj.stroke === 'string' ? fillObj.stroke : '#2457f5') + '</div>';
      } else if (strokeKind === 'grad') {
        html2 += gradEditorHtml('stroke', getGrad(fillObj, 'stroke'));
      }
      html2 += '</div>';
    }

    // 圆角
    if (single && single.type === 'rect') {
      html2 += '<div class="psec"><div class="psec-head">' + icon('corner') + '圆角</div><div class="grid2">' +
        numField('圆角半径', 'rx', Math.min(single.rx || 0, single.width / 2), 'mm') + '</div>' +
        '<input type="range" data-p="rxRange" min="0" max="' + Math.floor(Math.min(single.width, single.height) / 2) + '" value="' + (single.rx || 0) + '" style="margin-top:6px">' +
        '</div>';
    }

    // 多边形
    if (single && single.type === 'polygon') {
      var sides = single.lsSides || (single.points ? Math.round(single.points.length / (single.lsStar ? 2 : 1)) : 6);
      html2 += '<div class="psec"><div class="psec-head">' + icon('polygon') + '多边形</div><div class="grid2">' +
        numField('边数', 'sides', sides, '', { step: 1, extra: 'min="3" max="60"' }) +
        '<label class="check" style="align-self:flex-end;padding-bottom:7px"><input type="checkbox" data-p="star" ' + (single.lsStar ? 'checked' : '') + '> 星形</label>' +
        '</div></div>';
    }

    // 图片
    if (single && single.type === 'image') {
      html2 += '<div class="psec"><div class="psec-head">' + icon('image') + '图片</div>' +
        '<div class="grid2">' +
        '<button class="btn btn-sm" data-act="imgFit">适应画板</button>' +
        '<button class="btn btn-sm" data-act="imgCover">填满画板</button>' +
        '</div><button class="btn btn-sm btn-block" data-act="imgReplace" style="margin-top:6px">' + icon('upload') + '替换图片</button>' +
        '<p class="ab-prop-note" style="margin-top:8px">图片按原始像素置入，缩放不会降低导出清晰度。</p></div>';
    }

    // 画板裁切
    var clipped = objs.some(function (o) { return o.clipPath && o.clipPath.lsClipArtboardId; });
    html2 += '<div class="psec"><div class="psec-head">' + icon('frame') + '画板裁切' +
      '<span class="right tiny-label">' + (clipped ? '已裁切' : '未裁切') + '</span></div>' +
      '<p class="ab-prop-note">只显示画板范围内的部分；画板移动时裁切框会跟着画板。适合让大图 / 光效只出现在当前画板里。</p>' +
      '<div class="grid2" style="margin-top:8px">' +
      '<button class="btn btn-sm" data-act="clipBoard">' + icon('frame') + '裁切到画板</button>' +
      '<button class="btn btn-sm" data-act="clipBoardOff"' + (clipped ? '' : ' disabled') + '>' + icon('eye') + '取消裁切</button>' +
      '</div></div>';

    // 透明度 / 混合
    html2 += '<div class="psec"><div class="psec-head">' + icon('eye') + '透明度</div>' +
      '<div style="display:flex;align-items:center;gap:8px"><input type="range" data-p="opacityRange" min="0" max="100" value="' + Math.round((objs[0].opacity == null ? 1 : objs[0].opacity) * 100) + '">' +
      '<input class="input" data-p="opacity" type="number" min="0" max="100" value="' + Math.round((objs[0].opacity == null ? 1 : objs[0].opacity) * 100) + '" style="width:64px"></div>' +
      '<div class="field" style="margin-top:8px"><span class="field-label">混合模式</span><select class="select" data-p="blend">' +
      [['source-over', '正常'], ['multiply', '正片叠底'], ['screen', '滤色'], ['overlay', '叠加'], ['darken', '变暗'], ['lighten', '变亮']].map(function (m) {
        return '<option value="' + m[0] + '"' + ((objs[0].globalCompositeOperation || 'source-over') === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
      }).join('') + '</select></div></div>';

    // 阴影（单选）
    if (single) {
      var sh = single.shadow;
      html2 += '<div class="psec"><div class="psec-head">' + icon('shadow') + '阴影 / 发光</div>' +
        '<label class="check"><input type="checkbox" data-p="shadowOn" ' + (sh ? 'checked' : '') + '> 启用阴影</label>';
      if (sh) {
        html2 += '<div style="margin-top:8px">' + colorField('shadow', sh.color || '#0f172a') + '</div>' +
          '<div class="grid3" style="margin-top:8px">' +
          numField('模糊', 'shadowBlur', sh.blur || 0, 'mm') +
          numField('X', 'shadowX', sh.offsetX || 0, 'mm') +
          numField('Y', 'shadowY', sh.offsetY || 0, 'mm') +
          '</div>';
      }
      html2 += '</div>';
    }

    // 对齐
    html2 += '<div class="psec"><div class="psec-head">' + icon('align-left') + '对齐' +
      '<span class="right"><span class="tiny-label">' + (objs.length > 1 ? '相对选区' : '相对画板') + '</span></span></div>' +
      '<div class="icon-grid">' +
      ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'].map(function (k) {
        var labels = { left: '左对齐', centerX: '水平居中', right: '右对齐', top: '顶对齐', centerY: '垂直居中', bottom: '底对齐' };
        return '<button class="icon-btn sq" data-act="align:' + k + '" title="' + labels[k] + '">' + icon('align-' + (k === 'centerX' ? 'center' : k === 'centerY' ? 'middle' : k)) + '</button>';
      }).join('') + '</div></div>';

    // 层级 / 编组
    html2 += '<div class="psec"><div class="psec-head">' + icon('layers') + '排列与成组</div>' +
      '<div class="grid2">' +
      '<button class="btn btn-sm" data-act="arrange:front">置顶</button>' +
      '<button class="btn btn-sm" data-act="arrange:back">置底</button>' +
      '<button class="btn btn-sm" data-act="arrange:forward">上移一层</button>' +
      '<button class="btn btn-sm" data-act="arrange:backward">下移一层</button>' +
      '</div>' +
      '<div class="grid2" style="margin-top:6px">' +
      '<button class="btn btn-sm" data-act="group" ' + (multi ? '' : 'disabled') + '>' + icon('group') + '成组</button>' +
      '<button class="btn btn-sm" data-act="ungroup" ' + (single && single.type === 'group' ? '' : 'disabled') + '>' + icon('ungroup') + '解组</button>' +
      '</div>' +
      '<div class="grid2" style="margin-top:6px">' +
      '<button class="btn btn-sm" data-act="duplicate">' + icon('copy') + '再制</button>' +
      '<button class="btn btn-sm btn-danger" data-act="delete">' + icon('trash') + '删除</button>' +
      '</div></div>';

    propsEl.innerHTML = html2;
  }

  function swatches(p) {
    var brand = (LS.brand && LS.brand.getColors) ? LS.brand.getColors() : [];
    var html = brand.slice(0, 8).map(function (c) {
      return '<button class="swatch swatch-brand" data-act="swatch:' + p + ':' + c.hex + '" style="background:' + c.hex + '" title="品牌色 · ' + esc(c.name || c.hex) + '"></button>';
    }).join('');
    html += LS.SWATCHES.map(function (c) {
      return '<button class="swatch" data-act="swatch:' + p + ':' + c + '" style="background:' + c + '" title="' + c + '"></button>';
    }).join('');
    return '<div class="swatches">' + html + '</div>';
  }

  /* ═════════ 渐变 ═════════ */
  function getGrad(obj, slot) {
    var g = slot === 'stroke' ? obj.stroke : obj.fill;
    var fallback = slot === 'stroke' ? (typeof obj.stroke === 'string' ? obj.stroke : '#2457f5') : (typeof obj.fill === 'string' ? obj.fill : '#2457f5');
    if (g instanceof fabric.Gradient) {
      var stops = (g.colorStops || []).map(function (s) { return { offset: s.offset, color: s.color }; });
      if (stops.length < 2) stops = [{ offset: 0, color: fallback }, { offset: 1, color: '#ffffff' }];
      var angle = 90;
      if (g.type === 'linear' && g.coords) {
        angle = Math.round(Math.atan2(g.coords.y2 - g.coords.y1, g.coords.x2 - g.coords.x1) * 180 / Math.PI);
      }
      return { type: g.type || 'linear', angle: angle, stops: stops };
    }
    return { type: 'linear', angle: 90, stops: [{ offset: 0, color: fallback }, { offset: 1, color: '#8fb0ff' }] };
  }

  function gradCss(data) {
    var stops = data.stops.slice().sort(function (a, b) { return a.offset - b.offset; });
    return 'linear-gradient(90deg,' + stops.map(function (s) { return s.color + ' ' + Math.round(s.offset * 100) + '%'; }).join(',') + ')';
  }

  function makeGrad(data) {
    var stops = data.stops.slice().sort(function (a, b) { return a.offset - b.offset; });
    if (data.type === 'radial') {
      return new fabric.Gradient({
        type: 'radial', gradientUnits: 'percentage',
        coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.72 },
        colorStops: stops
      });
    }
    var a = (data.angle || 0) * Math.PI / 180;
    var x1 = 0.5 - Math.cos(a) / 2, y1 = 0.5 - Math.sin(a) / 2;
    var x2 = 0.5 + Math.cos(a) / 2, y2 = 0.5 + Math.sin(a) / 2;
    return new fabric.Gradient({
      type: 'linear', gradientUnits: 'percentage',
      coords: { x1: x1, y1: y1, x2: x2, y2: y2 },
      colorStops: stops
    });
  }

  function gradEditorHtml(slot, data) {
    return '<div class="grad-editor" data-slot="' + slot + '">' +
      '<div class="segmented" style="margin-bottom:8px">' +
      '<button data-p="gradType" data-slot="' + slot + '" data-v="linear" class="' + (data.type === 'linear' ? 'active' : '') + '">线性</button>' +
      '<button data-p="gradType" data-slot="' + slot + '" data-v="radial" class="' + (data.type === 'radial' ? 'active' : '') + '">径向</button>' +
      '</div>' +
      '<div class="grad-bar" style="background:' + gradCss(data) + '"></div>' +
      (data.type === 'linear' ? '<div class="grid2" style="margin-top:8px">' + numField('角度', 'gradAngle', data.angle, '°', { extra: 'data-slot="' + slot + '"' }) + '</div>' : '') +
      '<div class="stop-list">' + data.stops.map(function (s, i) {
        return '<div class="stop-row">' +
          '<input type="color" data-p="stopColor" data-slot="' + slot + '" data-i="' + i + '" value="' + LS.toHex(s.color, '#000000') + '">' +
          '<span class="num" style="width:78px;flex:none"><input type="number" data-p="stopOff" data-slot="' + slot + '" data-i="' + i + '" min="0" max="100" value="' + Math.round(s.offset * 100) + '"><span class="unit">%</span></span>' +
          '<span style="flex:1"></span>' +
          '<button class="icon-btn tiny" data-act="stopDel" data-slot="' + slot + '" data-i="' + i + '">' + icon('close') + '</button>' +
          '</div>';
      }).join('') + '</div>' +
      '<button class="btn btn-sm btn-block" data-act="stopAdd" data-slot="' + slot + '" style="margin-top:6px">+ 添加色标</button>' +
      '</div>';
  }

  function updateGrad(slot, fn, el) {
    var objs = sel();
    var data = getGrad(objs[0], slot);
    fn(data);
    objs.forEach(function (o) {
      if (o.type === 'image' || o.type === 'group') return;
      if (slot === 'stroke' && (o.strokeWidth || 0) === 0) o.set('strokeWidth', 1);
      o.set(slot === 'stroke' ? 'stroke' : 'fill', makeGrad(data));
      o.setCoords();
    });
    if (el) {
      var wrap = el.closest('.grad-editor');
      if (wrap) {
        var bar = wrap.querySelector('.grad-bar');
        if (bar) bar.style.background = gradCss(data);
      }
    }
    canvas().requestRenderAll();
    LS.editor.commitSoon();
  }

  /* ═════════ 属性事件 ═════════ */
  function onInput(e) {
    var el = e.target;
    var p = el.getAttribute('data-p');
    if (!p) return;
    var objs = sel();
    if (!objs.length) return;
    var v = el.type === 'checkbox' ? el.checked : el.value;

    switch (p) {
      case 'left': case 'top': {
        var o = objs[0], b = bbox(o);
        var delta = LS.num(v) - (p === 'left' ? b.left : b.top);
        objs.forEach(function (x) {
          x.set(p === 'left' ? 'left' : 'top', (p === 'left' ? x.left : x.top) + delta);
          x.setCoords();
        });
        canvas().requestRenderAll();
        LS.editor.commitSoon();
        break;
      }
      case 'w': case 'h': {
        var o2 = objs[0], b2 = bbox(o2);
        var val = Math.max(0.1, LS.num(v));
        var ratio = p === 'w' ? val / (b2.width || 1) : val / (b2.height || 1);
        objs.forEach(function (x) {
          if (p === 'w') x.set('scaleX', (x.scaleX || 1) * ratio);
          else x.set('scaleY', (x.scaleY || 1) * ratio);
          x.setCoords();
        });
        canvas().requestRenderAll();
        LS.editor.commitSoon();
        break;
      }
      case 'angle':
        objs.forEach(function (x) { x.set('angle', LS.num(v)); x.setCoords(); });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'opacity':
        objs.forEach(function (x) { x.set('opacity', LS.clamp(LS.num(v) / 100, 0, 1)); });
        var r = propsEl.querySelector('[data-p="opacityRange"]');
        if (r) r.value = v;
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'opacityRange':
        objs.forEach(function (x) { x.set('opacity', LS.clamp(LS.num(v) / 100, 0, 1)); });
        var n = propsEl.querySelector('[data-p="opacity"]');
        if (n) n.value = v;
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'fillColor': case 'fillHex': {
        var hex = p === 'fillHex' ? LS.normHex(v, null) : LS.normHex(v, '#000000');
        if (!hex) return;
        objs.forEach(function (x) {
          if (x.type === 'image' || x.type === 'group') return;
          x.set('fill', hex);
          if (x.type === 'textbox' || /text/.test(x.type)) x.setCoords();
        });
        syncColorPair(el, p, hex);
        var allText = objs.every(function (o) { return /text/.test(o.type); });
        LS.editor.rememberStyle(allText ? { textFill: hex } : { fill: hex });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'strokeColor': case 'strokeHex': {
        var hex2 = p === 'strokeHex' ? LS.normHex(v, null) : LS.normHex(v, '#000000');
        if (!hex2) return;
        objs.forEach(function (x) {
          if (x.type === 'image' || x.type === 'group') return;
          x.set('stroke', hex2);
          if (!x.strokeWidth) x.set('strokeWidth', 1);
        });
        syncColorPair(el, p, hex2);
        LS.editor.rememberStyle({ stroke: hex2 });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'strokeWidth':
        objs.forEach(function (x) {
          if (x.type === 'image' || x.type === 'group') return;
          x.set('strokeWidth', Math.max(0, LS.num(v)));
        });
        LS.editor.rememberStyle({ strokeWidth: Math.max(0, LS.num(v)) });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'gradAngle': updateGrad(el.getAttribute('data-slot'), function (d) { d.angle = LS.num(v); }, el); break;
      case 'stopColor':
        updateGrad(el.getAttribute('data-slot'), function (d) { d.stops[+el.getAttribute('data-i')].color = LS.normHex(v, '#000000'); }, el); break;
      case 'stopOff':
        updateGrad(el.getAttribute('data-slot'), function (d) {
          var i = +el.getAttribute('data-i');
          d.stops[i].offset = LS.clamp(LS.num(v) / 100, 0, 1);
        }, el); break;
      case 'rx': case 'rxRange': {
        var rv = Math.max(0, LS.num(v));
        objs.forEach(function (x) { if (x.type === 'rect') x.set({ rx: rv, ry: rv }); });
        var rr = propsEl.querySelector('[data-p="rxRange"]'); if (rr && p === 'rx') rr.value = rv;
        var ri = propsEl.querySelector('[data-p="rx"]'); if (ri && p === 'rxRange') ri.value = fmt(rv, 1);
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'sides': {
        var o3 = objs[0];
        var nSides = LS.clamp(Math.round(LS.num(v)), 3, 60);
        var star = !!o3.lsStar;
        var bb3 = bbox(o3);
        o3.set({ points: LS.editor.polyPoints(nSides, star, 100), lsSides: nSides });
        var d3 = LS.editor.polyDims(o3.points);
        o3.set({ left: bb3.left, top: bb3.top, scaleX: bb3.width / d3.w, scaleY: bb3.height / d3.h });
        o3.setCoords();
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'star': {
        var o4 = objs[0];
        var bb4 = bbox(o4);
        var n4 = o4.lsSides || 6;
        o4.set({ points: LS.editor.polyPoints(n4, el.checked, 100), lsStar: el.checked });
        var d4 = LS.editor.polyDims(o4.points);
        o4.set({ left: bb4.left, top: bb4.top, scaleX: bb4.width / d4.w, scaleY: bb4.height / d4.h });
        o4.setCoords();
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'fontFamily':
        objs.forEach(function (x) { if (/text/.test(x.type)) { x.set('fontFamily', v); x.setCoords(); } });
        LS.editor.rememberStyle({ fontFamily: v });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'fontSize': {
        var mm = LS.num(v) * (fontUnit === 'pt' ? MM_PER_PT : 1);
        mm = Math.max(0.5, mm);
        objs.forEach(function (x) { if (/text/.test(x.type)) { x.set('fontSize', mm); x.setCoords(); } });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'fontWeight':
        objs.forEach(function (x) { if (/text/.test(x.type)) { x.set('fontWeight', v); x.setCoords(); } });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'lineHeight':
        objs.forEach(function (x) { if (/text/.test(x.type)) { x.set('lineHeight', Math.max(0.5, LS.num(v))); x.setCoords(); } });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'charSpacing':
        objs.forEach(function (x) { if (/text/.test(x.type)) { x.set('charSpacing', LS.num(v)); x.setCoords(); } });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'textContent':
        objs.forEach(function (x) {
          if (!/text/.test(x.type)) return;
          x.set('text', v);
          if (x.initDimensions) x.initDimensions();
          LS.editor.applyTextWrap(x);
          x.lsName = (v || '').replace(/\s+/g, ' ').trim().slice(0, 16) || '文字';
          x.setCoords();
        });
        renderLayers();
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      case 'shadowOn':
        objs.forEach(function (x) {
          if (el.checked) {
            x.set('shadow', new fabric.Shadow({ color: 'rgba(15,23,42,.45)', blur: 8, offsetX: 0, offsetY: 4 }));
          } else {
            x.set('shadow', null);
          }
          x.dirty = true;
        });
        canvas().requestRenderAll(); LS.editor.commitSoon(); renderProps(); break;
      case 'shadowBlur': case 'shadowX': case 'shadowY': {
        var prop = p === 'shadowBlur' ? 'blur' : p === 'shadowX' ? 'offsetX' : 'offsetY';
        objs.forEach(function (x) {
          var sh = x.shadow;
          if (!sh) { sh = new fabric.Shadow({ color: 'rgba(15,23,42,.45)', blur: 6, offsetX: 0, offsetY: 3 }); }
          sh[prop] = LS.num(v);
          x.set('shadow', sh);
          x.dirty = true;
        });
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'shadowColor': case 'shadowHex': {
        var hx = p === 'shadowHex' ? LS.normHex(v, null) : LS.normHex(v, '#000000');
        if (!hx) return;
        objs.forEach(function (x) {
          var sh = x.shadow || new fabric.Shadow({ color: hx, blur: 6, offsetX: 0, offsetY: 3 });
          sh.color = hx;
          x.set('shadow', sh);
          x.dirty = true;
        });
        syncColorPair(el, p, hx);
        canvas().requestRenderAll(); LS.editor.commitSoon(); break;
      }
      case 'guidePos': {
        var id = S().selectedGuide;
        S().guides.forEach(function (g) { if (g.id === id) g.pos = LS.num(v); });
        S().canvas.requestRenderAll(); LS.editor.commitSoon(); break;
      }
      default: break;
    }
  }

  function syncColorPair(el, p, hex) {
    var isHex = p.indexOf('Hex') >= 0;
    var pair = isHex ? el.parentElement.querySelector('input[type=color]') : el.parentElement.querySelector('input:not([type=color])');
    if (pair) pair.value = hex;
  }

  function onChange(e) {
    var el = e.target;
    var ab = el.getAttribute('data-ab');
    if (ab) { onArtboardField(ab, el.value); return; }
    var p = el.getAttribute('data-p');
    if (!p) return;
    if (p === 'fontFamily') {
      LS.editor.rememberStyle({ fontFamily: el.value });
    }
    if (p === 'fontUnit') {
      fontUnit = el.value === 'pt' ? 'pt' : 'mm';
      try { localStorage.setItem('lbs.fontunit', fontUnit); } catch (e) {}
      renderProps();
      return;
    }
    if (p === 'strokeStyle') {
      var st = el.value;
      var mult = st === 'dash' ? [4, 3] : st === 'dot' ? [0.1, 2.2] : null;
      sel().forEach(function (x) {
        if (x.type === 'image' || x.type === 'group') return;
        var swid = x.strokeWidth || 1;
        x.set({ strokeDashArray: mult ? mult.map(function (n) { return n * Math.max(swid, 0.5); }) : null, strokeLineCap: st === 'dot' ? 'round' : 'butt' });
      });
      canvas().requestRenderAll(); LS.editor.commitNow();
    }
    if (p === 'blend') {
      sel().forEach(function (x) { x.set('globalCompositeOperation', el.value); x.dirty = true; });
      canvas().requestRenderAll(); LS.editor.commitNow();
    }
    if (p === 'fontFamily' || p === 'fontSize' || p === 'strokeWidth' || p === 'shadowBlur') LS.editor.commitNow();
  }

  function onClick(e) {
    var act = e.target.closest('[data-act]');
    if (act) { doAction(act); return; }
    var p = e.target.closest('[data-p]');
    if (!p) return;
    var key = p.getAttribute('data-p');
    var v = p.getAttribute('data-v');
    if (key === 'fillKind') {
      sel().forEach(function (o) {
        if (o.type === 'image' || o.type === 'group') return;
        if (v === 'none') o.set('fill', null);
        else if (v === 'solid') {
          var c = o.fill instanceof fabric.Gradient && o.fill.colorStops[0] ? o.fill.colorStops[0].color : (typeof o.fill === 'string' ? o.fill : '#2457f5');
          o.set('fill', c);
          LS.editor.rememberStyle({ fill: c, textFill: c });
        } else {
          o.set('fill', makeGrad(getGrad(o, 'fill')));
        }
        o.dirty = true;
      });
      canvas().requestRenderAll(); LS.editor.commitNow(); renderProps();
    } else if (key === 'strokeKind') {
      sel().forEach(function (o) {
        if (o.type === 'image' || o.type === 'group') return;
        if (v === 'none') o.set({ stroke: null, strokeWidth: 0 });
        else if (v === 'solid') {
          var c2 = o.stroke instanceof fabric.Gradient && o.stroke.colorStops[0] ? o.stroke.colorStops[0].color : (typeof o.stroke === 'string' ? o.stroke : '#2457f5');
          o.set('stroke', c2);
          if (!o.strokeWidth) o.set('strokeWidth', 1);
        } else {
          o.set('stroke', makeGrad(getGrad(o, 'stroke')));
          if (!o.strokeWidth) o.set('strokeWidth', 1);
        }
        o.dirty = true;
      });
      canvas().requestRenderAll(); LS.editor.commitNow(); renderProps();
    } else if (key === 'gradType') {
      updateGrad(p.getAttribute('data-slot'), function (d) { d.type = v; });
      renderProps();
    } else if (key === 'textAlign') {
      sel().forEach(function (o) { if (/text/.test(o.type)) { o.set('textAlign', v); o.setCoords(); } });
      canvas().requestRenderAll(); LS.editor.commitNow(); renderProps();
    }
  }

  function doAction(el) {
    var act = el.getAttribute('data-act');
    var ed = LS.editor;
    if (act.indexOf('align:') === 0) { ed.align(act.slice(6)); return; }
    if (act.indexOf('arrange:') === 0) { ed.arrange(act.slice(8)); return; }
    if (act.indexOf('bool:') === 0) { ed.runBoolean(act.slice(5)); return; }
    if (act.indexOf('swatch:') === 0) {
      var parts = act.split(':');
      var kind = parts[1], color = parts[2];
      sel().forEach(function (o) {
        if (kind === 'fill') o.set('fill', color); else o.set('stroke', color);
        o.dirty = true;
      });
      canvas().requestRenderAll(); ed.commitNow();
      if (kind === 'fill') ed.rememberStyle({ fill: color, textFill: color }); else ed.rememberStyle({ stroke: color });
      renderProps();
      return;
    }
    switch (act) {
      case 'delete': ed.deleteSelection(); break;
      case 'duplicate': ed.duplicateSelection(); break;
      case 'group': ed.groupSelection(); break;
      case 'ungroup': ed.ungroupSelection(); break;
      case 'flipH': ed.flip('h'); break;
      case 'flipV': ed.flip('v'); break;
      case 'fitArtboard': ed.fitArtboard(); break;
      case 'addArtboard': {
        var abs = ed.artboards();
        var src = ed.activeArtboard() || abs[abs.length - 1];
        var w = src ? src.width : 1000, h = src ? src.height : 2000;
        var pos = ed.nextArtboardPos(w, h);
        ed.addArtboard(pos.x, pos.y, w, h, '画板 ' + (abs.length + 1), src ? src.fill : '#ffffff');
        ed.fitAllArtboards();
        break;
      }
      case 'dupArtboard': {
        var ab = ed.activeArtboard();
        if (ab) {
          var pos2 = ed.nextArtboardPos(ab.width, ab.height);
          ed.addArtboard(pos2.x, pos2.y, ab.width, ab.height, (ab.lsName || '画板') + ' 副本', ab.fill);
          ed.fitAllArtboards();
        }
        break;
      }
      case 'delArtboard': {
        var ab2 = ed.activeArtboard();
        if (ab2) LS.confirm({ title: '删除画板？', message: '画板上的内容会保留，只是不再导出这一块。', okText: '删除', danger: true }).then(function (ok) {
          if (ok) ed.deleteArtboard(ab2.lsArtboardId);
        });
        break;
      }
      case 'exportArtboard': LS.exporter.openDialog(); break;
      case 'gridClear': ed.clearGuides(); break;
      case 'guideDel': ed.deleteSelectedGuide(); break;
      case 'help': ed.showHelp(); break;
      case 'exitPreview': ed.togglePreview(); break;
      case 'stopAdd': {
        var slot = el.getAttribute('data-slot');
        updateGrad(slot, function (d) {
          d.stops.sort(function (a, b) { return a.offset - b.offset; });
          var bestI = 0, bestGap = -1;
          for (var i = 0; i < d.stops.length - 1; i++) {
            var gap = d.stops[i + 1].offset - d.stops[i].offset;
            if (gap > bestGap) { bestGap = gap; bestI = i; }
          }
          var a = d.stops[bestI], b = d.stops[bestI + 1] || a;
          d.stops.push({
            offset: (a.offset + b.offset) / 2,
            color: mixHex(a.color, b.color)
          });
        });
        renderProps();
        break;
      }
      case 'stopDel': {
        var slot2 = el.getAttribute('data-slot'), i2 = +el.getAttribute('data-i');
        updateGrad(slot2, function (d) { if (d.stops.length > 2) d.stops.splice(i2, 1); });
        renderProps();
        break;
      }
      case 'scanFonts': LS.fonts.scan().then(function (ok) { if (ok) renderProps(); }); break;
      case 'uploadFont': LS.$('#file-font').click(); break;
      case 'italic': {
        var o = one(); if (!o) break;
        o.set('fontStyle', o.fontStyle === 'italic' ? 'normal' : 'italic');
        o.setCoords(); canvas().requestRenderAll(); ed.commitNow(); renderProps(); break;
      }
      case 'underline': {
        var o2 = one(); if (!o2) break;
        o2.set('underline', !o2.underline);
        o2.setCoords(); canvas().requestRenderAll(); ed.commitNow(); renderProps(); break;
      }
      case 'textCase': {
        var o3 = one(); if (!o3) break;
        var isUpper = o3.text === String(o3.text || '').toUpperCase();
        o3.set('text', isUpper ? o3.text.toLowerCase() : o3.text.toUpperCase());
        if (o3.initDimensions) o3.initDimensions();
        o3.setCoords(); canvas().requestRenderAll(); ed.commitNow(); renderProps(); break;
      }
      case 'imgFit': fitImage(false); break;
      case 'imgCover': fitImage(true); break;
      case 'imgReplace': replaceImage(); break;
      case 'clipBoard': ed.clipSelectionToArtboard(); renderProps(); break;
      case 'clipBoardOff': ed.unclipSelection(); renderProps(); break;
      default: break;
    }
  }

  function mixHex(a, b) {
    function parse(h) { h = LS.normHex(h, '#000000').slice(1); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    var x = parse(a), y = parse(b);
    var c = x.map(function (v, i) { return Math.round((v + y[i]) / 2); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  function fitImage(cover) {
    var img = one(); if (!img || img.type !== 'image') return;
    var ab = LS.editor.activeArtboard(); if (!ab) return;
    var iw = img.width, ih = img.height;
    var sx = ab.width / iw, sy = ab.height / ih;
    var sc = cover ? Math.max(sx, sy) : Math.min(sx, sy);
    img.set({ scaleX: sc, scaleY: sc, left: ab.left + (ab.width - iw * sc) / 2, top: ab.top + (ab.height - ih * sc) / 2 });
    img.setCoords();
    canvas().requestRenderAll(); LS.editor.commitNow(); renderProps();
  }

  function replaceImage() {
    var img = one(); if (!img || img.type !== 'image') return;
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        img.setSrc(r.result, function () {
          img.set({ lsName: f.name.replace(/\.[^.]+$/, '') });
          img.setCoords();
          canvas().requestRenderAll();
          LS.editor.commitNow(); renderProps();
          LS.toast('图片已替换');
        });
      };
      r.readAsDataURL(f);
    };
    inp.click();
  }

  /* ═════════ 画板字段 ═════════ */
  function onArtboardField(field, value) {
    var ed = LS.editor, ab = ed.activeArtboard();
    if (!ab) return;
    if (field === 'name') ed.updateArtboard(ab.lsArtboardId, { name: value });
    else if (field === 'w') ed.updateArtboard(ab.lsArtboardId, { w: LS.num(value) });
    else if (field === 'h') ed.updateArtboard(ab.lsArtboardId, { h: LS.num(value) });
    else if (field === 'x') ed.updateArtboard(ab.lsArtboardId, { x: LS.num(value) });
    else if (field === 'y') ed.updateArtboard(ab.lsArtboardId, { y: LS.num(value) });
    else if (field === 'fill') ed.updateArtboard(ab.lsArtboardId, { fill: value });
    else if (field === 'fillHex') { ed.updateArtboard(ab.lsArtboardId, { fill: LS.normHex(value, '#ffffff') }); }
    else if (field === 'dpi') { S().dpi = LS.num(value); LS.editor.markDirty(); LS.editor.commitNow(); }
  }

  /* ═════════ 图层交互 ═════════ */
  function onLayerClick(e) {
    var btn = e.target.closest('[data-lbtn]');
    var row = e.target.closest('.layer-row');
    if (!row) return;
    var idx = +row.getAttribute('data-idx');
    var obj = LS.editor.objects().slice().reverse()[idx];
    if (!obj) return;
    if (btn) {
      e.stopPropagation();
      if (btn.getAttribute('data-lbtn') === 'vis') {
        obj.set('visible', obj.visible === false);
        if (obj.visible === false && canvas().getActiveObjects().indexOf(obj) >= 0) canvas().discardActiveObject();
        obj.dirty = true;
        canvas().requestRenderAll();
      } else {
        obj.lsLocked = !obj.lsLocked;
        LS.editor.applyLock(obj);
        if (obj.lsLocked && canvas().getActiveObjects().indexOf(obj) >= 0) canvas().discardActiveObject();
      }
      LS.editor.commitNow(); renderAll();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      var curr = canvas().getActiveObjects().filter(function (o) { return !o.lsArtboard; });
      var i = curr.indexOf(obj);
      if (i >= 0) curr.splice(i, 1); else curr.push(obj);
      LS.editor.selectObjects(curr);
    } else {
      LS.editor.selectObjects([obj]);
    }
  }

  function onLayerDblClick(e) {
    var row = e.target.closest('.layer-row');
    if (!row) return;
    var idx = +row.getAttribute('data-idx');
    var obj = LS.editor.objects().slice().reverse()[idx];
    if (!obj) return;
    var span = row.querySelector('.lname');
    var inp = document.createElement('input');
    inp.className = 'lname-input';
    inp.value = obj.lsName || typeName(obj);
    span.replaceWith(inp);
    inp.focus(); inp.select();
    var finished = false;
    function done(save) {
      if (finished) return;
      finished = true;
      if (save) { obj.lsName = inp.value.trim() || typeName(obj); LS.editor.commitNow(); }
      renderLayers(); renderProps();
    }
    inp.addEventListener('blur', function () { done(true); });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
    });
  }

  var dragFrom = null;
  function onLayerDragStart(e) {
    var row = e.target.closest('.layer-row');
    if (!row) return;
    dragFrom = +row.getAttribute('data-idx');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
  }
  function onLayerDragOver(e) {
    var row = e.target.closest('.layer-row');
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    LS.$$('.layer-row.drag-over').forEach(function (r) { r.classList.remove('drag-over'); });
    row.classList.add('drag-over');
  }
  function onLayerDrop(e) {
    e.preventDefault();
    var row = e.target.closest('.layer-row');
    if (!row) return;
    var to = +row.getAttribute('data-idx');
    if (dragFrom == null || dragFrom === to) { dragFrom = null; return; }
    var listTop = LS.editor.objects().slice().reverse();
    var dragged = listTop[dragFrom];
    var target = listTop[to];
    if (!dragged || !target) { dragFrom = null; return; }
    var all = LS.editor.canvas().getObjects();
    var cur = all.indexOf(dragged);
    var ti = all.indexOf(target);
    if (cur < ti) ti--;
    LS.editor.canvas().moveTo(dragged, ti + 1);
    dragFrom = null;
    LS.$$('.layer-row.drag-over').forEach(function (r) { r.classList.remove('drag-over'); });
    canvas().requestRenderAll();
    LS.editor.commitNow(); renderAll();
  }

  /* ═════════ 画板列表交互 ═════════ */
  function onAbClick(e) {
    var more = e.target.closest('[data-abact]');
    if (more) {
      var act = more.getAttribute('data-abact');
      if (act === 'fitall') { LS.editor.fitAllArtboards(); return; }
      if (act === 'add') {
        var ed = LS.editor;
        var src = ed.activeArtboard();
        var w = src ? src.width : 1000, h = src ? src.height : 2000;
        var pos = ed.nextArtboardPos(w, h);
        ed.addArtboard(pos.x, pos.y, w, h, '画板 ' + (ed.artboards().length + 1), src ? src.fill : '#ffffff');
        ed.fitAllArtboards();
        return;
      }
      var item = more.closest('.ab-item');
      var id = item.getAttribute('data-abid');
      var r = more.getBoundingClientRect();
      LS.menu(r.left - 130, r.bottom + 4, [
        { label: '重命名', icon: 'type', action: function () { renameArtboard(id); } },
        { label: '适应视图', icon: 'fit', action: function () { LS.editor.setActiveArtboard(id); LS.editor.fitArtboard(); } },
        { label: '新建同尺寸画板', icon: 'copy', action: function () {
          var a = LS.editor.artboards().filter(function (x) { return x.lsArtboardId === id; })[0];
          if (a) {
            var pos3 = LS.editor.nextArtboardPos(a.width, a.height);
            LS.editor.addArtboard(pos3.x, pos3.y, a.width, a.height, (a.lsName || '画板') + ' 副本', a.fill);
            LS.editor.fitAllArtboards();
          }
        } },
        { sep: true },
        { label: '删除画板', icon: 'trash', danger: true, action: function () {
          LS.confirm({ title: '删除画板？', message: '画板上的内容会保留，只是不再导出这一块。', okText: '删除' }).then(function (ok) { if (ok) LS.editor.deleteArtboard(id); });
        } }
      ]);
      return;
    }
    var item2 = e.target.closest('.ab-item');
    if (!item2 || !item2.getAttribute('data-abid')) return;
    LS.editor.setActiveArtboard(item2.getAttribute('data-abid'), { noFit: true });
    if (LS.props.showPanel) LS.props.showPanel();
  }

  function renameArtboard(id) {
    var a = LS.editor.artboards().filter(function (x) { return x.lsArtboardId === id; })[0];
    if (!a) return;
    LS.prompt({ title: '重命名画板', label: '画板名称', value: a.lsName || '' }).then(function (v) {
      if (v) LS.editor.updateArtboard(id, { name: v });
    });
  }

  function onAbDblClick(e) {
    var item = e.target.closest('.ab-item');
    if (!item || !item.getAttribute('data-abid')) return;
    LS.editor.setActiveArtboard(item.getAttribute('data-abid'));
    LS.editor.fitArtboard();
  }

  LS.props = {
    init: init,
    renderAll: renderAll,
    renderLayers: renderLayers,
    renderArtboards: renderArtboards,
    renderProps: renderProps,
    getTab: function () { return tab; }
  };
})(window.LS);
