/**
 * WC2026 — Toast Notification System
 * Real-time alerts for match events: goals, cards, match start/end
 *
 * Sound effects generated via Web Audio API (no external files needed).
 * Mute state persisted in localStorage.
 */

/* ===== STATE ===== */
const TOAST_MUTE_KEY = 'wc2026_toast_muted';
let toastMuted = localStorage.getItem(TOAST_MUTE_KEY) === 'true';
let toastContainer = null;
let audioCtx = null;

/* ===== INITIALIZE ===== */
function initToast() {
  toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  updateMuteButton();

  const muteBtn = document.getElementById('toast-mute-btn');
  if (muteBtn) {
    muteBtn.addEventListener('click', toggleMute);
  }
}

function toggleMute() {
  toastMuted = !toastMuted;
  localStorage.setItem(TOAST_MUTE_KEY, toastMuted);
  updateMuteButton();
  showToastMessage(toastMuted ? 'Sonido desactivado' : 'Sonido activado', 'info');
}

function updateMuteButton() {
  const btn = document.getElementById('toast-mute-btn');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = toastMuted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
  }
  btn.title = toastMuted ? 'Activar sonido' : 'Silenciar notificaciones';
  btn.classList.toggle('muted', toastMuted);
}

/* ===== WEB AUDIO — SOUND EFFECTS ===== */
function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Play a referee whistle sound (three short bursts).
 * Used for match start and match end.
 */
function playWhistle() {
  if (toastMuted) return;
  try {
    const ctx = getAudioContext();

    [0, 0.18, 0.36].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(3400, ctx.currentTime + delay);
      osc.frequency.linearRampToValueAtTime(2800, ctx.currentTime + delay + 0.12);

      gain.gain.setValueAtTime(0.13, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.16);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.17);
    });
  } catch (e) { /* silent */ }
}

/**
 * Play a celebratory whistle sound for goals (five rapid bursts).
 */
function playGoalSound() {
  if (toastMuted) return;
  try {
    const ctx = getAudioContext();

    [0, 0.10, 0.20, 0.36, 0.46].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(3800, ctx.currentTime + delay);
      osc.frequency.linearRampToValueAtTime(2600, ctx.currentTime + delay + 0.08);

      gain.gain.setValueAtTime(0.18, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.11);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  } catch (e) { /* silent */ }
}

/* ===== TOAST CREATION ===== */

/**
 * Show a rich toast notification.
 * @param {string} type — 'match-start' | 'goal' | 'card--yellow' | 'card--red' | 'match-end'
 * @param {object} options — data for the toast content
 */
