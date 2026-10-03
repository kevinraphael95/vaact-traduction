// ============================================================================
// CHARGEMENT DES CARTES
// ============================================================================
let CARDS = [];
let currentIndex = 0;

async function loadCards() {
  try {
    const res = await fetch('data/cards.json');
    if (!res.ok) throw new Error('cards.json introuvable');
    CARDS = await res.json();
    console.log(`✅ ${CARDS.length} cartes chargées`);
    render();
  } catch (err) {
    console.error('❌ Erreur chargement cards.json:', err);
    document.getElementById('translationSection').innerHTML = `
      <div class="section" style="text-align:center;padding:40px;color:#e06060;">
        ⚠️ Impossible de charger <code>data/cards.json</code>.<br>
        Vérifie que le fichier existe.
      </div>
    `;
  }
}

// ============================================================================
// RENDER
// ============================================================================
function render() {
  if (!CARDS.length) return;
  const card = CARDS[currentIndex];

  // Image
  const imgEl = document.getElementById('cardImg');
  if (card.image) {
    imgEl.src = card.image;
    imgEl.style.display = 'block';
  } else {
    imgEl.removeAttribute('src');
  }

  // Infos
  document.getElementById('infoId').textContent = card.id || '—';
  document.getElementById('infoType').textContent = card.type || '—';
  document.getElementById('infoAttr').textContent = card.attribute || '—';
  document.getElementById('infoStats').textContent =
    (card.atk ?? '—') + ' / ' + (card.def ?? '—');
  document.getElementById('infoLevel').textContent = card.level ?? '—';

  // Original
  document.getElementById('origName').textContent = card.name_en || '—';
  document.getElementById('origDesc').textContent = card.desc_en || '—';

  // Traduction
  renderTranslation(card);

  // Nav
  document.getElementById('navCenter').textContent = `${currentIndex + 1} / ${CARDS.length}`;
  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').disabled = currentIndex === CARDS.length - 1;
}

function renderTranslation(card) {
  const container = document.getElementById('translationSection');
  const comments = card.comments || [];
  const vote = getVotes()[card.id] || null;
  const upClass = vote === 'up' ? 'voted-up' : '';
  const downClass = vote === 'down' ? 'voted-down' : '';
  const up = card.up || 0;
  const down = card.down || 0;

  container.innerHTML = `
    <div class="translation">
      <div class="trans-head">
        <div class="trans-meta">
          <span class="badge-source yugipedia">Yugipedia</span>
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

  // Bindings
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
  const card = CARDS[currentIndex];
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
  const card = CARDS[currentIndex];
  if (!card.comments) return;
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

  const card = CARDS[currentIndex];
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
  if (currentIndex < CARDS.length - 1) { currentIndex++; render(); }
});
document.getElementById('randomBtn').addEventListener('click', () => {
  currentIndex = Math.floor(Math.random() * CARDS.length);
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft' && currentIndex > 0) { currentIndex--; render(); }
  else if (e.key === 'ArrowRight' && currentIndex < CARDS.length - 1) { currentIndex++; render(); }
});

// ============================================================================
// SEARCH
// ============================================================================
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const found = CARDS.findIndex(c =>
    (c.name_en || '').toLowerCase().includes(q)
    || (c.name_fr || '').toLowerCase().includes(q)
    || (c.id || '').includes(q)
  );
  if (found >= 0) { currentIndex = found; render(); }
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
// INIT
// ============================================================================
loadCards();
