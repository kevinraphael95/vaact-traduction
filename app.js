// ============================================================================
// CONFIG
// ============================================================================
const CDB_EN_URL = 'data/VAACT_S1.cdb';
const CDB_FR_URL = 'data/VAACT_S1_fr.cdb';

// ============================================================================
// ÉTAT
// ============================================================================
let CARDS = [];
let currentIndex = 0;
let searchQuery = '';   // recherche active (lowercase, trimmed)

// ============================================================================
// TRADUCTION DES CODES YGOPRO
// ============================================================================
const ATTRIBUTES = {
  1: 'EARTH', 2: 'WATER', 4: 'FIRE', 8: 'WIND',
  16: 'LIGHT', 32: 'DARK', 64: 'DIVINE',
};

function attributeToString(attr) {
  if (!attr) return '—';
  return ATTRIBUTES[attr] || `Attr${attr}`;
}

const TYPES = [
  { v: 1,        label: 'Monstre' },
  { v: 2,        label: 'Magie' },
  { v: 4,        label: 'Piège' },
  { v: 16,       label: 'Normal' },
  { v: 32,       label: 'Effet' },
  { v: 64,       label: 'Fusion' },
  { v: 128,      label: 'Rituel' },
  { v: 256,      label: 'Spirit' },
  { v: 512,      label: 'Union' },
  { v: 1024,     label: 'Gemini' },
  { v: 2048,     label: 'Tuner' },
  { v: 4096,     label: 'Synchro' },
  { v: 16384,    label: 'Quick-Play' },
  { v: 65536,    label: 'Continu' },
  { v: 131072,   label: 'Équipement' },
  { v: 262144,   label: 'Terrain' },
  { v: 524288,   label: 'Compteur' },
  { v: 1048576,  label: 'Flip' },
  { v: 2097152,  label: 'Toon' },
  { v: 4194304,  label: 'Xyz' },
  { v: 8388608,  label: 'Pendule' },
  { v: 16777216, label: 'Lien' },
];

function typeToString(type) {
  if (!type) return '—';
  const parts = [];
  for (const t of TYPES) {
    if (type & t.v) parts.push(t.label);
  }
  return parts.length ? parts.join(' / ') : `Type ${type}`;
}

function formatStat(value) {
  if (value === null || value === undefined) return '—';
  if (value === -2) return '?';
  if (value === -1) return '?';
  if (value < 0) return '0';
  return String(value);
}

// ============================================================================
// FILTRES
// ============================================================================
function isVaactCard(card) {
  return (card.desc_fr || '').trim().startsWith('(VAACT');
}

function isIncompleteCard(card) {
  return card.missingFr === true || card.missingEn === true;
}

/** Vrai si au moins un filtre (VAACT, Incomplètes ou recherche) est actif. */
function hasActiveFilters() {
  return !!(
    document.getElementById('vaactFilter')?.checked ||
    document.getElementById('vaactFilterMobile')?.checked ||
    document.getElementById('incompleteFilter')?.checked ||
    document.getElementById('incompleteFilterMobile')?.checked ||
    searchQuery
  );
}

function getFilteredCards() {
  let list = CARDS;

  // VAACT (desktop OU mobile)
  const vaactChecked =
    document.getElementById('vaactFilter')?.checked ||
    document.getElementById('vaactFilterMobile')?.checked;
  if (vaactChecked) list = list.filter(isVaactCard);

  // Incomplètes (desktop OU mobile)
  const incompleteChecked =
    document.getElementById('incompleteFilter')?.checked ||
    document.getElementById('incompleteFilterMobile')?.checked;
  if (incompleteChecked) list = list.filter(isIncompleteCard);

  // Recherche (nom EN, nom FR, ID)
  if (searchQuery) {
    const q = searchQuery;
    list = list.filter(c =>
      (c.name_en || '').toLowerCase().includes(q) ||
      (c.name_fr || '').toLowerCase().includes(q) ||
      (c.id || '').includes(q)
    );
  }

  return list;
}

// ============================================================================
// IMAGES — Récupération depuis YGOPRODeck par nom
// ============================================================================
const imageCache = {};

