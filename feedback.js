/**
 * Convert-to-PDF feedback widget.
 * Talks to the shared Apps Script backend defined in google-apps-script/feedback-backend.gs
 *
 * After deploying the Apps Script web app, paste its /exec URL into FEEDBACK_ENDPOINT below.
 */

const FEEDBACK_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzgIwblyMQv4O8GypUMT7xfj8Xkv6W2oyCFxZVcUExwpWhHr_7WWXQlvi2tfzjXisu4Ww/exec';
const APP_ID = 'converttopdf';
const OWNER_NAME = 'Yanis (creator)';
const THIRD_PARTY_ERROR_PATTERNS = [
  /googlesyndication|google-analytics|googletagmanager|doubleclick|adservice|adsbygoogle/i,
  /chrome-extension:|moz-extension:|safari-extension:|extension:|extensions\//i,
  /safeframe|recaptcha|user-sync|usersync|sync\?|pixel\.|beacon/i,
  /ResizeObserver loop limit exceeded|Script error\.?/i,
];

let cachedHistory = [];
let showAllHistory = false;

function feedbackReady() {
  const trigger = document.getElementById('cv-feedback-trigger');
  const panel = document.getElementById('cv-feedback-panel');
  const closeBtn = document.getElementById('cv-feedback-close');
  const form = document.getElementById('cv-feedback-form');
  const showMore = document.getElementById('cv-feedback-show-more');
  if (!trigger || !panel || !form) return;

  trigger.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('cv-feedback-panel--open');
    trigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) loadFeedback();
  });

  closeBtn?.addEventListener('click', () => {
    panel.classList.remove('cv-feedback-panel--open');
    trigger.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('cv-feedback-panel--open')) {
      panel.classList.remove('cv-feedback-panel--open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitFeedback(form);
  });

  showMore?.addEventListener('click', () => {
    showAllHistory = !showAllHistory;
    renderFeedbackList(cachedHistory);
  });
}

function setStatus(msg, kind) {
  const el = document.getElementById('cv-feedback-status');
  if (!el) return;
  el.textContent = msg || '';
  el.dataset.kind = kind || '';
}

