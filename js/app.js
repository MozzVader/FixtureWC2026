/**
 * FIFA World Cup 2026 — Main App
 */

const LS_TEAM_KEY = 'wc2026_selected_team';
const LS_TZ_KEY = 'wc2026_timezone';
const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

let selectedTeam = localStorage.getItem(LS_TEAM_KEY) || '';

/* ===== TIMEZONE UTILITIES =====
 * All match times in data.js are stored as "HH:mm" strings in UTC-3 (Argentina).
 * We parse them as UTC-3 and convert to the user's selected timezone.
 */
function getUserTimezone() {
  const saved = localStorage.getItem(LS_TZ_KEY);
  if (saved === 'local' || !saved) {
    // Auto-detect system timezone
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) { return DEFAULT_TZ; }
  }
  return saved;
}

/** Convert a UTC-3 time string + date string to the user's timezone.
 *  @param {string} timeStr - "16:00"
 *  @param {string} dateStr - "2026-06-11"
 *  @returns {string} - "16:00" in the user's TZ (24h format)
 */
function convertTime(timeStr, dateStr) {
  if (!timeStr || !dateStr) return timeStr || '';
  const fullStr = `${dateStr}T${timeStr}:00-03:00`;
  const d = new Date(fullStr);
  if (isNaN(d.getTime())) return timeStr;
  const tz = getUserTimezone();
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz
  });
}

/** Re-render all time-dependent UI sections when TZ changes */
function refreshTimes() {
  renderUpcomingMatches();
  renderTodayMatches();
  const calContainer = document.getElementById('calendar-content');
  if (calContainer) {
    const activeFilter = document.querySelector('.calendar__filter-btn.active');
    if (activeFilter && activeFilter.dataset.filter === 'knockout') {
      renderKnockoutCalendar(calContainer);
    } else {
      const filter = activeFilter ? activeFilter.dataset.filter : 'all';
      renderCalendar(calContainer, MATCHES.filter(m => m.stage === 'group'), filter);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();   // Firebase real-time listeners (non-blocking)
  initNavbar();
  initTeamPicker();
  initCountdown();
  initCalendar();
  initGroups();
  initBracket();
  initStats();
  initTimezoneSelector();
});

/* ===== NAVBAR ===== */
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const hamburger = document.querySelector('.navbar__hamburger');
  const links = document.querySelector('.navbar__links');

  // Scroll effect
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('navbar--scrolled');
    } else {
      navbar.classList.remove('navbar--scrolled');
    }
    updateActiveLink();
  });

  // Hamburger toggle
  if (hamburger && links) {
    hamburger.addEventListener('click', () => {
      links.classList.toggle('open');
      hamburger.classList.toggle('active');
    });

    // Close on link click
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        links.classList.remove('open');
        hamburger.classList.remove('active');
      });
    });
  }
}

function updateActiveLink() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.navbar__links a');
  let current = '';

  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= 120) {
      current = section.getAttribute('id');
    }
  });

  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === `#${current}`) {
      link.classList.add('active');
    }
  });
}

/* ===== COUNTDOWN ===== */
function isTournamentLive() {
  // Tournament starts at TOURNAMENT.startDate (2026-06-11T16:00 ART)
  return Date.now() >= new Date(TOURNAMENT.startDate).getTime();
}

/**
 * Get today's date in ART (UTC-3) with a 2AM cutoff.
 * A match ending at 1:59 AM ART still belongs to the previous "match day".
 */
function getMatchDayART() {
  const now = new Date();
  // Convert to ART: UTC - 3h
  const artMs = now.getTime() + now.getTimezoneOffset() * 60000 - 3 * 3600000;
  const artDate = new Date(artMs);
  // If ART hour < 2, this is still the previous match day
  if (artDate.getHours() < 2) {
    artDate.setDate(artDate.getDate() - 1);
  }
  return artDate.toISOString().slice(0, 10);
}

/**
 * Collect all matches for a given date string (group + knockout).
 */
function getMatchesByDate(dateStr) {
  const all = [];
  // Group stage
  if (typeof MATCHES !== 'undefined') {
    MATCHES.forEach(m => {
      if (m.date === dateStr) {
        m._source = 'group';
        all.push(m);
      }
    });
  }
  // Knockout stage
  const koSource = (typeof KNOCKOUT_LIVE !== 'undefined' && KNOCKOUT_LIVE)
    ? KNOCKOUT_LIVE
    : (typeof KNOCKOUT !== 'undefined' ? KNOCKOUT : null);
  if (koSource) {
    Object.values(koSource).flat().forEach(m => {
      if (m.date === dateStr) {
        m._source = 'knockout';
        all.push(m);
      }
    });
  }
  return all;
}

