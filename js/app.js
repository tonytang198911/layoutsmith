/* 启动与路由 */
(function (LS) {
  'use strict';

  function route() {
    var m = /^#\/p\/(.+)$/.exec(location.hash || '');
    if (m) LS.home.openProject(decodeURIComponent(m[1]));
    else LS.home.show();
  }

  function initLeftSplitter() {
    var left = document.querySelector('.leftpanel');
    var split = document.getElementById('left-splitter');
    if (!left || !split) return;
    var KEY = 'lbs.left_w';
    var min = 176, max = 480;
    try {
      var saved = parseFloat(localStorage.getItem(KEY));
      if (isFinite(saved) && saved > 0) left.style.width = Math.round(Math.min(Math.max(saved, min), max)) + 'px';
    } catch (e) {}
    function setW(w) {
      w = Math.round(Math.min(Math.max(w, min), max));
      left.style.width = w + 'px';
      return w;
    }
    split.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var startX = e.clientX;
      var startW = left.getBoundingClientRect().width;
      document.body.classList.add('left-resizing');
      function move(ev) {
        if (ev.cancelable) ev.preventDefault();
        setW(startW + (ev.clientX - startX));
      }
      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        document.body.classList.remove('left-resizing');
        try { localStorage.setItem(KEY, String(Math.round(left.getBoundingClientRect().width))); } catch (e2) {}
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
    split.addEventListener('dblclick', function () {
      left.style.width = '';
      try { localStorage.removeItem(KEY); } catch (e) {}
      LS.toast('左侧面板已恢复默认宽度');
    });
  }

  function boot() {
    LS.props.init();
    LS.exporter.init();
    LS.home.init();
    LS.fonts.init();
    if (LS.ai) LS.ai.init();
    if (LS.brand) LS.brand.init();
    initLeftSplitter();
    window.addEventListener('hashchange', route);
    LS.store.ready().then(function () {
      if (LS.store.isFallback()) {
        LS.toast('浏览器存储不可用，改用 localStorage（空间有限）；建议用本地启动脚本打开', 'warn', 6000);
      }
    });
    if (location.protocol === 'file:') {
      LS.toast('建议用文件夹里的「启动」脚本打开，浏览器直接打开文件可能无法保存项目', 'warn', 6000);
    }
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('error', function (e) {
    if (window.console) console.error('[Layoutsmith]', e.error || e.message);
  });
})(window.LS);
