// ==UserScript==
// @name         FB & Messenger Focus Locker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  none
// @author       Ein
// @match        *://*.facebook.com/*
// @match        *://facebook.com/*
// @match        *://*.messenger.com/*
// @match        *://messenger.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(async function () {
  'use strict';

  // --- config ---
  const LOCK_KEY = 'tm_fb_lock_until_v1'; // stores epoch ms when lock ends
  const CHECK_INTERVAL_MS = 1000;
  const WIDGET_SIZE_PX = 170;

  // --- helpers for GM storage (async) ---
  async function getLockUntil() {
    try { return Number(await GM_getValue(LOCK_KEY, 0)) || 0; }
    catch (e) { console.error('GM_getValue error', e); return 0; }
  }
  function setLockUntil(ms) {
    try { return GM_setValue(LOCK_KEY, Number(ms) || 0); }
    catch (e) { console.error('GM_setValue error', e); }
  }
  function clearLock() { setLockUntil(0); }

  function now() { return Date.now(); }
  function msToMMSS(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // --- create floating widget (bottom-left) ---
  const widget = document.createElement('div');
  widget.id = 'tm-focus-lock-widget';
  Object.assign(widget.style, {
    position: 'fixed',
    left: '16px',
    bottom: '16px',
    width: `${WIDGET_SIZE_PX}px`,
    padding: '10px',
    background: 'rgba(0,0,0,0.7)',
    color: 'white',
    'font-family': 'Arial, sans-serif',
    'font-size': '13px',
    'border-radius': '8px',
    'z-index': 2147483646, // just below overlay
    display: 'flex',
    'flex-direction': 'column',
    gap: '8px',
    'box-shadow': '0 6px 18px rgba(0,0,0,0.5)',
  });

  widget.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong style="font-size:13px">Focus Lock</strong>
      <span id="tm-widget-dot" style="width:10px;height:10px;border-radius:50%;background:#faa;display:inline-block;"></span>
    </div>
    <div id="tm-widget-controls" style="display:flex;gap:6px;align-items:center;">
      <input id="tm-min-input" type="number" min="1" placeholder="phút" style="flex:1;padding:6px;border-radius:6px;border:0;outline:none;font-size:13px">
      <button id="tm-lock-btn" style="padding:6px 8px;border-radius:6px;border:0;cursor:pointer;background:#2d88ff;color:white">Lock</button>
    </div>
    <div id="tm-widget-status" style="font-size:12px;color:#ddd">Ready</div>
  `;

  document.documentElement.appendChild(widget);

  const minInput = document.getElementById('tm-min-input');
  const lockBtn = document.getElementById('tm-lock-btn');
  const statusEl = document.getElementById('tm-widget-status');
  const dotEl = document.getElementById('tm-widget-dot');

  // --- overlay that blocks the entire page ---
  let overlay = null;
  function createOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tm-focus-lock-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      'background-color': 'rgba(0,0,0,0.97)',
      color: 'white',
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'center',
      'justify-content': 'center',
      'z-index': 2147483647,
      'font-family': 'Arial, sans-serif',
      'font-size': '20px',
      'text-align': 'center',
      'pointer-events': 'auto',
      'user-select': 'none',
    });

    overlay.innerHTML = `
      <div style="max-width:90%;padding:20px;">
        <div id="tm-overlay-message" style="font-size:26px;margin-bottom:12px">Screen locked</div>
        <div id="tm-overlay-countdown" style="font-size:48px;font-weight:600;margin-bottom:18px">00:00</div>
        <div style="font-size:14px;opacity:0.9;margin-bottom:18px">Để tập trung — Facebook & Messenger đang bị khóa</div>
        <div>
          <button id="tm-overlay-unlock" style="padding:10px 16px;border-radius:8px;border:0;cursor:pointer;background:#444;color:white;font-size:14px">Unlock sớm</button>
        </div>
      </div>
    `;

    // prevent keyboard / mouse from interacting with background
    overlay.addEventListener('keydown', (e) => e.stopPropagation(), true);
    overlay.addEventListener('keyup', (e) => e.stopPropagation(), true);
    overlay.addEventListener('keypress', (e) => e.stopPropagation(), true);
    overlay.addEventListener('click', (e) => e.stopPropagation(), true);
    overlay.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    overlay.addEventListener('mouseup', (e) => e.stopPropagation(), true);
    document.body.appendChild(overlay);

    // Unlock button inside overlay (ask confirmation)
    const unlockBtn = document.getElementById('tm-overlay-unlock');
    unlockBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const ok = confirm('Bạn có chắc muốn mở sớm? (thao tác này sẽ hủy lock hiện tại)');
      if (ok) {
        clearLock();
        // other tabs will pick this up
        updateUI(); // local update
      }
    });

    // lock focus inside overlay
    overlay.tabIndex = -1;
    overlay.focus();
    try { document.documentElement.style.overflow = 'hidden'; } catch (e) {}
    return overlay;
  }

  function removeOverlay() {
    if (!overlay) return;
    try { document.documentElement.style.overflow = ''; } catch (e) {}
    overlay.remove();
    overlay = null;
  }

  // --- UI update based on lock state ---
  let intervalId = null;

  async function refreshOnce() {
    const lockUntil = await getLockUntil();
    const remaining = Math.max(0, lockUntil - now());

    if (remaining > 0) {
      // show overlay
      createOverlay();
      const cd = document.getElementById('tm-overlay-countdown');
      if (cd) cd.textContent = msToMMSS(remaining);
      const msg = document.getElementById('tm-overlay-message');
      if (msg) msg.textContent = `Còn ${msToMMSS(remaining)} nữa`;
      // widget: show locked state
      statusEl.textContent = `Đang khóa — ${msToMMSS(remaining)}`;
      minInput.disabled = true;
      lockBtn.disabled = true;
      dotEl.style.background = '#4caf50';
    } else {
      // not locked: remove overlay
      removeOverlay();
      statusEl.textContent = 'Sẵn sàng';
      minInput.disabled = false;
      lockBtn.disabled = false;
      dotEl.style.background = '#faa';
      // ensure lock cleared
      if (lockUntil !== 0) { // fix possible weird states
        await setLockUntil(0);
      }
    }
  }

  async function startPolling() {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(refreshOnce, CHECK_INTERVAL_MS);
    // run immediate
    await refreshOnce();
  }

  // --- listening for changes from other tabs ---
  if (typeof GM_addValueChangeListener === 'function') {
    try {
      GM_addValueChangeListener(LOCK_KEY, async (name, oldValue, newValue, remote) => {
        // other tab changed the lock
        await refreshOnce();
      });
    } catch (e) {
      // ignore if not supported
    }
  }

  // --- lock button handler ---
  lockBtn.addEventListener('click', async () => {
    const v = Number(minInput.value);
    if (!v || v <= 0) {
      alert('Nhập số phút hợp lệ (>=1).');
      return;
    }
    const minutes = Math.floor(v);
    const until = now() + minutes * 60 * 1000;
    await setLockUntil(until);
    // immediate apply
    await refreshOnce();
  });

  // optional: allow Enter to lock
  minInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lockBtn.click(); }
  });

  // start
  startPolling();

  // clean up on unload
  window.addEventListener('unload', () => {
    if (intervalId) clearInterval(intervalId);
  });

})();
