/* 示例项目：SENJA 咖啡灯箱（首次体验 / 视觉检查用） */
(function (LS) {
  'use strict';

  function open() {
    var meta = {
      id: 'demo_senja',
      name: '示例 · SENJA 咖啡灯箱',
      w: 1000, h: 2000,
      dpi: 150,
      bg: '#0b1525',
      transparent: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumb: '',
      artboardCount: 1
    };
    LS.$('#screen-home').classList.remove('active');
    LS.$('#screen-editor').classList.add('active');
    document.title = meta.name + ' · 排版大师';
    LS.editor.open(meta, null);

    var c = LS.editor.canvas();
    var ab = LS.editor.activeArtboard();
    if (!c || !ab) return;
    ab.set('fill', '#0b1525');
    ab.set('shadow', null);

    /* 光晕太阳：径向渐变 */
    var sunGrad = new fabric.Gradient({
      type: 'radial', gradientUnits: 'percentage',
      coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 },
      colorStops: [
        { offset: 0, color: 'rgba(255,224,163,1)' },
        { offset: 0.52, color: 'rgba(255,159,69,.92)' },
        { offset: 1, color: 'rgba(11,21,37,0)' }
      ]
    });
    var sun = new fabric.Circle({
      left: 110, top: 170, radius: 390, fill: sunGrad, opacity: 1,
      lsName: '光晕'
    });
    c.add(sun);

    var ring = new fabric.Circle({
      left: 200, top: 260, radius: 300, fill: null,
      stroke: 'rgba(255,235,200,.45)', strokeWidth: 1.4,
      lsName: '细圆环'
    });
    c.add(ring);

    /* 细边框 */
    var frame = new fabric.Rect({
      left: 52, top: 52, width: 896, height: 1896, rx: 0, ry: 0,
      fill: null, stroke: 'rgba(255,255,255,.20)', strokeWidth: 2,
      lsName: '边框'
    });
    c.add(frame);

    var rule = new fabric.Rect({
      left: 250, top: 1168, width: 500, height: 2,
      fill: 'rgba(255,246,221,.5)', lsName: '横线'
    });
    c.add(rule);

    var titleGrad = new fabric.Gradient({
      type: 'linear', gradientUnits: 'percentage',
      coords: { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
      colorStops: [{ offset: 0, color: '#fff6dd' }, { offset: 1, color: '#ffb347' }]
    });
    var title = new fabric.Textbox('SENJA', {
      left: 70, top: 910, width: 860, fontSize: 240, fontFamily: 'Helvetica Neue',
      fontWeight: '800', charSpacing: -30, lineHeight: 1, textAlign: 'center',
      fill: titleGrad, lsName: 'SENJA'
    });
    c.add(title);

    var sub = new fabric.Textbox('KOPI SUSU', {
      left: 70, top: 1192, width: 860, fontSize: 78, fontFamily: 'Helvetica Neue',
      fontWeight: '600', charSpacing: 90, textAlign: 'center',
      fill: '#ffd9a8', lsName: 'KOPI SUSU'
    });
    c.add(sub);

    var price = new fabric.Textbox('Rp 25.000', {
      left: 70, top: 1310, width: 860, fontSize: 128, fontFamily: 'Helvetica Neue',
      fontWeight: '700', charSpacing: 0, textAlign: 'center',
      fill: '#7ee0dd', lsName: 'Rp 25.000'
    });
    c.add(price);

    var hours = new fabric.Textbox('SETIAP HARI  ·  18.00 – 23.00', {
      left: 70, top: 1500, width: 860, fontSize: 42, fontFamily: 'Helvetica Neue',
      fontWeight: '500', charSpacing: 60, textAlign: 'center',
      fill: '#9fb3d9', lsName: '营业时间'
    });
    c.add(hours);

    var foot = new fabric.Textbox('SENJA COFFEE  ·  JAKARTA', {
      left: 70, top: 1800, width: 860, fontSize: 30, fontFamily: 'Helvetica Neue',
      fontWeight: '500', charSpacing: 120, textAlign: 'center',
      fill: '#6f82a8', lsName: '页脚'
    });
    c.add(foot);

    /* 用布尔运算做一个装饰月牙（两个圆相减） */
    var a = new fabric.Circle({ left: 420, top: 1620, radius: 80, fill: '#0f8f8e', opacity: 1 });
    var b = new fabric.Circle({ left: 462, top: 1598, radius: 80, fill: '#0f8f8e', opacity: 1 });
    c.add(a); c.add(b);
    var res = LS.bool.run([a, b], 'subtract');
    c.remove(a); c.remove(b);
    if (res && res.commands) {
      var moonGrad = new fabric.Gradient({
        type: 'linear', gradientUnits: 'percentage',
        coords: { x1: 0, y1: 0, x2: 1, y2: 1 },
        colorStops: [{ offset: 0, color: '#7ee0dd' }, { offset: 1, color: '#0f8f8e' }]
      });
      var moon = new fabric.Path(res.commands, { fill: moonGrad, opacity: 0.85, lsName: '月牙' });
      c.add(moon);
    }

    /* 小星点 */
    [[612, 1652, 4], [378, 1712, 3]].forEach(function (p) {
      c.add(new fabric.Circle({ left: p[0], top: p[1], radius: p[2], fill: '#ffe0a3', opacity: 0.75, lsName: '星点' }));
    });

    c.getObjects().forEach(function (o) { if (!o.lsArtboard && !o.lsName) o.lsName = '元素'; });
    c.renderAll();
    LS.editor.fitArtboard();
    LS.editor.commitNow();
    LS.editor.saveNow(true).then(function () {
      try { history.replaceState(null, '', '#/p/' + meta.id); } catch (e) { location.hash = '#/p/' + meta.id; }
      LS.toast('示例项目已打开，随便改');
    });
  }

  LS.demo = { open: open };
})(window.LS);