async function submitFeedback(form) {
  const fd = new FormData(form);
  const data = {
    app: APP_ID,
    name: String(fd.get('name') || '').trim(),
    email: String(fd.get('email') || '').trim(),
    message: String(fd.get('message') || '').trim(),
    isPrivate: fd.get('private') === 'on',
    website: String(fd.get('website') || ''),
  };

  if (data.website) return;

  if (data.message.length < 5) {
    setStatus('Tell us a bit more — at least a few words.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    setStatus('Please enter a valid email so we can reply.', 'error');
    return;
  }
  if (!FEEDBACK_ENDPOINT) {
    setStatus('Feedback endpoint is not configured yet.', 'error');
    return;
  }

  const btn = form.querySelector('button[type=submit]');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  setStatus('Sending…');

  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    if (json && json.ok === false) throw new Error(json.error || 'submit failed');

    setStatus('Thanks! Your message reached us.', 'success');
    form.reset();
    if (typeof gtag !== 'undefined') {
      gtag('event', 'feedback_submitted', { app: APP_ID });
    }
    setTimeout(loadFeedback, 1500);
  } catch (err) {
    console.warn('feedback submit error', err);
    setStatus('Could not send. Please try again in a moment.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function loadFeedback() {
  if (!FEEDBACK_ENDPOINT) {
    renderFeedbackList([], true);
    return;
  }
  try {
    const res = await fetch(`${FEEDBACK_ENDPOINT}?app=${encodeURIComponent(APP_ID)}`, { cache: 'no-store' });
    const items = await res.json();
    cachedHistory = Array.isArray(items) ? items.slice().reverse() : [];
    renderFeedbackList(cachedHistory);
  } catch (err) {
    console.warn('feedback load error', err);
    renderFeedbackList([], true);
  }
}

function renderFeedbackList(items, hadError) {
  const list = document.getElementById('cv-feedback-list');
  const empty = document.getElementById('cv-feedback-empty');
  const showMore = document.getElementById('cv-feedback-show-more');
  if (!list) return;

  const visible = items.filter((i) => i.message && !isPrivateFeedback(i));
  const slice = showAllHistory ? visible : visible.slice(0, 3);

  list.innerHTML = '';
  if (!slice.length) {
    if (empty) {
      empty.style.display = 'block';
      empty.textContent = hadError ? 'Could not load feedback right now.' : 'No feedback yet — be the first.';
    }
    if (showMore) showMore.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';

  slice.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'cv-feedback-item';

    const msg = document.createElement('div');
    msg.className = 'cv-feedback-item__msg';
    msg.textContent = entry.message;
    li.appendChild(msg);

    const meta = document.createElement('div');
    meta.className = 'cv-feedback-item__meta';
    meta.textContent = formatMeta(entry);
    li.appendChild(meta);

    if (entry.ownerReply) {
      const reply = document.createElement('div');
      reply.className = 'cv-feedback-item__owner-reply';
      const tag = document.createElement('span');
      tag.className = 'cv-feedback-item__owner-tag';
      tag.textContent = 'Reply from ' + OWNER_NAME;
      const txt = document.createElement('div');
      txt.textContent = entry.ownerReply;
      reply.appendChild(tag);
      reply.appendChild(txt);
      li.appendChild(reply);
    }
    list.appendChild(li);
  });

  if (showMore) {
    showMore.style.display = visible.length > 3 ? 'inline-block' : 'none';
    showMore.textContent = showAllHistory ? 'Show fewer' : `Show all (${visible.length})`;
  }
}

function isPrivateFeedback(entry) {
  if (!entry) return false;
  if (entry.isPrivate === true || entry.private === true) return true;
  const flag = String(entry.isPrivate ?? entry.private ?? '').trim().toLowerCase();
  return flag === 'true' || flag === 'yes' || flag === '1';
}

function formatMeta(entry) {
  const d = entry.timestamp ? new Date(entry.timestamp) : null;
  const when = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const name = entry.name && entry.name.trim() ? entry.name.trim() : 'Anonymous';
  return [name, when].filter(Boolean).join(' · ');
}

function normalizeError(error) {
  if (error instanceof Error) return error;
  if (error && error.reason instanceof Error) return error.reason;
  if (error && error.error instanceof Error) return error.error;
  let message = 'Unknown error';
  if (typeof error === 'string') {
    message = error;
  } else if (error) {
    try {
      message = JSON.stringify(error);
    } catch (_) {
      message = String(error);
    }
  }
  return new Error(message);
}

function isIgnoredThirdPartyError(payload) {
  const text = [payload.message, payload.stack, payload.url, payload.feature]
    .filter(Boolean)
    .join('\n');
  return THIRD_PARTY_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

async function reportError(error, context = {}) {
  const normalized = normalizeError(error);
  const payload = {
    action: 'error_report',
    app: APP_ID,
    message: String(context.message || normalized.message || 'Unknown error').slice(0, 2000),
    stack: String(context.stack || normalized.stack || '').slice(0, 8000),
    url: String(context.url || window.location.href || '').slice(0, 1000),
    feature: String(context.feature || 'general').slice(0, 120),
    userAgent: String(navigator.userAgent || '').slice(0, 500),
  };

  if (context.appVersion) {
    payload.appVersion = String(context.appVersion).slice(0, 120);
  }
  if (context.userNote) {
    payload.userNote = String(context.userNote).slice(0, 1000);
  }

  if (!FEEDBACK_ENDPOINT || isIgnoredThirdPartyError(payload)) {
    return { ok: false, target: 'ignored' };
  }

  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (json && json.ok === false) throw new Error(json.error || 'error report failed');
    return { ok: true, target: 'apps-script' };
  } catch (err) {
    console.warn('error report submit error', err);
    return { ok: false, target: 'apps-script', error: String(err && err.message ? err.message : err) };
  }
}

window.reportError = reportError;

window.addEventListener('error', (event) => {
  reportError(event.error || event.message, {
    feature: 'window-error',
    message: event.message,
    stack: event.error && event.error.stack,
    url: event.filename || window.location.href,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason, {
    feature: 'unhandled-rejection',
    url: window.location.href,
  });
});

document.addEventListener('DOMContentLoaded', feedbackReady);
