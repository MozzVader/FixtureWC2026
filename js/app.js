/**
 * FIFA World Cup 2026 — Main App
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initCountdown();
  initCalendar();
  initGroups();
  initBracket();
  initStats();
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
function initCountdown() {
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

  // Populate upcoming matches in hero
  renderUpcomingMatches();
}

function renderUpcomingMatches() {
  const container = document.getElementById('upcoming-matches');
  if (!container) return;

  // Get first 3 group stage matches
  const upcoming = MATCHES.slice(0, 3);
  let html = '';

  upcoming.forEach(match => {
    const home = TEAMS[match.home];
    const away = TEAMS[match.away];
    if (!home || !away) return;

    html += `
      <div class="upcoming__match">
        <div class="upcoming__teams">
          <div class="upcoming__team">
            ${getFlagHtml(home.code, 'lg')}
            <span class="upcoming__team-name">${home.name}</span>
          </div>
          <span class="upcoming__vs">VS</span>
          <div class="upcoming__team">
            ${getFlagHtml(away.code, 'lg')}
            <span class="upcoming__team-name">${away.name}</span>
          </div>
        </div>
        <div class="upcoming__info">
          <span class="upcoming__date">${formatDate(match.date)} — ${match.time} hs</span>
          <span>${match.city} · <span class="calendar__match-group">Grupo ${match.group}</span></span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/* ===== CALENDAR ===== */
function initCalendar() {
  const container = document.getElementById('calendar-content');
  const filterContainer = document.getElementById('calendar-filters');
  if (!container) return;

  const groupMatches = MATCHES.filter(m => m.stage === 'group');

  // Render filter buttons
  if (filterContainer) {
    let filterHtml = '<button class="calendar__filter-btn active" data-filter="all">Todos</button>';
    filterHtml += '<button class="calendar__filter-btn" data-filter="arg">Argentina</button>';
    'ABCDEFGHIJKL'.split('').forEach(g => {
      filterHtml += `<button class="calendar__filter-btn" data-filter="${g}">Grupo ${g}</button>`;
    });
    filterContainer.innerHTML = filterHtml;

    filterContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.calendar__filter-btn');
      if (!btn) return;

      filterContainer.querySelectorAll('.calendar__filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      renderCalendar(container, groupMatches, filter);
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

      html += `
        <div class="calendar__match">
          <div class="calendar__match-time">${match.time}</div>
          <div class="calendar__match-teams">
            <div class="calendar__match-team">
              ${getFlagHtml(home.code)}
              <span>${home.name}</span>
            </div>
            <div class="calendar__match-score"></div>
            <span class="calendar__match-vs">VS</span>
            <div class="calendar__match-score"></div>
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

  const r32 = KNOCKOUT.roundOf32;
  const r16 = KNOCKOUT.roundOf16;
  const qf  = KNOCKOUT.quarterfinals;
  const sf  = KNOCKOUT.semifinals;
  const fin = KNOCKOUT.final;
  const tp  = KNOCKOUT.thirdPlace;

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
  const homeTeam = match.home ? TEAMS[match.home] : null;
  const awayTeam = match.away ? TEAMS[match.away] : null;

  return `
    <div class="bracket__match" ${isFinal ? 'style="border-color: var(--dorado-500); box-shadow: var(--sombra-dorada);"' : ''}>
      <div class="bracket__team ${homeTeam ? '' : 'bracket__team--tbd'}">
        ${homeTeam ? getFlagHtml(homeTeam.code) : ''}
        <span class="bracket__team-name">${homeTeam ? homeTeam.name : match.label.split(' vs ')[0] || 'Por definir'}</span>
        ${match.homeScore !== undefined ? `<span class="bracket__team-score">${match.homeScore}</span>` : ''}
      </div>
      <div class="bracket__team ${awayTeam ? '' : 'bracket__team--tbd'}">
        ${awayTeam ? getFlagHtml(awayTeam.code) : ''}
        <span class="bracket__team-name">${awayTeam ? awayTeam.name : match.label.split(' vs ')[1] || 'Por definir'}</span>
        ${match.awayScore !== undefined ? `<span class="bracket__team-score">${match.awayScore}</span>` : ''}
      </div>
      <div class="bracket__match-info">${formatDate(match.date)}</div>
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
  container.innerHTML = `
    <div class="stat-empty">
      <i class="fas fa-futbol"></i>
      Los goleadores aparecerán aquí una vez que comience el torneo.
    </div>
  `;
}

function renderCards() {
  const container = document.getElementById('cards-content');
  if (!container) return;
  container.innerHTML = `
    <div class="stat-empty">
      <i class="fas fa-square" style="color: #FFD700"></i>
      <i class="fas fa-square" style="color: #E53935"></i>
      Las tarjetas aparecerán aquí una vez que comience el torneo.
    </div>
  `;
}

/* ===== UTILITIES ===== */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function formatDateFull(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return `${days[date.getDay()]} ${date.getDate()} de ${date.toLocaleDateString('es-AR', { month: 'long' })}`;
}
