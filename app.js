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
let customKeywords = [];           // filtres personnalisés (lowercase)
const CUSTOM_KEYWORDS_LS = 'vaact-custom-keywords';

// Restaure les mots-clés sauvegardés
(function restoreCustomKeywords() {
  try {
    const saved = localStorage.getItem(CUSTOM_KEYWORDS_LS);
    if (saved) customKeywords = JSON.parse(saved);
    if (!Array.isArray(customKeywords)) customKeywords = [];
  } catch (e) {
    customKeywords = [];
  }
})();

function saveCustomKeywords() {
  try {
    localStorage.setItem(CUSTOM_KEYWORDS_LS, JSON.stringify(customKeywords));
  } catch (e) {}
}

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

/** Récupère l'état des filtres depuis le DOM. */
function getFilterState() {
  return {
    vaact: !!document.getElementById('filterVaact')?.checked,
    incomplete: !!document.getElementById('filterIncomplete')?.checked,
    keywords: customKeywords,
  };
}

/** Compte combien de filtres sont actifs (pour le badge). */
function countActiveFilters() {
  const { vaact, incomplete, keywords } = getFilterState();
  return (vaact ? 1 : 0) + (incomplete ? 1 : 0) + keywords.length;
}

function getFilteredCards() {
  let list = CARDS;
  const { vaact, incomplete, keywords } = getFilterState();

  if (vaact) list = list.filter(isVaactCard);
  if (incomplete) list = list.filter(isIncompleteCard);

  if (keywords.length) {
    list = list.filter(c => {
      const haystack = [
        (c.name_en || '').toLowerCase(),
        (c.name_fr || '').toLowerCase(),
        (c.id || ''),
      ].join(' ');
      return keywords.every(kw => haystack.includes(kw));
    });
  }

  return list;
}

/** Met à jour le badge du bouton Filtres + l'état visuel du bouton. */
function updateFiltersBadge() {
  const btn = document.getElementById('filtersBtn');
  if (!btn) return;

  const count = countActiveFilters();
  btn.classList.toggle('active', count > 0);

  const badge = btn.querySelector('.badge-count');
  if (badge) {
    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
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

    renderCustomChips();
    updateFiltersBadge();
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
      document.getElementById('origDesc').textContent = 'Aucune carte ne correspond aux filtres actifs.';
      document.getElementById('translationSection').innerHTML = '';
  
      // Vider l'image et remettre le placeholder
      const imgEl = document.getElementById('cardImg');
      if (imgEl) {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
        const p = imgEl.parentElement;
        let ph = p.querySelector('.img-placeholder');
        if (!ph) {
          ph = document.createElement('div');
          ph.className = 'img-placeholder';
          ph.textContent = '🃏';
          ph.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:48px;color:#555;';
          p.style.position = 'relative';
          p.appendChild(ph);
        }
      }
  
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
// PANNEAU FILTRES
// ============================================================================
const filtersBtn = document.getElementById('filtersBtn');
const filtersPanel = document.getElementById('filtersPanel');

function openFiltersPanel() {
  filtersPanel?.classList.add('open');
}
function closeFiltersPanel() {
  filtersPanel?.classList.remove('open');
}

if (filtersBtn && filtersPanel) {
  filtersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    filtersPanel.classList.toggle('open');
  });

  // Clic en dehors du panneau → fermeture
  document.addEventListener('click', (e) => {
    if (!filtersPanel.contains(e.target) && !filtersBtn.contains(e.target)) {
      closeFiltersPanel();
    }
  });

  // Échap → fermeture
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFiltersPanel();
  });
}

// ============================================================================
// FILTRES — checkboxes VAACT + Incomplètes
// ============================================================================
['filterVaact', 'filterIncomplete'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    currentIndex = 0;
    render();
    updateFiltersBadge();
  });
});

// ============================================================================
// FILTRES PERSONNALISÉS — mots-clés cumulables
// ============================================================================
const customInput = document.getElementById('customKeywordInput');
const customAddBtn = document.getElementById('customAddBtn');
const customChips = document.getElementById('customChips');
const customResetBtn = document.getElementById('filterResetBtn');

function addCustomKeyword(rawValue) {
  const value = (rawValue || '').trim().toLowerCase();
  if (!value) return;
  if (customKeywords.includes(value)) return;

  customKeywords.push(value);
  saveCustomKeywords();
  renderCustomChips();
  currentIndex = 0;
  render();
  updateFiltersBadge();
}

function removeCustomKeyword(value) {
  const idx = customKeywords.indexOf(value);
  if (idx === -1) return;
  customKeywords.splice(idx, 1);
  saveCustomKeywords();
  renderCustomChips();
  currentIndex = 0;
  render();
  updateFiltersBadge();
}

function renderCustomChips() {
  if (!customChips) return;

  if (!customKeywords.length) {
    customChips.innerHTML = '';
    return;
  }

  customChips.innerHTML = customKeywords.map(kw => `
    <span class="custom-chip">
      <span class="chip-label">${esc(kw)}</span>
      <button type="button" class="chip-remove" data-keyword="${esc(kw)}" title="Retirer" aria-label="Retirer ${esc(kw)}">✕</button>
    </span>
  `).join('');

  customChips.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCustomKeyword(btn.dataset.keyword);
    });
  });
}

if (customAddBtn && customInput) {
  customAddBtn.addEventListener('click', () => {
    addCustomKeyword(customInput.value);
    customInput.value = '';
    customInput.focus();
  });

  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomKeyword(customInput.value);
      customInput.value = '';
    }
  });
}

if (customResetBtn) {
  customResetBtn.addEventListener('click', () => {
    const v = document.getElementById('filterVaact');
    const i = document.getElementById('filterIncomplete');
    if (v) v.checked = false;
    if (i) i.checked = false;

    customKeywords = [];
    saveCustomKeywords();
    renderCustomChips();

    currentIndex = 0;
    render();
    updateFiltersBadge();
  });
}

// ============================================================================
// RECHERCHE — saute à la première carte correspondante
// ============================================================================
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');

/** Affiche/masque la croix × selon le contenu du champ. */
function updateSearchIndicator() {
  if (!searchInput) return;
  const wrap = searchInput.closest('.search-wrap') || searchInput.parentElement;
  if (wrap) wrap.classList.toggle('has-search', searchInput.value.trim().length > 0);
}

/** Cherche la première carte correspondante dans la liste filtrée et y saute. */
function jumpToFirstMatch() {
  if (!searchInput) return;
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return;

  const filtered = getFilteredCards();
  const found = filtered.findIndex(c =>
    (c.name_en || '').toLowerCase().includes(q) ||
    (c.name_fr || '').toLowerCase().includes(q) ||
    (c.id || '').includes(q)
  );

  if (found >= 0) {
    currentIndex = found;
    render();
  }
}

if (searchInput) {
  // Met à jour la croix × à chaque frappe
  searchInput.addEventListener('input', updateSearchIndicator);

  // Entrée → saute à la carte
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToFirstMatch();
      searchInput.blur();
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      updateSearchIndicator();
    }
  });
}

if (searchClear) {
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    updateSearchIndicator();
    searchInput.focus();
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
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
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

const themeBtn = document.getElementById('themeToggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

// ============================================================================
// INIT
// ============================================================================
loadCards();