function showToast(type, options) {
  if (!toastContainer) return;
  if (typeof showToast === 'undefined') return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  let iconHtml = '';
  let titleHtml = '';
  let bodyHtml = '';

  switch (type) {
    case 'match-start':
      iconHtml = '<div class="toast__icon"><i class="fas fa-play-circle"></i></div>';
      titleHtml = '<div class="toast__title">Comenz\u00f3 el partido</div>';
      bodyHtml = '<div class="toast__body">' +
        (options.homeFlag || '') + ' <strong>' + (options.homeName || '') + '</strong>' +
        ' <span style="color:rgba(255,255,255,0.4)">vs</span> ' +
        (options.awayFlag || '') + ' <strong>' + (options.awayName || '') + '</strong>' +
        (options.venue ? '<div class="toast__detail">' + options.venue + '</div>' : '') +
        '</div>';
      break;

    case 'goal':
      iconHtml = '<div class="toast__icon toast__icon--goal"><i class="fas fa-futbol"></i></div>';
      titleHtml = '<div class="toast__title toast__title--goal">\u00a1GOOOL!</div>';
      bodyHtml = '<div class="toast__body">' +
        (options.flag || '') + ' <strong>' + (options.playerName || '') + '</strong>' +
        ' <span style="color:rgba(255,255,255,0.4)">\u2014</span> ' + (options.teamName || '') +
        '<div class="toast__detail">' + (options.matchLabel || '') + (options.minute ? ' \u00b7 ' + options.minute : '') + '</div>' +
        '</div>';
      break;

    case 'card--yellow':
    case 'card--red': {
      const isRed = type === 'card--red';
      const color = isRed ? '#E53935' : '#FFD700';
      const label = isRed ? 'Roja' : 'Amarilla';
      iconHtml = '<div class="toast__icon" style="color:' + color + '"><i class="fas fa-square"></i></div>';
      titleHtml = '<div class="toast__title" style="color:' + color + '">Tarjeta ' + label + '</div>';
      bodyHtml = '<div class="toast__body">' +
        (options.flag || '') + ' <strong>' + (options.playerName || '') + '</strong>' +
        ' <span style="color:rgba(255,255,255,0.4)">\u2014</span> ' + (options.teamName || '') +
        '<div class="toast__detail">' + (options.matchLabel || '') + (options.minute ? ' \u00b7 ' + options.minute : '') + '</div>' +
        '</div>';
      break;
    }

    case 'match-end':
      iconHtml = '<div class="toast__icon"><i class="fas fa-flag-checkered"></i></div>';
      titleHtml = '<div class="toast__title">Final del partido</div>';
      bodyHtml = '<div class="toast__body">' +
        (options.homeFlag || '') + ' <strong>' + (options.homeName || '') + '</strong> ' +
        '<span style="color:#00E5FF;font-weight:700">' + (options.homeScore || 0) + ' - ' + (options.awayScore || 0) + '</span> ' +
        (options.awayFlag || '') + ' <strong>' + (options.awayName || '') + '</strong>' +
        '</div>';
      break;

    default:
      return;
  }

  toast.innerHTML =
    iconHtml +
    '<div class="toast__content">' + titleHtml + bodyHtml + '</div>' +
    '<button class="toast__close" aria-label="Cerrar"><i class="fas fa-times"></i></button>' +
    '<div class="toast__progress"></div>';

  // Close button handler
  const closeBtn = toast.querySelector('.toast__close');
  closeBtn.addEventListener('click', function () {
    toast.classList.add('toast--removing');
    setTimeout(function () { toast.remove(); }, 300);
  });

  toastContainer.appendChild(toast);

  // Trigger slide-in animation
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      toast.classList.add('toast--visible');
    });
  });

  // Auto-remove
  var duration = (type === 'goal') ? 8000 : 6000;
  setTimeout(function () {
    if (toast.parentElement) {
      toast.classList.add('toast--removing');
      setTimeout(function () { toast.remove(); }, 300);
    }
  }, duration);

  // Play sound effect
  if (type === 'goal') {
    playGoalSound();
  } else if (type === 'match-start' || type === 'match-end') {
    playWhistle();
  }
  // Cards: no sound (as requested)

  // Browser notification (if tab is in background)
  sendBrowserNotification(type, options);
}

/**
 * Simple text toast (for mute toggle feedback, etc.)
 */
function showToastMessage(message, type) {
  if (!toastContainer) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + (type || 'info');
  toast.innerHTML =
    '<div class="toast__content">' +
    '<div class="toast__body" style="justify-content:center">' + message + '</div>' +
    '</div>';
  toastContainer.appendChild(toast);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      toast.classList.add('toast--visible');
    });
  });
  setTimeout(function () {
    if (toast.parentElement) {
      toast.classList.add('toast--removing');
      setTimeout(function () { toast.remove(); }, 300);
    }
  }, 2500);
}

/* ===== BROWSER NOTIFICATION (background tab) ===== */
var _notifPermission = 'default';

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    _notifPermission = 'granted';
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(function (perm) {
      _notifPermission = perm;
    });
  }
}

function sendBrowserNotification(type, options) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // Only send if tab is in background

  var title = '';
  var body = '';

  switch (type) {
    case 'match-start':
      title = '\u26bd Comenz\u00f3 el partido';
      body = (options.homeName || '') + ' vs ' + (options.awayName || '');
      break;
    case 'goal':
      title = '\u26bd\u00a1GOOOL!';
      body = (options.playerName || '') + ' \u2014 ' + (options.teamName || '') +
        (options.minute ? ' (' + options.minute + ')' : '');
      break;
    case 'card--yellow':
      title = '\ud83d\udfe8 Tarjeta Amarilla';
      body = (options.playerName || '') + ' \u2014 ' + (options.teamName || '');
      break;
    case 'card--red':
      title = '\ud83d\udfe5 Tarjeta Roja';
      body = (options.playerName || '') + ' \u2014 ' + (options.teamName || '');
      break;
    case 'match-end':
      title = '\ud83c\udfc1 Final';
      body = (options.homeName || '') + ' ' + (options.homeScore || 0) + ' - ' +
        (options.awayScore || 0) + ' ' + (options.awayName || '');
      break;
    default:
      return;
  }

  try {
    var n = new Notification(title, {
      body: body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">\u26bd</text></svg>',
      tag: 'wc2026-' + type + '-' + Date.now(),
      silent: true // We play our own sound
    });
    setTimeout(function () { n.close(); }, 5000);
  } catch (e) { /* silent */ }
}
