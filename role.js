/*
 * Formulary role layer — runtime patch over the built bundle.
 *
 * The repository ships only the production build (no source), so the
 * role-based screens from the product plan are implemented here as a
 * small, isolated layer loaded after the bundle:
 *
 *   - roles: "owner" (final approver) and "carla" (triage user); the
 *     pre-existing read-only guest behaviour is left untouched.
 *   - owner sees ONLY the feedback queue: lots Carla approved (awaiting
 *     the final "okay robot, send it") and lots with her unanswered
 *     corrections (text or audio). The triage tabs are hidden for owner.
 *   - new gate status `awaiting_final` between Carla's approval and the
 *     robot executing: Carla's "approve" routes lots there instead of
 *     straight to done.
 *   - guardrails: owner cannot open the triage inbox; Carla cannot send
 *     final approvals.
 *
 * Everything is DOM- and storage-based so no minified code is edited.
 */
(function () {
  'use strict';

  var ROLE_KEY = 'formulary.role';
  var REVIEW_KEY = 'formulary.review'; // lotId -> { status: 'awaiting_final', feedback: [...] }
  var ROLES = ['owner', 'carla'];
  var SHARED_REVIEW_PATH = 'formulary/review-queue';
  var SUPABASE_URL = 'https://mboycjejyokkkaddcwng.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_cR79ASnMFlN25oz3v4TFIg_Jd0XTcsI';
  var reviewCache = null;
  var sharedSave = Promise.resolve();

  /* ---------------- role resolution ---------------- */

  function storedRole() {
    try {
      var r = localStorage.getItem(ROLE_KEY);
      return ROLES.indexOf(r) >= 0 ? r : null;
    } catch (e) {
      return null;
    }
  }

  function saveRole(role) {
    try {
      localStorage.setItem(ROLE_KEY, role);
    } catch (e) {
      /* private mode: role picker simply re-appears next launch */
    }
  }

  /* First run: ask who is signing in, once per device. Returning users
   * skip the picker. Guests (read-only pairing) never get a role and
   * fall through to the untouched guest experience. */
  function resolveRole(cb) {
    var r = storedRole();
    if (r) return cb(r);

    var wrap = document.createElement('div');
    wrap.id = 'formulary-role-gate';
    wrap.innerHTML =
      '<div class="frg-card" role="dialog" aria-modal="true" aria-label="Who is signing in?">' +
      '<p class="frg-kicker">formulary</p>' +
      '<h1 class="frg-title">who is signing in on this device?</h1>' +
      '<button type="button" class="frg-btn" data-role="carla">Carla — triage the mail</button>' +
      '<button type="button" class="frg-btn" data-role="owner">Owner — final approvals</button>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-role]');
      if (!b) return;
      var role = b.getAttribute('data-role');
      saveRole(role);
      wrap.remove();
      cb(role);
    });
  }

  /* ---------------- review state (awaiting_final gate) ---------------- */

  function loadReview() {
    if (reviewCache) return reviewCache;
    try {
      reviewCache = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}');
    } catch (e) {
      reviewCache = {};
    }
    return reviewCache;
  }

  function saveReview(state) {
    reviewCache = state;
    try {
      localStorage.setItem(REVIEW_KEY, JSON.stringify(state));
    } catch (e) {
      /* best effort; queue simply won't persist across reloads */
    }
    sharedSave = sharedSave.then(function () {
      var session;
      try {
        session = JSON.parse(localStorage.getItem('formulary.auth') || 'null');
      } catch (e) {
        return;
      }
      if (!session || !session.access_token) return;
      return fetch(SUPABASE_URL + '/rest/v1/docs?on_conflict=path', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          path: SHARED_REVIEW_PATH,
          doc: state,
          updated_at: new Date().toISOString(),
        }),
      }).catch(function () {});
    });
  }

  function refreshSharedReview() {
    var session;
    try {
      session = JSON.parse(localStorage.getItem('formulary.auth') || 'null');
    } catch (e) {
      return Promise.resolve();
    }
    if (!session || !session.access_token) return Promise.resolve();
    return sharedSave.then(function () {
      var url = new URL(SUPABASE_URL + '/rest/v1/docs');
      url.searchParams.set('path', 'eq.' + SHARED_REVIEW_PATH);
      url.searchParams.set('select', 'doc');
      return fetch(url.toString(), {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + session.access_token,
        },
      })
        .then(function (response) {
          if (!response.ok) return null;
          return response.json();
        })
        .then(function (rows) {
          if (!rows || !rows.length || !rows[0].doc || typeof rows[0].doc !== 'object') return;
          reviewCache = rows[0].doc;
          try {
            localStorage.setItem(REVIEW_KEY, JSON.stringify(reviewCache));
          } catch (e) {
            /* best effort */
          }
          renderOwnerQueue();
        })
        .catch(function () {});
    });
  }

  function currentLotId() {
    // lot screens render an id in the lot header (wc "id" prop)
    var el = document.querySelector('[class*="_lotbar_"] [class*="_lot_"], [class*="_lotbar_"]');
    if (!el) return null;
    // header renders "lot <id>"; strip the label before matching the id
    var text = (el.textContent || '').replace(/^\s*lot\s+/i, '');
    var m = text.match(/[0-9a-f-]{6,}/i);
    return m ? m[0] : text.trim() || null;
  }

  function setAwaitingFinal(lotId, note) {
    if (!lotId) return;
    var state = loadReview();
    state[lotId] = state[lotId] || { feedback: [] };
    state[lotId].status = 'awaiting_final';
    state[lotId].at = new Date().toISOString();
    if (note) state[lotId].feedback.push({ kind: 'note', text: note, at: state[lotId].at });
    saveReview(state);
  }

  function recordFeedback(lotId, kind, payload) {
    if (!lotId) return;
    var state = loadReview();
    state[lotId] = state[lotId] || { feedback: [] };
    state[lotId].status = 'awaiting_final';
    state[lotId].at = new Date().toISOString();
    state[lotId].feedback.push({ kind: kind, payload: payload || null, at: state[lotId].at });
    saveReview(state);
  }

  function clearLot(lotId) {
    var state = loadReview();
    if (state[lotId]) {
      delete state[lotId];
      saveReview(state);
    }
  }

  /* ---------------- shared DOM helpers ---------------- */

  function tabsEl() {
    return document.querySelector('[class*="_tabs_"]');
  }
  function rowsEl() {
    return document.querySelector('[class*="_rows_"]');
  }
  function onLotScreen() {
    return !!document.querySelector('[class*="_lotbar_"]');
  }

  function injectStyles() {
    if (document.getElementById('formulary-role-css')) return;
    var s = document.createElement('style');
    s.id = 'formulary-role-css';
    s.textContent =
      '#formulary-role-gate{position:fixed;inset:0;z-index:90;background:#F2EFE7;display:flex;align-items:center;justify-content:center;padding:24px}' +
      '#formulary-role-gate .frg-card{max-width:420px;width:100%;font-family:Archivo,system-ui,sans-serif;color:#14120f}' +
      '#formulary-role-gate .frg-kicker{font:700 12px/1 "Courier Prime",monospace;letter-spacing:.14em;text-transform:uppercase;opacity:.6;margin:0 0 8px}' +
      '#formulary-role-gate .frg-title{font-size:22px;font-weight:800;margin:0 0 20px}' +
      '#formulary-role-gate .frg-btn{display:block;width:100%;text-align:left;margin:8px 0;padding:14px 16px;border:1.5px solid #14120f;background:transparent;font:700 15px Archivo,system-ui,sans-serif;color:#14120f;cursor:pointer;border-radius:2px}' +
      '#formulary-role-gate .frg-btn:active{background:#14120f;color:#F2EFE7}' +
      '.fr-owner-banner{font:700 12px/1.4 "Courier Prime",monospace;letter-spacing:.08em;text-transform:uppercase;padding:10px 16px;border-bottom:1.5px solid #14120f;color:#14120f}' +
      '.fr-owner-empty{padding:32px 24px;font:400 14px/1.6 "Courier Prime",monospace;color:#14120f;opacity:.75}' +
      '.fr-owner-item{display:block;width:100%;text-align:left;padding:14px 16px;border:0;border-bottom:1.5px solid #14120f;background:transparent;font:600 15px/1.4 Archivo,system-ui,sans-serif;color:#14120f;cursor:pointer}' +
      '.fr-owner-item small{display:block;font:400 12px/1.5 "Courier Prime",monospace;opacity:.7;margin-top:4px}' +
      '.fr-hidden{display:none !important}';
    document.head.appendChild(s);
  }

  /* ---------------- carla's view ---------------- */

  /* Carla keeps the triage inbox. Two behaviour changes:
   * 1. approving a lot routes it to `awaiting_final` (owner gate)
   *    instead of straight to execution;
   * 2. corrections (text or voice) are recorded as owner feedback. */
  function enhanceCarla() {
    // intercept approvals at the detail screen: the bundle's primary
    // action there is "mark as done"; we tag the lot before letting the
    // click through so the owner queue picks it up on her device.
    document.addEventListener(
      'click',
      function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var label = (btn.textContent || '').trim().toLowerCase();
        var lotId = currentLotId();

        if (label === 'mark as done' || label === 'mark as completed') {
          setAwaitingFinal(lotId);
        } else if (label === 'hand back with instructions' || label === 'edit the instructions') {
          recordFeedback(lotId, 'correction-opened');
        } else if (label === 'request changes →') {
          recordFeedback(lotId, 'correction');
        } else if (label === 'start recording' || label === 'record more' || label === 're-record') {
          recordFeedback(lotId, 'audio');
        }
      },
      true // capture: tag before the bundle's own handler runs
    );
  }

  /* ---------------- owner's view ---------------- */

  var ownerPanel = null;

  function ownerQueueItems() {
    var state = loadReview();
    return Object.keys(state)
      .filter(function (id) {
        return state[id] && state[id].status === 'awaiting_final';
      })
      .map(function (id) {
        return { id: id, info: state[id] };
      })
      .sort(function (a, b) {
        return (b.info.at || '').localeCompare(a.info.at || '');
      });
  }

  function feedbackSummary(info) {
    var parts = [];
    (info.feedback || []).forEach(function (f) {
      if (f.kind === 'audio') parts.push('voice note');
      else if (f.kind === 'correction' || f.kind === 'correction-opened') parts.push('written correction');
      else if (f.kind === 'note' && f.text) parts.push(f.text);
    });
    var seen = {};
    return parts
      .filter(function (p) {
        if (seen[p]) return false;
        seen[p] = true;
        return true;
      })
      .join(' · ');
  }

  function renderOwnerQueue() {
    if (!ownerPanel) return;
    var items = ownerQueueItems();
    if (!items.length) {
      ownerPanel.innerHTML =
        '<div class="fr-owner-banner">final approvals</div>' +
        '<div class="fr-owner-empty">nothing waiting on you.</div>';
      return;
    }
    var html = '<div class="fr-owner-banner">final approvals · ' + items.length + '</div>';
    items.forEach(function (it) {
      var fb = feedbackSummary(it.info);
      html +=
        '<button type="button" class="fr-owner-item" data-lot="' +
        escapeAttr(it.id) +
        '">' +
        escapeHtml('lot ' + shortId(it.id)) +
        (fb ? '<small>' + escapeHtml(fb) + '</small>' : '<small>approved by carla · awaiting your ok</small>') +
        '</button>';
    });
    ownerPanel.innerHTML = html;
  }

  function shortId(id) {
    return id.length > 8 ? id.slice(0, 8) : id;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  /* Owner guardrails + feedback queue:
   * - triage tabs hidden (owner never sees the raw inbox queues)
   * - lot rows replaced by the awaiting_final / feedback queue
   * - on a lot screen, "send" is the final approval; Carla's triage
   *   actions (hand back, discard) are not offered to the owner. */
  function enhanceOwner() {
    var tabs = tabsEl();
    if (tabs) tabs.classList.add('fr-hidden');

    var rows = rowsEl();
    if (rows && !ownerPanel) {
      ownerPanel = document.createElement('div');
      ownerPanel.id = 'formulary-owner-queue';
      rows.parentNode.insertBefore(ownerPanel, rows);
    }
    if (rows) rows.classList.add('fr-hidden');
    renderOwnerQueue();

    // detail screen: strip triage-only actions, mark the final send
    if (onLotScreen()) {
      document.querySelectorAll('button').forEach(function (btn) {
        var label = (btn.textContent || '').trim().toLowerCase();
        if (
          label === 'hand back with instructions' ||
          label === 'edit the instructions' ||
          label === 'file without approving' ||
          label === 'discard lot' ||
          label === 'start recording' ||
          label === 'record more'
        ) {
          btn.classList.add('fr-hidden');
        } else if (label === 'mark as done' || label === 'mark as completed') {
          btn.textContent = 'okay robot, send it';
          btn.dataset.frFinal = '1';
        }
      });
    }
  }

  // owner final approval clears the gate
  function bindOwnerActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var label = (btn.textContent || '').trim().toLowerCase();
      if (btn.dataset.frFinal === '1' || label === 'okay robot, send it') {
        clearLot(currentLotId());
        renderOwnerQueue();
      }
    });
  }

  /* ---------------- routing ---------------- */

  function applyRole(role) {
    injectStyles();
    if (role === 'owner') {
      enhanceOwner();
      bindOwnerActions();
      refreshSharedReview();
      window.setInterval(function () {
        if (!document.hidden) refreshSharedReview();
      }, 5000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refreshSharedReview();
      });
    } else if (role === 'carla') {
      enhanceCarla();
    }
    // guests: nothing — pre-existing read-only behaviour is untouched
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    resolveRole(function (role) {
      applyRole(role);

      // the app is a SPA: re-apply the owner guardrails whenever the
      // view changes (tab switches, lot open/close re-render the DOM)
      if (role === 'owner') {
        var scheduled = false;
        new MutationObserver(function () {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(function () {
            scheduled = false;
            enhanceOwner();
          });
        }).observe(document.getElementById('root') || document.body, {
          childList: true,
          subtree: true,
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
