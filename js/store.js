/* 本地项目存储：IndexedDB（不可用时退回 localStorage） */
(function (LS) {
  'use strict';
  var DB_NAME = 'lightbox_studio', DB_VER = 2;
  var dbp = null, useFallback = false;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('brand')) db.createObjectStore('brand', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('brandAssets')) db.createObjectStore('brandAssets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('brandTemplates')) db.createObjectStore('brandTemplates', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
    return dbp;
  }

  function idbReq(store, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var os = tx.objectStore(store);
        var r = fn(os);
        if (r) {
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error); };
        } else {
          tx.oncomplete = function () { resolve(null); };
        }
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function lsGet(k, fb) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function fallbackList() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf('lbs.meta.') === 0) out.push(lsGet(k, null));
      }
    } catch (e) {}
    return out.filter(Boolean);
  }

  LS.store = {
    ready: function () { return openDB().catch(function () { useFallback = true; }); },
    isFallback: function () { return useFallback; },

    list: function () {
      return openDB().then(function (db) {
        return idbReq('projects', 'readonly', function (s) { return s.getAll(); });
      }).catch(function () { useFallback = true; return fallbackList(); });
    },

    get: function (id) {
      return openDB().then(function (db) {
        return Promise.all([
          idbReq('projects', 'readonly', function (s) { return s.get(id); }),
          idbReq('docs', 'readonly', function (s) { return s.get(id); })
        ]).then(function (r) {
          if (!r[0]) return null;
          return { meta: r[0], doc: r[1] || null };
        });
      }).catch(function () {
        useFallback = true;
        var meta = lsGet('lbs.meta.' + id, null);
        if (!meta) return null;
        return { meta: meta, doc: lsGet('lbs.doc.' + id, null) };
      });
    },

    save: function (meta, doc) {
      meta.updatedAt = Date.now();
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(['projects', 'docs'], 'readwrite');
          tx.objectStore('projects').put(meta);
          if (doc) tx.objectStore('docs').put({ id: meta.id, data: doc });
          tx.oncomplete = function () { resolve(meta); };
          tx.onerror = function () { reject(tx.error); };
        });
      }).catch(function () {
        useFallback = true;
        lsSet('lbs.meta.' + meta.id, meta);
        if (doc) lsSet('lbs.doc.' + meta.id, doc);
        return meta;
      });
    },

    remove: function (id) {
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction(['projects', 'docs'], 'readwrite');
          tx.objectStore('projects').delete(id);
          tx.objectStore('docs').delete(id);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        });
      }).catch(function () {
        localStorage.removeItem('lbs.meta.' + id);
        localStorage.removeItem('lbs.doc.' + id);
        return true;
      });
    },

    updateMeta: function (id, patch) {
      return this.get(id).then(function (r) {
        if (!r) return null;
        Object.assign(r.meta, patch, { updatedAt: Date.now() });
        return LS.store.save(r.meta, r.doc && r.doc.data);
      });
    },

    /* 用户上传的字体，持久化保存 */
    fonts: function () {
      return openDB().then(function () {
        return idbReq('fonts', 'readonly', function (s) { return s.getAll(); });
      }).catch(function () { return lsGet('lbs.fonts', []); });
    },
    addFont: function (rec) {
      return openDB().then(function () {
        return idbReq('fonts', 'readwrite', function (s) { return s.put(rec); });
      }).catch(function () {
        var arr = lsGet('lbs.fonts', []);
        arr.push(rec);
        lsSet('lbs.fonts', arr);
      });
    },

    /* ───── 品牌库 ───── */
    brandGet: function () {
      return openDB().then(function () {
        return idbReq('brand', 'readonly', function (s) { return s.get('brand'); });
      }).catch(function () { return lsGet('lbs.brand', null); });
    },
    brandSave: function (brand) {
      return openDB().then(function () {
        return idbReq('brand', 'readwrite', function (s) { return s.put(brand); });
      }).catch(function () { lsSet('lbs.brand', brand); return brand; });
    },
    assetsList: function () {
      return openDB().then(function () {
        return idbReq('brandAssets', 'readonly', function (s) { return s.getAll(); });
      }).catch(function () { return lsGet('lbs.brand.assets', []); });
    },
    assetAdd: function (rec) {
      return openDB().then(function () {
        return idbReq('brandAssets', 'readwrite', function (s) { return s.put(rec); });
      }).catch(function () {
        var arr = lsGet('lbs.brand.assets', []);
        arr = arr.filter(function (x) { return x.id !== rec.id; });
        arr.push(rec);
        lsSet('lbs.brand.assets', arr);
        return rec;
      });
    },
    assetRemove: function (id) {
      return openDB().then(function () {
        return idbReq('brandAssets', 'readwrite', function (s) { return s.delete(id); });
      }).catch(function () {
        var arr = lsGet('lbs.brand.assets', []).filter(function (x) { return x.id !== id; });
        lsSet('lbs.brand.assets', arr);
      });
    },
    templatesList: function () {
      return openDB().then(function () {
        return idbReq('brandTemplates', 'readonly', function (s) { return s.getAll(); });
      }).catch(function () { return lsGet('lbs.brand.templates', []); });
    },
    templateAdd: function (rec) {
      return openDB().then(function () {
        return idbReq('brandTemplates', 'readwrite', function (s) { return s.put(rec); });
      }).catch(function () {
        var arr = lsGet('lbs.brand.templates', []);
        arr = arr.filter(function (x) { return x.id !== rec.id; });
        arr.push(rec);
        lsSet('lbs.brand.templates', arr);
        return rec;
      });
    },
    templateRemove: function (id) {
      return openDB().then(function () {
        return idbReq('brandTemplates', 'readwrite', function (s) { return s.delete(id); });
      }).catch(function () {
        var arr = lsGet('lbs.brand.templates', []).filter(function (x) { return x.id !== id; });
        lsSet('lbs.brand.templates', arr);
      });
    }
  };

})(window.LS);
