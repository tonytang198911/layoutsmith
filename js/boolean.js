/* 路径查找器：用 paper.js 做真正的布尔运算（曲线保留） */
(function (LS) {
  'use strict';
  var scope = null;

  function P() {
    if (!scope) {
      scope = new paper.PaperScope();
      scope.setup(new scope.Size(1, 1));
    }
    return scope;
  }

  function mat(obj) {
    var m = obj.calcTransformMatrix();
    return new (P().Matrix)(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  /* fabric path 指令 → paper 段（局部坐标，已减去 pathOffset） */
  function pathFromFabric(obj) {
    var p = P(), po = obj.pathOffset || { x: 0, y: 0 };
    var children = [], segs = null, closed = false;

    function flush() {
      if (segs && segs.length > 1) {
        children.push(new p.Path({ segments: segs, closed: closed, insert: false }));
      }
      segs = null;
    }
    function add(x, y, inX, inY, outX, outY) {
      var s = new p.Segment(new p.Point(x - po.x, y - po.y));
      if (inX != null) s.handleIn = new p.Point(inX - (x - po.x), inY - (y - po.y));
      if (outX != null) s.handleOut = new p.Point(outX - (x - po.x), outY - (y - po.y));
      segs.push(s);
      return s;
    }
    function last() { return segs[segs.length - 1]; }

    obj.path.forEach(function (c) {
      var cmd = c[0];
      if (cmd === 'M') {
        flush();
        segs = [];
        closed = false;
        add(c[1], c[2]);
      } else if (cmd === 'L') {
        if (!segs) { segs = []; }
        add(c[1], c[2]);
      } else if (cmd === 'C') {
        if (!segs || !segs.length) return;
        var prev = last();
        prev.handleOut = new p.Point(c[1] - prev.point.x, c[2] - prev.point.y);
        var seg = add(c[5], c[6]);
        seg.handleIn = new p.Point(c[3] - seg.point.x, c[4] - seg.point.y);
      } else if (cmd === 'Q') {
        if (!segs || !segs.length) return;
        var p0 = last().point, qx = c[1] - po.x, qy = c[2] - po.y,
            ex = c[3] - po.x, ey = c[4] - po.y;
        last().handleOut = new p.Point((qx - p0.x) * 2 / 3, (qy - p0.y) * 2 / 3);
        var s2 = add(c[3], c[4]);
        s2.handleIn = new p.Point((qx - ex) * 2 / 3, (qy - ey) * 2 / 3);
      } else if (cmd === 'Z' || cmd === 'z') {
        closed = true;
        flush();
      }
    });
    flush();
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    return new p.CompoundPath({ children: children, insert: false });
  }

  function buildPath(obj) {
    var p = P();
    if (!obj || obj.type === 'activeSelection') return null;
    if (obj.type === 'group') {
      var parts = [];
      (obj._objects || []).forEach(function (child) {
        var c = buildPath(child);
        if (c) parts.push(c);
      });
      if (!parts.length) return null;
      var merged = parts[0];
      for (var i = 1; i < parts.length; i++) {
        try { merged = merged.unite(parts[i], { insert: false }); } catch (e) { return null; }
        if (!merged) return null;
      }
      return merged;
    }
    if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'image' || obj.type === 'line') return null;

    var path = null;
    var w = obj.width || 0, h = obj.height || 0;

    if (obj.type === 'rect') {
      var rx = Math.min(obj.rx || 0, w / 2), ry = Math.min(obj.ry || 0, h / 2);
      var r = Math.min(rx || ry || 0, Math.min(w, h) / 2);
      path = new p.Path.Rectangle({ point: [-w / 2, -h / 2], size: [w, h], radius: r, insert: false });
    } else if (obj.type === 'ellipse' || obj.type === 'circle') {
      path = new p.Path.Ellipse({ center: [0, 0], radius: [w / 2, h / 2], insert: false });
    } else if (obj.type === 'triangle') {
      path = new p.Path({ segments: [[-w / 2, h / 2], [0, -h / 2], [w / 2, h / 2]], closed: true, insert: false });
    } else if (obj.type === 'polygon' || obj.type === 'polyline') {
      var po = obj.pathOffset || { x: 0, y: 0 };
      var pts = (obj.points || []).map(function (pt) { return [pt.x - po.x, pt.y - po.y]; });
      if (pts.length < 3) return null;
      path = new p.Path({ segments: pts, closed: true, insert: false });
    } else if (obj.type === 'path') {
      path = pathFromFabric(obj);
    }
    if (!path) return null;
    if (path.closed === false && path.segments) path.closed = true;
    if (path.children) path.children.forEach(function (c) { c.closed = true; });
    path.transform(mat(obj));
    return path;
  }

  /* paper 结果 → fabric 绝对坐标路径指令 */
  function toFabricCommands(item) {
    var cmds = [];
    var paths = item.children ? item.children.slice() : [item];
    paths.forEach(function (path) {
      var segs = path.segments || [];
      if (!segs.length) return;
      cmds.push(['M', segs[0].point.x, segs[0].point.y]);
      for (var i = 1; i < segs.length; i++) {
        var prev = segs[i - 1], seg = segs[i];
        var c1 = prev.handleOut, c2 = seg.handleIn;
        if ((!c1 || c1.isZero()) && (!c2 || c2.isZero())) {
          cmds.push(['L', seg.point.x, seg.point.y]);
        } else {
          cmds.push(['C', prev.point.x + c1.x, prev.point.y + c1.y,
            seg.point.x + c2.x, seg.point.y + c2.y, seg.point.x, seg.point.y]);
        }
      }
      if (path.closed && segs.length > 1) {
        var last = segs[segs.length - 1], first = segs[0];
        if (!last.handleOut.isZero() || !first.handleIn.isZero()) {
          cmds.push(['C', last.point.x + last.handleOut.x, last.point.y + last.handleOut.y,
            first.point.x + first.handleIn.x, first.point.y + first.handleIn.y,
            first.point.x, first.point.y]);
        }
        cmds.push(['Z']);
      }
    });
    return cmds;
  }

  LS.bool = {
    supports: function (obj) {
      return !!obj && ['rect', 'ellipse', 'circle', 'triangle', 'polygon', 'polyline', 'path', 'group'].indexOf(obj.type) >= 0;
    },

    /* 按 z 从低到高传入对象，op: unite|subtract|intersect|exclude */
    run: function (objs, op) {
      var p = P();
      var built = [];
      for (var i = 0; i < objs.length; i++) {
        var path = buildPath(objs[i]);
        if (!path) return { error: '「' + (objs[i].lsName || objs[i].type) + '」不是封闭的矢量图形，无法参与运算' };
        built.push(path);
      }
      if (built.length < 2) return { error: '至少选择两个图形' };
      var res = built[0], j;
      try {
        for (j = 1; j < built.length; j++) {
          if (op === 'unite') res = res.unite(built[j], { insert: false });
          else if (op === 'subtract') res = res.subtract(built[j], { insert: false });
          else if (op === 'intersect') res = res.intersect(built[j], { insert: false });
          else if (op === 'exclude') res = res.exclude(built[j], { insert: false });
          if (!res) return { error: '运算结果为空' };
        }
      } catch (e) {
        return { error: '运算失败：' + (e && e.message || e) };
      }
      var cmds = toFabricCommands(res);
      if (!cmds.length) return { error: '运算结果为空' };
      return { commands: cmds };
    }
  };
})(window.LS);