async function fetchCardImage(cardName) {
  if (!cardName) return null;
  if (imageCache[cardName] !== undefined) return imageCache[cardName];

  const lsKey = 'img_' + cardName;
  try {
    const cached = localStorage.getItem(lsKey);
    if (cached) {
      imageCache[cardName] = cached;
      return cached;
    }
  } catch (e) {}

  try {
    const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(cardName)}`;
    const res = await fetch(url);
    if (!res.ok) {
      imageCache[cardName] = null;
      return null;
    }
    const data = await res.json();
    const imgUrl = data.data?.[0]?.card_images?.[0]?.image_url_cropped
                || data.data?.[0]?.card_images?.[0]?.image_url
                || null;
    imageCache[cardName] = imgUrl;
    if (imgUrl) {
      try { localStorage.setItem(lsKey, imgUrl); } catch (e) {}
    }
    return imgUrl;
  } catch (err) {
    imageCache[cardName] = null;
    return null;
  }
}

async function loadCardImage(card) {
  const imgEl = document.getElementById('cardImg');
  if (!imgEl) return;

  imgEl.removeAttribute('src');
  imgEl.style.display = 'none';

  const parent = imgEl.parentElement;

  let ph = parent.querySelector('.img-placeholder');
  if (!ph) {
    ph = document.createElement('div');
    ph.className = 'img-placeholder';
    ph.textContent = '🃏';
    ph.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:48px;color:#555;';
    parent.style.position = 'relative';
    parent.appendChild(ph);
  }

  const imgUrl = await fetchCardImage(card.name_en) || await fetchCardImage(card.name_fr);
  if (getFilteredCards()[currentIndex] !== card) return;
  if (!imgUrl) return;

  if (ph) ph.remove();
  imgEl.src = imgUrl;
  imgEl.style.display = 'block';
}

// ============================================================================
// CHARGEMENT
// ============================================================================
async function fetchBuffer(url, label) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${label} introuvable (HTTP ${res.status}) — URL testée : ${url}`);
  }
  const buf = await res.arrayBuffer();

  const header = new TextDecoder().decode(buf.slice(0, 16));
  if (!header.startsWith('SQLite format 3')) {
    throw new Error(
      `${label} n'est pas un fichier SQLite valide — ` +
      `l'URL renvoie probablement une page HTML 404. ` +
      `Vérifie que le fichier existe bien à : ${url}`
    );
  }
  return buf;
}