function initCountdown() {
  const countdownEl = document.getElementById('countdown');
  const heroToday = document.getElementById('hero-today');

  if (isTournamentLive()) {
    // ── TOURNAMENT MODE: hide countdown, show today's matches in hero ──
    if (countdownEl) countdownEl.style.display = 'none';
    if (heroToday) heroToday.style.display = '';
    renderTodayMatches();
    renderUpcomingMatches();

    // Auto-refresh at next 2AM ART boundary
    scheduleDayRollover();
  } else {
    // ── PRE-TOURNAMENT: show countdown + inaugural/selected team matches ──
    const target = new Date(TOURNAMENT.startDate).getTime();
    const els = {
      days: document.getElementById('cd-days'),
      hours: document.getElementById('cd-hours'),
      minutes: document.getElementById('cd-minutes'),
      seconds: document.getElementById('cd-seconds')
    };

    function update() {
      const now = new Date().getTime();
      const diff = target - now;

      if (diff <= 0) {
        if (els.days) els.days.textContent = '0';
        if (els.hours) els.hours.textContent = '0';
        if (els.minutes) els.minutes.textContent = '0';
        if (els.seconds) els.seconds.textContent = '0';
        // Tournament just started — switch to live mode
        if (countdownEl) countdownEl.style.display = 'none';
        if (heroToday) heroToday.style.display = '';
        renderTodayMatches();
        renderUpcomingMatches();
        scheduleDayRollover();
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      if (els.days) els.days.textContent = String(d).padStart(2, '0');
      if (els.hours) els.hours.textContent = String(h).padStart(2, '0');
      if (els.minutes) els.minutes.textContent = String(m).padStart(2, '0');
      if (els.seconds) els.seconds.textContent = String(s).padStart(2, '0');
    }

    update();
    setInterval(update, 1000);
    renderUpcomingMatches();
  }
}

/** Schedule a re-render at the next 2AM ART boundary. */
function scheduleDayRollover() {
  const now = new Date();
  const artMs = now.getTime() + now.getTimezoneOffset() * 60000 - 3 * 3600000;
  const artDate = new Date(artMs);
  // Calculate ms until next 2AM ART
  let msUntil2AM;
  if (artDate.getHours() < 2) {
    // Already past midnight but before 2AM — next rollover is tomorrow
    msUntil2AM = (24 - artDate.getHours() + 2) * 3600000 - artDate.getMinutes() * 60000 - artDate.getSeconds() * 1000;
  } else {
    // Before midnight ART
    msUntil2AM = (24 - artDate.getHours() + 2) * 3600000 - artDate.getMinutes() * 60000 - artDate.getSeconds() * 1000;
  }
  setTimeout(() => {
    renderTodayMatches();
    renderUpcomingMatches();
    // Schedule next rollover
    scheduleDayRollover();
  }, Math.max(msUntil2AM, 60000));
}

/* ===== TEAM PICKER ===== */
function initTeamPicker() {
  const chip      = document.getElementById('team-picker-chip');
  const picker    = document.getElementById('team-picker');
  const overlay   = document.getElementById('team-picker-overlay');
  const closeBtn  = document.getElementById('team-picker-close');
  const input     = document.getElementById('team-picker-input');
  const optionsEl = document.querySelector('.team-picker__options');
  const label     = document.getElementById('team-picker-label');

  if (!chip || !picker) return;

  // Populate team options (sorted by name)
  const sortedTeams = Object.values(TEAMS).sort((a, b) => a.name.localeCompare(b.name));
  sortedTeams.forEach(team => {
    const btn = document.createElement('button');
    btn.className = 'team-picker__option';
    btn.dataset.team = team.code;
    if (team.code === selectedTeam) btn.classList.add('active');
    btn.innerHTML = `${getFlagHtml(team.code)}<span>${team.name}</span>`;
    optionsEl.appendChild(btn);
  });

  // Highlight default option if no team selected
  const defaultOpt = optionsEl.querySelector('[data-team=""]');
  if (!selectedTeam && defaultOpt) defaultOpt.classList.add('active');

  // Update chip label
  updateChipLabel(label, chip);

  // Open/close
  chip.addEventListener('click', () => {
    picker.classList.add('active');
    if (input) { input.value = ''; filterOptions(''); }
    document.body.style.overflow = 'hidden';
  });

  function closeModal() {
    picker.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (overlay) overlay.addEventListener('click', closeModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picker.classList.contains('active')) closeModal();
  });

  // Search
  if (input) {
    input.addEventListener('input', (e) => filterOptions(e.target.value.trim().toLowerCase()));
  }

  function filterOptions(query) {
    optionsEl.querySelectorAll('.team-picker__option').forEach(opt => {
      const teamCode = opt.dataset.team;
      if (!teamCode) { opt.classList.remove('hidden'); return; } // always show default
      const team = TEAMS[teamCode];
      if (!team) return;
      const match = team.name.toLowerCase().includes(query) || teamCode.toLowerCase().includes(query);
      opt.classList.toggle('hidden', !match);
    });
  }

  // Select team
  optionsEl.addEventListener('click', (e) => {
    const opt = e.target.closest('.team-picker__option');
    if (!opt) return;

    const teamCode = opt.dataset.team;
    selectedTeam = teamCode;

    // Save to localStorage
    if (teamCode) {
      localStorage.setItem(LS_TEAM_KEY, teamCode);
    } else {
      localStorage.removeItem(LS_TEAM_KEY);
    }

    // Update active states
    optionsEl.querySelectorAll('.team-picker__option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');

    // Update chip
    updateChipLabel(label, chip);

    // Re-render matches
    renderUpcomingMatches();

    closeModal();
  });
}

