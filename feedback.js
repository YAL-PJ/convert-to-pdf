/**
 * Convert-to-PDF feedback widget.
 * Talks to the shared Apps Script backend defined in google-apps-script/feedback-backend.gs
 *
 * After deploying the Apps Script web app, paste its /exec URL into FEEDBACK_ENDPOINT below.
 */

const FEEDBACK_ENDPOINT = '';
const APP_ID = 'converttopdf';
const OWNER_NAME = 'Yanis (creator)';

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

  const visible = items.filter((i) => i.message);
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

function formatMeta(entry) {
  const d = entry.timestamp ? new Date(entry.timestamp) : null;
  const when = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const name = entry.name && entry.name.trim() ? entry.name.trim() : 'Anonymous';
  return [name, when].filter(Boolean).join(' · ');
}

document.addEventListener('DOMContentLoaded', feedbackReady);
