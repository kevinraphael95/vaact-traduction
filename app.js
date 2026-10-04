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
// FILTRE VAACT
// ============================================================================
function isVaactCard(card) {
  return (card.desc_fr || '').trim().startsWith('(VAACT)');
}

function getFilteredCards() {
  const checkbox = document.getElementById('vaactFilter');
  if (checkbox && checkbox.checked) {
    return CARDS.filter(isVaactCard);
  }
  return CARDS;
}

// ============================================================================
// IMAGES — Récupération depuis YGOPRODeck par nom
// ============================================================================
const imageCache = {};

async function fetchCardImage(cardName) {
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

  const imgUrl = await fetchCardImage(card.name_en);
  if (getFilteredCards()[currentIndex] !== card) return;
  if (!imgUrl) return;

  if (ph) ph.remove();
  imgEl.src = imgUrl;
  imgEl.style.display = 'block';
}

// ============================================================================
// CHARGEMENT
// ============================================================================
async function loadCards() {
  const loadingText = document.getElementById('loadingText');

  try {
    loadingText.textContent = 'Initialisation de SQLite…';
    const SQL = await initSqlJs({
      locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`,
    });

    loadingText.textContent = 'Chargement du cdb original (EN)…';
    const enBuffer = await fetch(CDB_EN_URL).then(r => r.arrayBuffer());
    const enDb = new SQL.Database(new Uint8Array(enBuffer));

    loadingText.textContent = 'Chargement du cdb traduit (FR)…';
    const frBuffer = await fetch(CDB_FR_URL).then(r => r.arrayBuffer());
    const frDb = new SQL.Database(new Uint8Array(frBuffer));

    loadingText.textContent = 'Extraction des cartes…';
    const enCards = extractCards(enDb);
    const frCards = extractCards(frDb);

    loadingText.textContent = 'Fusion des traductions…';
    CARDS = mergeCards(enCards, frCards);
    console.log(`✅ ${CARDS.length} cartes chargées`);

    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('navBar').style.display = 'block';

    render();

  } catch (err) {
    console.error('❌ Erreur:', err);
    loadingText.innerHTML = `❌ Erreur : ${err.message}<br><br>
      <small>Vérifie que les fichiers .cdb sont bien dans <code>data/</code></small>`;
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
// FUSION
// ============================================================================
function mergeCards(enCards, frCards) {
  const result = [];
  for (const id in enCards) {
    const en = enCards[id];
    const fr = frCards[id];
    if (!fr) continue;

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
      image: '',
      up: 0,
      down: 0,
      comments: [],
    });
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
  if (!filtered.length) return;

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
  const comments = card.comments || [];
  const vote = getVotes()[card.id] || null;
  const upClass = vote === 'up' ? 'voted-up' : '';
  const downClass = vote === 'down' ? 'voted-down' : '';
  const up = card.up || 0;
  const down = card.down || 0;
  const isVaact = isVaactCard(card);

  container.innerHTML = `
    <div class="translation">
      <div class="trans-head">
        <div class="trans-meta">
          <span class="badge-source manual">Traduction</span>
          ${isVaact ? `<span class="badge-source vaact">VAACT</span>` : ''}
        </div>
        <div class="trans-votes">
          <button class="vote-btn ${upClass}" data-vote="up">▲ ${up}</button>
          <button class="vote-btn ${downClass}" data-vote="down">▼ ${down}</button>
        </div>
      </div>
      <div class="trans-name">${esc(card.name_fr || '—')}</div>
      <div class="trans-desc">${esc(card.desc_fr || '—')}</div>

      <div class="comments-footer">
        <button class="comments-toggle" id="commentsToggle">
          <span class="arrow">▶</span>
          💬 ${comments.length} commentaire${comments.length > 1 ? 's' : ''}
        </button>
        <button class="comments-toggle" id="addCommentBtn">＋ Commenter</button>
      </div>

      <div class="comments-section" id="commentsSection">
        ${comments.length === 0
          ? `<div class="no-comments">Aucun commentaire pour le moment</div>`
          : [...comments].sort((a, b) => (b.up - b.down) - (a.up - a.down)).map(c => {
              const cv = getCommentVotes()[c.id];
              const cupClass = cv === 'up' ? 'voted-up' : '';
              const cdownClass = cv === 'down' ? 'voted-down' : '';
              return `
                <div class="comment">
                  <div class="comment-votes">
                    <button class="comment-vote-btn ${cupClass}" data-comment-id="${c.id}" data-vote="up">▲</button>
                    <span class="comment-score">${c.up - c.down}</span>
                    <button class="comment-vote-btn ${cdownClass}" data-comment-id="${c.id}" data-vote="down">▼</button>
                  </div>
                  <div class="comment-body">
                    <div class="comment-author">${esc(c.author)}</div>
                    <div class="comment-text">${esc(c.text)}</div>
                  </div>
                </div>
              `;
            }).join('')}

        <div class="comment-form" id="commentForm" style="display:none;">
          <input type="text" placeholder="Ton pseudo (optionnel)" id="commentAuthor">
          <textarea placeholder="Ta remarque / correction…" id="commentText"></textarea>
          <div class="comment-form-actions">
            <button class="btn-primary" id="commentSubmit">Publier</button>
            <button class="btn-secondary" id="commentCancel">Annuler</button>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.vote-btn').forEach(btn =>
    btn.addEventListener('click', () => handleVote(btn))
  );
  container.querySelectorAll('.comment-vote-btn').forEach(btn =>
    btn.addEventListener('click', () => handleCommentVote(btn))
  );
  document.getElementById('commentsToggle').addEventListener('click', () => {
    document.getElementById('commentsSection').classList.toggle('open');
    document.getElementById('commentsToggle').classList.toggle('open');
  });
  document.getElementById('addCommentBtn').addEventListener('click', () => {
    document.getElementById('commentsSection').classList.add('open');
    document.getElementById('commentsToggle').classList.add('open');
    document.getElementById('commentForm').style.display = 'block';
    document.getElementById('commentAuthor').value = getUser();
    document.getElementById('commentText').focus();
  });
  document.getElementById('commentCancel').addEventListener('click', () => {
    document.getElementById('commentForm').style.display = 'none';
  });
  document.getElementById('commentSubmit').addEventListener('click', handleCommentSubmit);
}

// ============================================================================
// VOTES (localStorage)
// ============================================================================
const VOTES_KEY = 'vaact-votes';
const COMMENT_VOTES_KEY = 'vaact-comment-votes';
const USER_KEY = 'vaact-user';

function getVotes() {
  try { return JSON.parse(localStorage.getItem(VOTES_KEY) || '{}'); }
  catch { return {}; }
}
function setVote(id, v) {
  const x = getVotes(); x[id] = v;
  localStorage.setItem(VOTES_KEY, JSON.stringify(x));
}
function removeVote(id) {
  const x = getVotes(); delete x[id];
  localStorage.setItem(VOTES_KEY, JSON.stringify(x));
}
function handleVote(btn) {
  const filtered = getFilteredCards();
  const card = filtered[currentIndex];
  if (!card) return;
  const id = card.id;
  const vote = btn.dataset.vote;
  const votes = getVotes();

  if (votes[id] === vote) {
    removeVote(id);
    vote === 'up' ? card.up-- : card.down--;
  } else if (votes[id]) {
    const old = votes[id];
    old === 'up' ? card.up-- : card.down--;
    vote === 'up' ? card.up++ : card.down++;
    setVote(id, vote);
  } else {
    vote === 'up' ? card.up++ : card.down++;
    setVote(id, vote);
  }
  render();
}

function getCommentVotes() {
  try { return JSON.parse(localStorage.getItem(COMMENT_VOTES_KEY) || '{}'); }
  catch { return {}; }
}
function setCommentVote(id, v) {
  const x = getCommentVotes(); x[id] = v;
  localStorage.setItem(COMMENT_VOTES_KEY, JSON.stringify(x));
}
function removeCommentVote(id) {
  const x = getCommentVotes(); delete x[id];
  localStorage.setItem(COMMENT_VOTES_KEY, JSON.stringify(x));
}
function handleCommentVote(btn) {
  const id = parseInt(btn.dataset.commentId);
  const vote = btn.dataset.vote;
  const votes = getCommentVotes();
  const filtered = getFilteredCards();
  const card = filtered[currentIndex];
  if (!card || !card.comments) return;
  const comment = card.comments.find(c => c.id === id);
  if (!comment) return;

  if (votes[id] === vote) {
    removeCommentVote(id);
    vote === 'up' ? comment.up-- : comment.down--;
  } else if (votes[id]) {
    const old = votes[id];
    old === 'up' ? comment.up-- : comment.down--;
    vote === 'up' ? comment.up++ : comment.down++;
    setCommentVote(id, vote);
  } else {
    vote === 'up' ? comment.up++ : comment.down++;
    setCommentVote(id, vote);
  }
  render();
  setTimeout(() => {
    document.getElementById('commentsSection')?.classList.add('open');
    document.getElementById('commentsToggle')?.classList.add('open');
  }, 0);
}

// ============================================================================
// COMMENTAIRES
// ============================================================================
function getUser() { return localStorage.getItem(USER_KEY) || ''; }
function setUser(n) { if (n) localStorage.setItem(USER_KEY, n); }

function handleCommentSubmit() {
  const author = document.getElementById('commentAuthor').value.trim() || getUser() || 'Anonyme';
  const text = document.getElementById('commentText').value.trim();
  if (!text) return;
  if (document.getElementById('commentAuthor').value.trim()) {
    setUser(document.getElementById('commentAuthor').value.trim());
  }

  const filtered = getFilteredCards();
  const card = filtered[currentIndex];
  if (!card) return;
  if (!card.comments) card.comments = [];
  card.comments.push({ id: Date.now(), author, text, up: 0, down: 0 });
  render();
  setTimeout(() => {
    document.getElementById('commentsSection')?.classList.add('open');
    document.getElementById('commentsToggle')?.classList.add('open');
  }, 0);
}

// ============================================================================
// NAV
// ============================================================================
document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentIndex > 0) { currentIndex--; render(); }
});
document.getElementById('nextBtn').addEventListener('click', () => {
  const filtered = getFilteredCards();
  if (currentIndex < filtered.length - 1) { currentIndex++; render(); }
});
document.getElementById('randomBtn').addEventListener('click', () => {
  const filtered = getFilteredCards();
  currentIndex = Math.floor(Math.random() * filtered.length);
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const filtered = getFilteredCards();
  if (e.key === 'ArrowLeft' && currentIndex > 0) { currentIndex--; render(); }
  else if (e.key === 'ArrowRight' && currentIndex < filtered.length - 1) { currentIndex++; render(); }
});

// ============================================================================
// SEARCH
// ============================================================================
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const filtered = getFilteredCards();
  const found = filtered.findIndex(c =>
    (c.name_en || '').toLowerCase().includes(q)
    || (c.name_fr || '').toLowerCase().includes(q)
    || (c.id || '').includes(q)
  );
  if (found >= 0) { currentIndex = found; render(); }
});

// ============================================================================
// FILTRE VAACT — event
// ============================================================================
document.getElementById('vaactFilter').addEventListener('change', () => {
  currentIndex = 0;
  render();
});

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

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
})();

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// ============================================================================
// INIT
// ============================================================================
loadCards();
