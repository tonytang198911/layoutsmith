/* 字体：本机常见字体、系统字体扫描、上传字体文件 */
(function (LS) {
  'use strict';

  var COMMON = [
    'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Songti SC', 'Kaiti SC', 'Yuanti SC', 'Lantinghei SC',
    'Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'FangSong',
    'Noto Sans SC', 'Source Han Sans SC', 'HarmonyOS Sans SC', 'MiSans', 'Alibaba PuHuiTi',
    'Helvetica Neue', 'Helvetica', 'Arial', 'Arial Black', 'Avenir Next', 'Avenir', 'SF Pro Text',
    'Inter', 'Roboto', 'Futura', 'Optima', 'Gill Sans', 'Century Gothic', 'Trebuchet MS', 'Verdana', 'Tahoma',
    'Times New Roman', 'Georgia', 'Baskerville', 'Didot', 'Garamond', 'Palatino', 'Rockwell',
    'Courier New', 'Menlo', 'Monaco', 'Impact', 'DIN Alternate', 'DIN Condensed'
  ];

  var extra = [];      // 系统扫描到的字体
  var uploaded = [];   // 上传的字体
  var loaded = false;

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (f) {
      var k = String(f || '').trim();
      if (!k || seen[k.toLowerCase()]) return;
      seen[k.toLowerCase()] = 1;
      out.push(k);
    });
    return out;
  }

  function persistExtra() {
    try { localStorage.setItem('lbs.fontscan', JSON.stringify(extra.slice(0, 400))); } catch (e) {}
  }

  LS.fonts = {
    all: function () {
      return uniq(COMMON.concat(uploaded.map(function (f) { return f.family; })).concat(extra));
    },
    uploadedList: function () { return uploaded.slice(); },

    fill: function () {
      var dl = document.getElementById('font-list');
      if (!dl) return;
      dl.innerHTML = LS.fonts.all().map(function (f) {
        return '<option value="' + LS.esc(f) + '"></option>';
      }).join('');
    },

    init: function () {
      if (loaded) return Promise.resolve();
      loaded = true;
      try {
        var saved = JSON.parse(localStorage.getItem('lbs.fontscan') || '[]');
        if (Array.isArray(saved)) extra = saved;
      } catch (e) {}
      LS.fonts.fill();
      return LS.store.fonts().then(function (list) {
        var tasks = (list || []).map(function (rec) {
          uploaded.push({ id: rec.id, family: rec.family, fileName: rec.fileName });
          if (!rec.data) return null;
          try {
            var face = new FontFace(rec.family, 'url(' + rec.data + ')');
            return face.load().then(function (f) { document.fonts.add(f); }).catch(function () {});
          } catch (e) { return null; }
        });
        return Promise.all(tasks).then(function () { LS.fonts.fill(); });
      }).catch(function () {});
    },

    /* 调用浏览器 Local Font Access API（Chrome/Edge，需要用户点击授权） */
    scan: function () {
      if (!window.queryLocalFonts) {
        LS.toast('这个浏览器不支持读取本机字体，请用 Chrome / Edge，或直接输入字体名', 'warn', 4200);
        return Promise.resolve(false);
      }
      return window.queryLocalFonts().then(function (fonts) {
        var fams = {};
        (fonts || []).forEach(function (f) { if (f.family) fams[f.family] = 1; });
        extra = uniq(extra.concat(Object.keys(fams)));
        persistExtra();
        LS.fonts.fill();
        LS.toast('已读取 ' + Object.keys(fams).length + ' 个本机字体');
        return true;
      }).catch(function (err) {
        if (err && err.name === 'SecurityError') {
          LS.toast('读取本机字体被拒绝，可在浏览器地址栏的权限设置里允许', 'warn', 4000);
        } else {
          LS.toast('读取本机字体失败：' + (err && err.message || ''), 'err');
        }
        return false;
      });
    },

    /* 上传字体文件，加载到当前页面并保存，下次打开还在 */
    upload: function (file) {
      if (!file) return Promise.resolve(false);
      if (file.size > 12 * 1024 * 1024) { LS.toast('字体文件太大（上限 12MB）', 'err'); return Promise.resolve(false); }
      var family = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '自定义字体';
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          var data = reader.result;
          var face;
          try { face = new FontFace(family, 'url(' + data + ')'); } catch (e) { LS.toast('字体文件无法识别', 'err'); resolve(false); return; }
          face.load().then(function (f) {
            document.fonts.add(f);
            var rec = { id: LS.uid('font'), family: family, fileName: file.name, data: data };
            uploaded = uploaded.filter(function (x) { return x.family !== family; });
            uploaded.push({ id: rec.id, family: family, fileName: file.name });
            LS.store.addFont(rec);
            LS.fonts.fill();
            LS.toast('字体「' + family + '」已加载');
            if (LS.editor && LS.editor.applyFont) LS.editor.applyFont(family);
            resolve(family);
          }).catch(function () {
            LS.toast('字体加载失败，可能不是有效的字体文件', 'err');
            resolve(false);
          });
        };
        reader.onerror = function () { resolve(false); };
        reader.readAsDataURL(file);
      });
    }
  };
})(window.LS);