function updateChipLabel(label, chip) {
  if (!label) return;
  if (selectedTeam && TEAMS[selectedTeam]) {
    const team = TEAMS[selectedTeam];
    label.innerHTML = `Partidos de ${team.name}`;
    // Replace chip icon with flag
    const flagSpan = chip.querySelector('.fi');
    const icon = chip.querySelector('.fa-globe');
    if (icon && !flagSpan) {
      const flag = document.createElement('span');
      flag.className = getFlagClass(team.code);
      icon.replaceWith(flag);
    } else if (flagSpan) {
      flagSpan.className = getFlagClass(team.code);
    }
  } else {
    label.textContent = 'Partidos Inaugurales';
    const flagSpan = chip.querySelector('.fi');
    if (flagSpan) {
      const icon = document.createElement('i');
      icon.className = 'fas fa-globe';
      flagSpan.replaceWith(icon);
    }
  }
}

/* ===== UPCOMING MATCHES (team picker section — always shows team/inaugural matches) ===== */
function renderUpcomingMatches() {
  const container = document.getElementById('upcoming-matches');
  if (!container) return;

  let upcoming;

  // Always: selected team's ALL matches, or inaugural (first 3)
  if (selectedTeam && TEAMS[selectedTeam]) {
    upcoming = MATCHES.filter(m => m.home === selectedTeam || m.away === selectedTeam);
  } else {
    upcoming = MATCHES.slice(0, 3);
  }

  if (upcoming.length === 0) {
    container.innerHTML = '<div class="loading">No hay partidos para mostrar.</div>';
    return;
  }

  let html = '';
  upcoming.forEach(match => {
    const home = TEAMS[match.home];
    const away = TEAMS[match.away];
    if (!home || !away) return;

    const status = match.status || 'upcoming';
    const isLive = status === 'live' || status === 'halftime';
    const isCompleted = status === 'completed';
    const isHalftime = match.minute === 'HT';
    const hasScore = match.homeScore != null && match.awayScore != null;

    // Status badge (LIVE, HT or FT)
    let statusBadge = '';
    if (isHalftime) statusBadge = `<div class="upcoming__match-badge"><span class="ht-badge"><span class="live-dot ht-dot"></span>HT</span></div>`;
    else if (isLive) statusBadge = `<div class="upcoming__match-badge"><span class="live-badge"><span class="live-dot"></span>EN VIVO ${match.minute ? match.minute + "'" : ''}</span></div>`;
    else if (isCompleted) statusBadge = `<div class="upcoming__match-badge"><span class="ft-badge">Final</span></div>`;

    // Score or VS
    let vsOrScore;
    if (hasScore) {
      vsOrScore = `<span class="upcoming__score">${match.homeScore} - ${match.awayScore}</span>`;
    } else {
      vsOrScore = '<span class="upcoming__vs">VS</span>';
    }

    const matchClass = isLive ? 'upcoming__match--live' : (isCompleted ? 'upcoming__match--completed' : '');

    // Info line: show time for upcoming, venue for live/completed
    const isKnockout = match._source === 'knockout';
    const groupLabel = isKnockout
      ? (match._round || 'Eliminatoria')
      : `Grupo ${match.group}`;

    html += `
      <div class="upcoming__match ${matchClass}">
        ${statusBadge}
        <div class="upcoming__teams">
          <div class="upcoming__team">
            ${getFlagHtml(home.code, 'lg')}
            <span class="upcoming__team-name">${home.name}</span>
          </div>
          ${vsOrScore}
          <div class="upcoming__team">
            ${getFlagHtml(away.code, 'lg')}
            <span class="upcoming__team-name">${away.name}</span>
          </div>
        </div>
        <div class="upcoming__info">
          ${!isCompleted && !isLive ? `<span class="upcoming__date">${convertTime(match.time, match.date)} hs</span>` : ''}
          <span>${match.city} · <span class="calendar__match-group">${groupLabel}</span></span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/* ===== TODAY'S MATCHES (hero section, calendar bar format) ===== */
function renderTodayMatches() {
  const container = document.getElementById('hero-today');
  if (!container) return;
  if (container.style.display === 'none') return; // not in tournament mode

  const todayStr = getMatchDayART();
  const todayMatches = getMatchesByDate(todayStr);

  if (todayMatches.length === 0) {
    container.innerHTML = '<div class="hero-today__empty">No hay partidos programados para hoy.</div>';
    return;
  }

  let html = '<div class="hero-today__title"><i class="fas fa-calendar-day"></i> Partidos de Hoy</div>';
  html += '<div class="calendar__match-list">';

  todayMatches.forEach(match => {
    // Normalize home/away for knockout matches
    const homeCode = typeof match.home === 'object' && match.home !== null ? match.home.code : match.home;
    const awayCode = typeof match.away === 'object' && match.away !== null ? match.away.code : match.away;
    const home = TEAMS[homeCode];
    const away = TEAMS[awayCode];
    if (!home || !away) return;

    const status = match.status || 'upcoming';
    const isLive = status === 'live' || status === 'halftime';
    const isCompleted = status === 'completed';
    const isHalftime = match.minute === 'HT';
    const hasScore = match.homeScore != null && match.awayScore != null;

    const matchClasses = ['calendar__match'];
    if (isLive) matchClasses.push('calendar__match--live');
    if (isCompleted) matchClasses.push('calendar__match--completed');

    // Time/status column
    let timeDisplay = match.time ? convertTime(match.time, match.date) : '';
    if (isHalftime) timeDisplay = '<span class="ht-badge"><span class="live-dot ht-dot"></span>HT</span>';
    else if (isLive) timeDisplay = `<span class="live-badge"><span class="live-dot"></span>EN VIVO ${match.minute ? match.minute + "'" : ''}</span>`;
    else if (isCompleted) timeDisplay = '<span class="ft-badge">FT</span>';

    // Score or VS display
    let scoreHtml;
    if (hasScore) {
      scoreHtml = `
        <span class="calendar__match-score calendar__match-score--filled">${match.homeScore}</span>
        <span class="calendar__match-vs--dash">-</span>
        <span class="calendar__match-score calendar__match-score--filled">${match.awayScore}</span>
      `;
    } else {
      scoreHtml = `
        <div class="calendar__match-score"></div>
        <span class="calendar__match-vs">VS</span>
        <div class="calendar__match-score"></div>
      `;
    }

    const isKnockout = match._source === 'knockout';
    const groupLabel = isKnockout
      ? (match._round || 'Eliminatoria')
      : `Grupo ${match.group}`;

    html += `
      <div class="${matchClasses.join(' ')}">
        <div class="calendar__match-time">${timeDisplay}</div>
        <div class="calendar__match-teams">
          <div class="calendar__match-team">
            ${getFlagHtml(home.code)}
            <span>${home.name}</span>
          </div>
          ${scoreHtml}
          <div class="calendar__match-team">
            ${getFlagHtml(away.code)}
            <span>${away.name}</span>
          </div>
        </div>
        <div class="calendar__match-venue">
          <span class="calendar__match-venue--city">${match.city}</span>
          <span class="calendar__match-group">${groupLabel}</span>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

/* ===== CALENDAR ===== */
function initCalendar() {
  const container = document.getElementById('calendar-content');
  const filterContainer = document.getElementById('calendar-filters');
  if (!container) return;

  const groupMatches = MATCHES.filter(m => m.stage === 'group');

  // Render filter buttons + Eliminatorias tab
  if (filterContainer) {
    let filterHtml = '<button class="calendar__filter-btn active" data-filter="all">Todos</button>';
    'ABCDEFGHIJKL'.split('').forEach(g => {
      filterHtml += `<button class="calendar__filter-btn" data-filter="${g}">Grupo ${g}</button>`;
    });
    // Separator + Eliminatorias tab
    filterHtml += '<span class="calendar__filter-sep"></span>';
    filterHtml += '<button class="calendar__filter-btn calendar__filter-btn--ko" data-filter="knockout"><i class="fas fa-sitemap" style="margin-right:6px"></i>Eliminatorias</button>';
    filterContainer.innerHTML = filterHtml;

    filterContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.calendar__filter-btn');
      if (!btn) return;

      filterContainer.querySelectorAll('.calendar__filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      if (filter === 'knockout') {
        renderKnockoutCalendar(container);
      } else {
        renderCalendar(container, groupMatches, filter);
      }
    });
  }

  renderCalendar(container, groupMatches, 'all');
}

function renderCalendar(container, matches, filter) {
  let filtered = matches;

  if (filter === 'arg') {
    filtered = matches.filter(m => m.home === 'ARG' || m.away === 'ARG');
  } else if (filter !== 'all') {
    filtered = matches.filter(m => m.group === filter);
  }

  // Group by date
  const byDate = {};
  filtered.forEach(match => {
    if (!byDate[match.date]) byDate[match.date] = [];
    byDate[match.date].push(match);
  });

  let html = '';

  Object.keys(byDate).sort().forEach(date => {
    const dayMatches = byDate[date];
    html += `
      <div class="calendar__date-group">
        <div class="calendar__date-title">${formatDateFull(date)}</div>
        <div class="calendar__match-list">
    `;

    dayMatches.forEach(match => {
      const home = TEAMS[match.home];
      const away = TEAMS[match.away];
      if (!home || !away) return;

      const status = match.status || 'upcoming';
      const isLive = status === 'live' || status === 'halftime';
      const isCompleted = status === 'completed';
      const isHalftime = match.minute === 'HT';
      const hasScore = match.homeScore != null && match.awayScore != null;

      // Match wrapper class
      const matchClasses = ['calendar__match'];
      if (isLive) matchClasses.push('calendar__match--live');
      if (isCompleted) matchClasses.push('calendar__match--completed');

      // Time/status column
      let timeDisplay = convertTime(match.time, match.date);
      if (isHalftime) timeDisplay = '<span class="ht-badge"><span class="live-dot ht-dot"></span>HT</span>';
      else if (isLive) timeDisplay = `<span class="live-badge"><span class="live-dot"></span>EN VIVO ${match.minute ? match.minute + "'" : ''}</span>`;
      else if (isCompleted) timeDisplay = '<span class="ft-badge">FT</span>';

      // Score or VS display
      let scoreHtml;
      if (hasScore) {
        scoreHtml = `
          <span class="calendar__match-score calendar__match-score--filled">${match.homeScore}</span>
          <span class="calendar__match-vs--dash">-</span>
          <span class="calendar__match-score calendar__match-score--filled">${match.awayScore}</span>
        `;
      } else {
        scoreHtml = `
          <div class="calendar__match-score"></div>
          <span class="calendar__match-vs">VS</span>
          <div class="calendar__match-score"></div>
        `;
      }

      html += `
        <div class="${matchClasses.join(' ')}">
          <div class="calendar__match-time">${timeDisplay}</div>
          <div class="calendar__match-teams">
            <div class="calendar__match-team">
              ${getFlagHtml(home.code)}
              <span>${home.name}</span>
            </div>
            ${scoreHtml}
            <div class="calendar__match-team">
              ${getFlagHtml(away.code)}
              <span>${away.name}</span>
            </div>
          </div>
          <div class="calendar__match-venue">
            <span class="calendar__match-venue--city">${match.city}</span>
            <span class="calendar__match-group">Grupo ${match.group}</span>
          </div>
        </div>
      `;
    });

    html += '</div></div>';
  });

  container.innerHTML = html || '<div class="loading">No se encontraron partidos para este filtro.</div>';
}

/* ===== GROUPS ===== */
function initGroups() {
  const container = document.getElementById('groups-content');
  if (!container) return;

  let html = '<div class="groups__grid">';

  Object.keys(GROUPS).sort().forEach(groupLetter => {
    const teams = GROUPS[groupLetter];
    html += `
      <div class="group-card">
        <div class="group-card__header">
          <span class="group-card__letter">Grupo ${groupLetter}</span>
        </div>
        <div class="group-card__body">
          <table class="group-card__table">
            <thead>
              <tr>
                <th style="width:25px">#</th>
                <th style="text-align:left">Selección</th>
                <th>PJ</th>
                <th>PG</th>
                <th>PE</th>
                <th>PP</th>
                <th>GF</th>
                <th>GC</th>
                <th>DG</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
    `;

    teams.forEach((team, idx) => {
      const pos = idx + 1;
      const posClass = pos <= 2 ? 'qualified' : '';
      const badgeClass = `pos-badge--${pos}`;
      const gd = team.goalsFor - team.goalsAgainst;

      html += `
        <tr class="${posClass}">
          <td><span class="pos-badge ${badgeClass}">${pos}</span></td>
          <td>
            <div class="team-cell">
              ${getFlagHtml(team.flagCode)}
              <span>${team.name}</span>
            </div>
          </td>
          <td>${team.played}</td>
          <td>${team.won}</td>
          <td>${team.drawn}</td>
          <td>${team.lost}</td>
          <td>${team.goalsFor}</td>
          <td>${team.goalsAgainst}</td>
          <td>${gd > 0 ? '+' : ''}${gd}</td>
          <td><strong>${team.points}</strong></td>
        </tr>
      `;
    });

    html += '</tbody></table></div></div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

/* ===== BRACKET (CSS Grid with elbow connectors) ===== */
function initBracket() {
  const container = document.getElementById('bracket-content');
  if (!container) return;

  // Use live Firebase data if available, otherwise static KNOCKOUT
  const src = (typeof KNOCKOUT_LIVE !== 'undefined' && KNOCKOUT_LIVE) ? KNOCKOUT_LIVE : KNOCKOUT;

  // Fallback to static KNOCKOUT if a round array is empty in live data
  const r32 = (src.roundOf32 && src.roundOf32.length) ? src.roundOf32 : KNOCKOUT.roundOf32;
  const r16 = (src.roundOf16 && src.roundOf16.length) ? src.roundOf16 : KNOCKOUT.roundOf16;
  const qf  = (src.quarterfinals && src.quarterfinals.length) ? src.quarterfinals : KNOCKOUT.quarterfinals;
  const sf  = (src.semifinals && src.semifinals.length) ? src.semifinals : KNOCKOUT.semifinals;
  const fin = src.final || KNOCKOUT.final;
  const tp  = src.thirdPlace || KNOCKOUT.thirdPlace;

  let html = '<div class="bracket">';

  // --- Round titles ---
  html += '<div class="bracket-titles">';
  html += '<div class="bracket-title">Dieciseisavos de Final</div><div class="bracket-title-gap"></div>';
  html += '<div class="bracket-title">Octavos de Final</div><div class="bracket-title-gap"></div>';
  html += '<div class="bracket-title">Cuartos de Final</div><div class="bracket-title-gap"></div>';
  html += '<div class="bracket-title">Semifinales</div><div class="bracket-title-gap"></div>';
  html += '<div class="bracket-title bracket-title--final">Final</div>';
  html += '</div>';

  // --- Grid ---
  html += '<div class="bracket-grid">';

  // Col 1 — R32: 16 matches, 1 row each
  for (let i = 0; i < 16; i++) {
    html += `<div class="bracket-grid-item" style="grid-column:1;grid-row:${i + 1}">`;
    html += renderBracketMatch(r32[i]);
    html += '</div>';
  }

  // Col 2 — Connectors R32 → R16 (8 groups of 2 rows)
  // Each feeder is 1 row → offset = 40px (half of 80px row)
  for (let i = 0; i < 8; i++) {
    const rs = i * 2 + 1;
    html += buildConnector(2, rs, rs + 2, 40);
  }

  // Col 3 — R16: 8 matches, 2 rows each
  for (let i = 0; i < 8; i++) {
    const rs = i * 2 + 1;
    html += `<div class="bracket-grid-item" style="grid-column:3;grid-row:${rs}/${rs + 2}">`;
    html += renderBracketMatch(r16[i]);
    html += '</div>';
  }

  // Col 4 — Connectors R16 → QF (4 groups of 4 rows)
  // Each feeder is 2 rows → offset = (2×80 + 6) / 2 = 83px
  for (let i = 0; i < 4; i++) {
    const rs = i * 4 + 1;
    html += buildConnector(4, rs, rs + 4, 83);
  }

  // Col 5 — QF: 4 matches, 4 rows each
  for (let i = 0; i < 4; i++) {
    const rs = i * 4 + 1;
    html += `<div class="bracket-grid-item" style="grid-column:5;grid-row:${rs}/${rs + 4}">`;
    html += renderBracketMatch(qf[i]);
    html += '</div>';
  }

  // Col 6 — Connectors QF → SF (2 groups of 8 rows)
  // Each feeder is 4 rows → offset = (4×80 + 3×6) / 2 = 169px
  for (let i = 0; i < 2; i++) {
    const rs = i * 8 + 1;
    html += buildConnector(6, rs, rs + 8, 169);
  }

  // Col 7 — SF: 2 matches, 8 rows each
  for (let i = 0; i < 2; i++) {
    const rs = i * 8 + 1;
    html += `<div class="bracket-grid-item" style="grid-column:7;grid-row:${rs}/${rs + 8}">`;
    html += renderBracketMatch(sf[i]);
    html += '</div>';
  }

  // Col 8 — Connector SF → Final (1 group of 16 rows)
  // Each feeder is 8 rows → offset = (8×80 + 7×6) / 2 = 341px
  html += buildConnector(8, 1, 17, 341);

  // Col 9 — Final: 1 match, spans all 16 rows (row 1/17)
  html += '<div class="bracket-grid-item bracket-grid-item--final" style="grid-column:9;grid-row:1/17">';
  html += renderBracketMatch(fin, true);
  html += '</div>';

  html += '</div>'; // bracket-grid

  // --- 3rd Place (right below the grid) ---
  html += '<div class="bracket-third">';
  html += '<div class="bracket-third-title">Tercer Puesto</div>';
  html += renderBracketMatch(tp);
  html += '</div>';

  html += '</div>'; // bracket
  container.innerHTML = html;
}

/** Build an elbow connector with correct offsets for each round transition.
 *  @param {number} col     - Grid column
 *  @param {number} rs      - Grid row start (line)
 *  @param {number} re      - Grid row end (line)
 *  @param {number} offset  - Vertical offset in px (centre of each feeder match group)
 */
function buildConnector(col, rs, re, offset) {
  return `<div class="bracket-conn" style="grid-column:${col};grid-row:${rs}/${re};--top-off:${offset}px;--bot-off:${offset}px">
    <div class="bracket-conn__h-top"></div>
    <div class="bracket-conn__v"></div>
    <div class="bracket-conn__h-bot"></div>
    <div class="bracket-conn__h-mid"></div>
  </div>`;
}

function renderBracketMatch(match, isFinal = false) {
  if (!match) return '';
  // Defensive: if home/away is an object instead of a code string, extract the code
  const homeCode = typeof match.home === 'object' && match.home !== null ? match.home.code : match.home;
  const awayCode = typeof match.away === 'object' && match.away !== null ? match.away.code : match.away;
  const homeTeam = homeCode ? TEAMS[homeCode] : null;
  const awayTeam = awayCode ? TEAMS[awayCode] : null;

  // Parse label for display when teams are TBD
  const labelParts = (match.label || '').split(' vs ');
  const homeLabel = homeTeam ? homeTeam.name : (labelParts[0] || 'Por definir');
  const awayLabel = awayTeam ? awayTeam.name : (labelParts[1] || 'Por definir');

  // Scores (from Firebase knockout or group matches)
  const hasScore = match.homeScore != null && match.awayScore != null;
  const status = match.status || 'upcoming';
  const isLive = status === 'live' || status === 'halftime';
  const isCompleted = status === 'completed';
  const isHalftime = match.minute === 'HT';

  // Status badge
  let statusHtml = '';
  if (isHalftime) statusHtml = '<span class="ht-badge"><span class="live-dot ht-dot"></span>HT</span>';
  else if (isLive) statusHtml = `<span class="live-badge"><span class="live-dot"></span>${match.minute ? match.minute + "'" : 'EN VIVO'}</span>`;
  else if (isCompleted) statusHtml = '<span class="ft-badge">FT</span>';

  return `
    <div class="bracket__match" ${isFinal ? 'style="border-color: var(--dorado-500); box-shadow: var(--sombra-dorada);"' : ''}>
      ${statusHtml ? '<div style="text-align:center;margin-bottom:4px">' + statusHtml + '</div>' : ''}
      <div class="bracket__team ${homeTeam ? '' : 'bracket__team--tbd'}">
        ${homeTeam ? getFlagHtml(homeTeam.code) : ''}
        <span class="bracket__team-name">${homeLabel}</span>
        ${hasScore ? `<span class="bracket__team-score">${match.homeScore}</span>` : ''}
      </div>
      <div class="bracket__team ${awayTeam ? '' : 'bracket__team--tbd'}">
        ${awayTeam ? getFlagHtml(awayTeam.code) : ''}
        <span class="bracket__team-name">${awayLabel}</span>
        ${hasScore ? `<span class="bracket__team-score">${match.awayScore}</span>` : ''}
      </div>
      <div class="bracket__match-info">${match.date ? formatDate(match.date) : ''}</div>
    </div>
  `;
}

/* ===== STATS ===== */
function initStats() {
  renderVenues();
  renderScorers();
  renderCards();
}

function renderVenues() {
  const container = document.getElementById('venues-content');
  if (!container) return;

  let html = '<div class="stat-card__body" style="padding:0"><table class="stat-card__table"><thead><tr>';
  html += '<th style="text-align:left">Ciudad</th><th>Estadio</th><th>Capacidad</th><th>Partidos</th>';
  html += '</tr></thead><tbody>';

  VENUES.forEach(v => {
    const flagCls = getFlagClass(v.country);
    html += `
      <tr>
        <td>
          <div class="team-cell">
            <span class="${flagCls}"></span>
            <span>${v.city}</span>
          </div>
        </td>
        <td>${v.stadium}</td>
        <td>${v.capacity}</td>
        <td><span class="calendar__match-group">${v.matches}</span></td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function renderScorers() {
  const container = document.getElementById('scorers-content');
  if (!container) return;

  // Check for live data from Firebase
  const scorers = (typeof STATS !== 'undefined' && STATS.scorers && STATS.scorers.length > 0)
    ? STATS.scorers
    : [];

  if (scorers.length === 0) {
    container.innerHTML = `
      <div class="stat-empty">
        <i class="fas fa-futbol"></i>
        Los goleadores aparecerán aquí una vez que comience el torneo.
      </div>
    `;
    return;
  }

  let html = '<div class="stat-card__body" style="padding:0"><table class="stat-card__table"><thead><tr>';
  html += '<th style="width:30px">#</th><th style="text-align:left">Jugador</th><th>Selección</th><th style="text-align:center">Goles</th><th style="text-align:center">Asist.</th>';
  html += '</tr></thead><tbody>';

  scorers.forEach((s, i) => {
    const badgeClass = i < 3 ? `pos-badge--${i + 1}` : 'pos-badge--4';
    html += `
      <tr>
        <td><span class="pos-badge ${badgeClass}">${i + 1}</span></td>
        <td style="text-align:left;font-weight:600">${s.name}</td>
        <td style="text-align:center">${getFlagHtml(s.teamCode)}</td>
        <td style="text-align:center"><strong>${s.goals}</strong></td>
        <td style="text-align:center">${s.assists || 0}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function renderCards() {
  const container = document.getElementById('cards-content');
  if (!container) return;

  // Check for live data from Firebase
  const yellows = (typeof STATS !== 'undefined' && STATS.yellowCards) ? STATS.yellowCards : [];
  const reds = (typeof STATS !== 'undefined' && STATS.redCards) ? STATS.redCards : [];

  if (yellows.length === 0 && reds.length === 0) {
    container.innerHTML = `
      <div class="stat-empty">
        <i class="fas fa-square" style="color: #FFD700"></i>
        <i class="fas fa-square" style="color: #E53935"></i>
        Las tarjetas aparecerán aquí una vez que comience el torneo.
      </div>
    `;
    return;
  }

  // Merge yellow and red cards by player
  const playerMap = {};
  yellows.forEach(y => {
    const key = y.name + '_' + y.teamCode;
    if (!playerMap[key]) playerMap[key] = { name: y.name, teamCode: y.teamCode, yellow: 0, red: 0 };
    playerMap[key].yellow = y.count || 1;
  });
  reds.forEach(r => {
    const key = r.name + '_' + r.teamCode;
    if (!playerMap[key]) playerMap[key] = { name: r.name, teamCode: r.teamCode, yellow: 0, red: 0 };
    playerMap[key].red = r.count || 1;
  });

  const players = Object.values(playerMap).sort((a, b) => (b.yellow + b.red) - (a.yellow + a.red));

  let html = '<div class="stat-card__body" style="padding:0"><table class="stat-card__table"><thead><tr>';
  html += '<th style="width:30px">#</th><th style="text-align:left">Jugador</th><th>Selección</th><th style="text-align:center">Amarillas</th><th style="text-align:center">Rojas</th>';
  html += '</tr></thead><tbody>';

  players.forEach((p, i) => {
    const badgeClass = i < 3 ? `pos-badge--${i + 1}` : 'pos-badge--4';
    html += `
      <tr>
        <td><span class="pos-badge ${badgeClass}">${i + 1}</span></td>
        <td style="text-align:left;font-weight:600">${p.name}</td>
        <td style="text-align:center">${getFlagHtml(p.teamCode)}</td>
        <td style="text-align:center">${p.yellow > 0 ? '<span style="color:#FFD700">■</span> ' + p.yellow : '-'}</td>
        <td style="text-align:center">${p.red > 0 ? '<span style="color:#E53935">■</span> ' + p.red : '-'}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

/* ===== KNOCKOUT CALENDAR (Tab View) ===== */
function renderKnockoutCalendar(container) {
  if (!container) return;

  // Use live data if available, fallback to static
  const src = (typeof KNOCKOUT_LIVE !== 'undefined' && KNOCKOUT_LIVE) ? KNOCKOUT_LIVE : null;
  const fallback = (typeof KNOCKOUT !== 'undefined') ? KNOCKOUT : null;
  if (!src && !fallback) {
    container.innerHTML = '<div class="loading">No hay datos de eliminatorias.</div>';
    return;
  }

  // Flatten all knockout matches into a single array
  const all = [];
  const roundOrder = [
    { key: 'roundOf32', label: 'Dieciseisavos de Final' },
    { key: 'roundOf16', label: 'Octavos de Final' },
    { key: 'quarterfinals', label: 'Cuartos de Final' },
    { key: 'semifinals', label: 'Semifinales' },
    { key: 'thirdPlace', label: 'Tercer Puesto' },
    { key: 'final', label: 'Final' }
  ];

  roundOrder.forEach(round => {
    let matches;
    if (src) {
      matches = src[round.key];
    } else {
      matches = fallback[round.key];
    }

    if (!matches) return;

    // Handle array rounds vs single-match rounds (final, thirdPlace)
    if (Array.isArray(matches)) {
      matches.forEach(m => all.push({ ...m, _round: round.label }));
    } else {
      all.push({ ...matches, _round: round.label });
    }
  });

  // Group by date
  const byDate = {};
  all.forEach(match => {
    const date = match.date || 'TBD';
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(match);
  });

  let html = '';

  Object.keys(byDate).sort().forEach(date => {
    const dayMatches = byDate[date];
    const dateTitle = date === 'TBD' ? 'Por definir' : formatDateFull(date);
    html += `
      <div class="calendar__date-group">
        <div class="calendar__date-title">${dateTitle}</div>
        <div class="calendar__match-list">
    `;

    dayMatches.forEach(match => {
      // Normalize home/away
      const homeCode = typeof match.home === 'object' && match.home !== null ? match.home.code : match.home;
      const awayCode = typeof match.away === 'object' && match.away !== null ? match.away.code : match.away;
      const homeTeam = homeCode ? TEAMS[homeCode] : null;
      const awayTeam = awayCode ? TEAMS[awayCode] : null;

      // Parse label for TBD teams
      const labelParts = (match.label || '').split(' vs ');
      const homeName = homeTeam ? homeTeam.name : (labelParts[0] || 'Por definir');
      const awayName = awayTeam ? awayTeam.name : (labelParts[1] || 'Por definir');

      const status = match.status || 'upcoming';
      const isLive = status === 'live' || status === 'halftime';
      const isCompleted = status === 'completed';
      const isHalftime = match.minute === 'HT';
      const hasScore = match.homeScore != null && match.awayScore != null;

      const matchClasses = ['calendar__match'];
      if (isLive) matchClasses.push('calendar__match--live');
      if (isCompleted) matchClasses.push('calendar__match--completed');

      // Time/status
      let timeDisplay = match._round || '';
      if (isHalftime) timeDisplay = '<span class="ht-badge"><span class="live-dot ht-dot"></span>HT</span>';
      else if (isLive) timeDisplay = `<span class="live-badge"><span class="live-dot"></span>EN VIVO ${match.minute ? match.minute + "'" : ''}</span>`;
      else if (isCompleted) timeDisplay = '<span class="ft-badge">FT</span>';

      // Score or VS
      let scoreHtml;
      if (hasScore) {
        scoreHtml = `
          <span class="calendar__match-score calendar__match-score--filled">${match.homeScore}</span>
          <span class="calendar__match-vs--dash">-</span>
          <span class="calendar__match-score calendar__match-score--filled">${match.awayScore}</span>
        `;
      } else {
        scoreHtml = `
          <div class="calendar__match-score"></div>
          <span class="calendar__match-vs">VS</span>
          <div class="calendar__match-score"></div>
        `;
      }

      html += `
        <div class="${matchClasses.join(' ')}">
          <div class="calendar__match-time">${timeDisplay}</div>
          <div class="calendar__match-teams">
            <div class="calendar__match-team">
              ${homeTeam ? getFlagHtml(homeTeam.code) : '<i class="fas fa-question" style="opacity:0.3"></i>'}
              <span>${homeName}</span>
            </div>
            ${scoreHtml}
            <div class="calendar__match-team">
              ${awayTeam ? getFlagHtml(awayTeam.code) : '<i class="fas fa-question" style="opacity:0.3"></i>'}
              <span>${awayName}</span>
            </div>
          </div>
          <div class="calendar__match-venue">
            <span class="calendar__match-venue--city">${date === 'TBD' ? '' : formatDate(date)}</span>
            <span class="calendar__match-group">${match._round || ''}</span>
          </div>
        </div>
      `;
    });

    html += '</div></div>';
  });

  container.innerHTML = html || '<div class="loading">No hay datos de eliminatorias.</div>';
}

/* ===== TIMEZONE SELECTOR ===== */
function initTimezoneSelector() {
  const select = document.getElementById('tz-select');
  if (!select) return;

  // Restore saved preference
  const saved = localStorage.getItem(LS_TZ_KEY);
  if (saved) {
    select.value = saved;
  } else {
    // Default: Argentina if system TZ matches, otherwise "Local"
    try {
      const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      select.value = sysTz === DEFAULT_TZ ? 'America/Argentina/Buenos_Aires' : 'local';
    } catch(e) {
      select.value = 'America/Argentina/Buenos_Aires';
    }
  }

  select.addEventListener('change', () => {
    const val = select.value;
    if (val === 'local') {
      localStorage.removeItem(LS_TZ_KEY);
    } else {
      localStorage.setItem(LS_TZ_KEY, val);
    }
    refreshTimes();
  });
}

/* ===== UTILITIES ===== */
function formatDate(dateStr) {
  const tz = getUserTimezone();
  const date = new Date(dateStr + 'T12:00:00'); // noon to avoid DST edge cases
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    timeZone: tz
  });
}

function formatDateFull(dateStr) {
  const tz = getUserTimezone();
  const date = new Date(dateStr + 'T12:00:00');
  const dayName = date.toLocaleDateString('es-AR', { weekday: 'long', timeZone: tz });
  const day = date.toLocaleDateString('es-AR', { day: 'numeric', timeZone: tz });
  const month = date.toLocaleDateString('es-AR', { month: 'long', timeZone: tz });
  // Capitalize first letter of day name
  const capitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
  return `${capitalized} ${day} de ${month}`;
}