async function loadCards() {
  const loadingText = document.getElementById('loadingText');

  try {
    loadingText.textContent = 'Initialisation de SQLite…';
    const SQL = await initSqlJs({
      locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`,
    });

    loadingText.textContent = 'Chargement du cdb original (EN)…';
    const enBuffer = await fetchBuffer(CDB_EN_URL, 'Fichier EN');
    const enDb = new SQL.Database(new Uint8Array(enBuffer));

    loadingText.textContent = 'Chargement du cdb traduit (FR)…';
    const frBuffer = await fetchBuffer(CDB_FR_URL, 'Fichier FR');
    const frDb = new SQL.Database(new Uint8Array(frBuffer));

    loadingText.textContent = 'Extraction des cartes…';
    const enCards = extractCards(enDb);
    const frCards = extractCards(frDb);

    loadingText.textContent = 'Fusion des traductions…';
    CARDS = mergeCards(enCards, frCards);

    const missingFr = CARDS.filter(c => c.missingFr).length;
    const missingEn = CARDS.filter(c => c.missingEn).length;
    console.log(`✅ ${CARDS.length} cartes chargées`);
    console.log(`   • ${missingFr} sans traduction FR`);
    console.log(`   • ${missingEn} sans original EN`);

    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('navBar').style.display = 'block';

    render();

  } catch (err) {
    console.error('❌ Erreur:', err);
    loadingText.innerHTML = `❌ Erreur : ${err.message}<br><br>
      <small>Vérifie que les fichiers .cdb sont bien dans <code>data/</code> et accessibles.</small>`;
  }
}

// ============================================================================
// EXTRACTION
// ============================================================================
function extractCards(db) {
  const textsResult = db.exec("SELECT id, name, desc FROM texts")[0];
  if (!textsResult) return {};

  const texts = textsResult.values;

  let datasResult;
  try {
    datasResult = db.exec("SELECT id, type, atk, def, level, race, attribute FROM datas")[0];
  } catch (e) {
    datasResult = null;
  }

  const datasById = {};
  if (datasResult) {
    for (const row of datasResult.values) {
      datasById[String(row[0])] = {
        type: row[1],
        atk: row[2],
        def: row[3],
        level: row[4],
        race: row[5],
        attribute: row[6],
      };
    }
  }

  const cards = {};
  for (const [id, name, desc] of texts) {
    const idStr = String(id);
    cards[idStr] = {
      id: idStr,
      name: name || '',
      desc: desc || '',
      ...(datasById[idStr] || {}),
    };
  }
  return cards;
}

// ============================================================================
// FUSION — avec détection des cartes orphelines
// ============================================================================
function mergeCards(enCards, frCards) {
  const result = [];
  const enOnly = [];
  const frOnly = [];

  for (const id in enCards) {
    const en = enCards[id];
    const fr = frCards[id];

    if (!fr) {
      enOnly.push({ id, name: en.name });
      result.push({
        id: en.id,
        name_en: en.name,
        desc_en: en.desc,
        name_fr: '',
        desc_fr: '',
        type: en.type || '',
        atk: en.atk ?? null,
        def: en.def ?? null,
        level: en.level ?? null,
        attribute: en.attribute || '',
        missingFr: true,
      });
      continue;
    }

    result.push({
      id: en.id,
      name_en: en.name,
      desc_en: en.desc,
      name_fr: fr.name,
      desc_fr: fr.desc,
      type: en.type || fr.type || '',
      atk: en.atk ?? null,
      def: en.def ?? null,
      level: en.level ?? null,
      attribute: en.attribute || '',
    });
  }

  for (const id in frCards) {
    if (enCards[id]) continue;
    const fr = frCards[id];
    frOnly.push({ id, name: fr.name });
    result.push({
      id: fr.id,
      name_en: '',
      desc_en: '',
      name_fr: fr.name,
      desc_fr: fr.desc,
      type: fr.type || '',
      atk: fr.atk ?? null,
      def: fr.def ?? null,
      level: fr.level ?? null,
      attribute: fr.attribute || '',
      missingEn: true,
    });
  }

  if (enOnly.length) {
    console.warn(`⚠️ ${enOnly.length} carte(s) présente(s) en EN mais absente(s) en FR :`);
    console.table(enOnly);
  }
  if (frOnly.length) {
    console.warn(`⚠️ ${frOnly.length} carte(s) présente(s) en FR mais absente(s) en EN :`);
    console.table(frOnly);
  }
  if (!enOnly.length && !frOnly.length) {
    console.log('✅ Aucune carte orpheline — les deux fichiers sont synchronisés.');
  }

  result.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  return result;
}

// ============================================================================
// RENDER
// ============================================================================
function render() {
  if (!CARDS.length) return;
  const filtered = getFilteredCards();

  if (!filtered.length) {
    document.getElementById('infoId').textContent = '—';
    document.getElementById('infoType').textContent = '—';
    document.getElementById('infoAttr').textContent = '—';
    document.getElementById('infoStats').textContent = '—';
    document.getElementById('infoLevel').textContent = '—';
    document.getElementById('origName').textContent = '—';
    document.getElementById('origDesc').textContent =
      searchQuery
        ? `Aucune carte ne correspond à « ${esc(searchQuery)} ».`
        : 'Aucune carte ne correspond aux filtres actifs.';
    document.getElementById('translationSection').innerHTML = '';
    document.getElementById('navCenter').textContent = '0 / 0';
    document.getElementById('prevBtn').disabled = true;
    document.getElementById('nextBtn').disabled = true;
    return;
  }

  if (currentIndex >= filtered.length) currentIndex = 0;

  const card = filtered[currentIndex];

  loadCardImage(card);

  document.getElementById('infoId').textContent = card.id || '—';
  document.getElementById('infoType').textContent = typeToString(card.type);
  document.getElementById('infoAttr').textContent = attributeToString(card.attribute);
  document.getElementById('infoStats').textContent =
    formatStat(card.atk) + ' / ' + formatStat(card.def);
  document.getElementById('infoLevel').textContent = card.level ?? '—';

  document.getElementById('origName').textContent = card.name_en || '—';
  document.getElementById('origDesc').textContent = card.desc_en || '—';

  renderTranslation(card);

  document.getElementById('navCenter').textContent = `${currentIndex + 1} / ${filtered.length}`;
  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').disabled = currentIndex === filtered.length - 1;
}

function renderTranslation(card) {
  const container = document.getElementById('translationSection');
  const isVaact = isVaactCard(card);

  let missingBadge = '';
  if (card.missingFr) {
    missingBadge = `<span class="badge-source missing">⚠️ Traduction FR manquante</span>`;
  } else if (card.missingEn) {
    missingBadge = `<span class="badge-source missing">⚠️ Original EN manquant</span>`;
  }

  const frName = card.missingFr
    ? '<em style="opacity:.5;">— aucune traduction FR pour cette carte —</em>'
    : esc(card.name_fr || '—');
  const frDesc = card.missingFr
    ? '<em style="opacity:.5;">Cette carte existe dans le fichier EN mais n\'a pas de correspondance dans le fichier FR.</em>'
    : esc(card.desc_fr || '—');

  container.innerHTML = `
    <div class="translation${card.missingFr || card.missingEn ? ' incomplete' : ''}">
      <div class="trans-head">
        <div class="trans-meta">
          <span class="badge-source manual">Traduction</span>
          ${isVaact ? `<span class="badge-source vaact">VAACT</span>` : ''}
          ${missingBadge}
        </div>
      </div>
      <div class="trans-name">${frName}</div>
      <div class="trans-desc">${frDesc}</div>
    </div>
  `;
}

// ============================================================================
// NAVIGATION
// ============================================================================
function goPrev() {
  if (currentIndex > 0) { currentIndex--; render(); }
}
function goNext() {
  const filtered = getFilteredCards();
  if (currentIndex < filtered.length - 1) { currentIndex++; render(); }
}
function goRandom() {
  const filtered = getFilteredCards();
  if (!filtered.length) return;
  currentIndex = Math.floor(Math.random() * filtered.length);
  render();
}

document.getElementById('prevBtn').addEventListener('click', goPrev);
document.getElementById('nextBtn').addEventListener('click', goNext);
document.getElementById('randomBtn').addEventListener('click', goRandom);

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') goPrev();
  else if (e.key === 'ArrowRight') goNext();
});

// ============================================================================
// RECHERCHE — agit comme un filtre (nom EN, nom FR, ID)
// ============================================================================
const searchInput = document.getElementById('searchInput');

// Debounce pour ne pas recalculer à chaque frappe
let searchDebounceTimer = null;

function applySearch(value) {
  searchQuery = (value || '').trim().toLowerCase();
  currentIndex = 0;
  render();
  updateSearchIndicator();
  updateMobileFiltersIndicator();
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => applySearch(searchInput.value), 200);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchDebounceTimer);
    applySearch(searchInput.value);
    searchInput.blur();
  } else if (e.key === 'Escape') {
    clearTimeout(searchDebounceTimer);
    searchInput.value = '';
    applySearch('');
  }
});

/** Affiche/masque la croix × dans le champ quand une recherche est active. */
function updateSearchIndicator() {
  const wrap = searchInput.closest('.search-wrap') || searchInput.parentElement;
  if (wrap) wrap.classList.toggle('has-search', !!searchQuery);
}

// Bouton × (présent uniquement si tu utilises le wrapper dans le HTML)
document.getElementById('searchClear')?.addEventListener('click', () => {
  searchInput.value = '';
  applySearch('');
  searchInput.focus();
});

// ============================================================================
// FILTRES — synchronisation desktop ↔ mobile
// ============================================================================
/** Met à jour la pastille rouge sur le bouton ☰ si un filtre est actif. */
function updateMobileFiltersIndicator() {
  const btn = document.getElementById('mobileFiltersBtn');
  if (!btn) return;
  btn.classList.toggle('active', hasActiveFilters());
}

/**
 * Lie une paire de checkboxes (desktop + mobile) pour qu'elles soient
 * toujours synchronisées. Un changement sur l'une déclenche un re-render
 * et met à jour la pastille du bouton ☰.
 */
function bindFilterPair(desktopId, mobileId) {
  const d = document.getElementById(desktopId);
  const m = document.getElementById(mobileId);

  const handleChange = (source, target) => () => {
    if (target) target.checked = source.checked;
    currentIndex = 0;
    render();
    updateMobileFiltersIndicator();
  };

  if (d) d.addEventListener('change', handleChange(d, m));
  if (m) m.addEventListener('change', handleChange(m, d));
}

bindFilterPair('vaactFilter', 'vaactFilterMobile');
bindFilterPair('incompleteFilter', 'incompleteFilterMobile');

// ============================================================================
// PANNEAU FILTRES MOBILE
// ============================================================================
const mobileFiltersBtn = document.getElementById('mobileFiltersBtn');
const mobileFiltersPanel = document.getElementById('mobileFiltersPanel');

function openMobileFilters() {
  mobileFiltersPanel?.classList.add('open');
}
function closeMobileFilters() {
  mobileFiltersPanel?.classList.remove('open');
}

if (mobileFiltersBtn && mobileFiltersPanel) {
  mobileFiltersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mobileFiltersPanel.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!mobileFiltersPanel.contains(e.target) && e.target !== mobileFiltersBtn) {
      closeMobileFilters();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileFilters();
  });
}

// ============================================================================
// UTIL
// ============================================================================
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================================
// THÈME SOMBRE
// ============================================================================
const THEME_KEY = 'vaact-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  const isDark = theme === 'dark';
  const icon = isDark ? '☀️' : '🌙';

  const btnDesktop = document.getElementById('themeToggle');
  if (btnDesktop) btnDesktop.textContent = icon;

  const btnMobile = document.getElementById('themeToggleMobile');
  if (btnMobile) {
    btnMobile.textContent = isDark ? '☀️ Thème clair' : '🌙 Thème sombre';
  }
}

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

const themeMobileBtn = document.getElementById('themeToggleMobile');
if (themeMobileBtn) {
  themeMobileBtn.addEventListener('click', () => {
    toggleTheme();
  });
}

// ============================================================================
// INIT
// ============================================================================
loadCards();
