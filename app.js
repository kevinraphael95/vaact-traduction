// ============================================================================
// VAACT Vérif — Logique applicative
// ----------------------------------------------------------------------------
// Outil de consultation de traductions Yu-Gi-Oh! (lecture seule).
//
// Flux global :
//   1. loadCards()       → fetch les 2 .cdb, extrait, fusionne → CARDS[]
//   2. render()          → affiche la carte courante dans le DOM
//   3. événements        → navigation, filtres, recherche, thème
//
// Dépendances : sql.js 1.10.3 (CDN), YGOPRODeck API (images).
//
// Organisation :
//   1. Config              — URLs, constantes globales
//   2. État                — CARDS, currentIndex, filtres
//   3. Codes YGOPRO        — tables de traduction type/attribut
//   4. Tags auto [XXX]     — extraction + rendu coloré
//   5. Filtres             — état + application
//   6. Toast               — messages éphémères
//   7. Images              — fetch YGOPRODeck + cache
//   8. Chargement          — SQLite, fusion, init
//   9. Extraction          — SQL → objet carte
//  10. Fusion              — merge EN/FR + détection orphelines
//  11. Rendu               — affichage de la carte courante
//  12. Navigation          — prev/next/random
//  13. Panneau filtres     — open/close + checkboxes
//  14. Filtres personnalisés — chips de mots-clés
//  15. Recherche           — jump to match
//  16. Utilitaires         — esc, resize, hauteur topbar
//  17. Thème               — clair/sombre
//  18. Init                — bootstrap
// ============================================================================

// ============================================================================
// 1. CONFIG
// ============================================================================
const CDB_EN_URL = 'data/VAACT_S1.cdb';
const CDB_FR_URL = 'data/VAACT_S1_fr.cdb';

// Timeout max pour les requêtes vers YGOPRODeck. Au-delà, on abandonne et
// on laisse le placeholder 🃏 affiché. 8s est un compromis : assez long
// pour un réseau lent, assez court pour ne pas bloquer l'UI indéfiniment.
const IMAGE_FETCH_TIMEOUT_MS = 8000;

// ============================================================================
// 2. ÉTAT GLOBAL
// ============================================================================
let CARDS = [];              // toutes les cartes fusionnées, triées par id
let currentIndex = 0;        // index dans la liste *filtrée* (pas dans CARDS)
let customKeywords = [];     // filtres personnalisés (lowercase, cumulatifs)
const CUSTOM_KEYWORDS_LS = 'vaact-custom-keywords';

// Restauration des mots-clés au démarrage. Le try/catch couvre les cas où
// localStorage est indisponible (navigation privée stricte) ou contient
// une valeur corrompue (JSON.parse peut throw).
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
  } catch (e) {
    /* stockage plein ou indisponible : on ignore, la session reste fonctionnelle */
  }
}

// ============================================================================
// 3. TRADUCTION DES CODES YGOPRO
// ============================================================================
// Les champs `type` et `attribute` sont des bitfields. On les décode en
// texte lisible pour l'affichage dans le panneau de gauche.
const ATTRIBUTES = {
  1: 'EARTH', 2: 'WATER', 4: 'FIRE', 8: 'WIND',
  16: 'LIGHT', 32: 'DARK', 64: 'DIVINE',
};

function attributeToString(attr) {
  if (!attr) return '—';
  return ATTRIBUTES[attr] || `Attr${attr}`;
}

// Ordre important : on affiche les catégories larges (Monstre/Magie/Piège)
// puis les sous-types. L'utilisateur lit « Monstre / Effet / Tuner » d'un
// coup d'œil sans devoir deviner la hiérarchie.
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

// ATK/DEF : -1 et -2 sont des sentinelles YGO pour « ? » (valeur variable).
// Les autres valeurs négatives n'existent pas en pratique, mais on les
// ramène à 0 par sécurité.
function formatStat(value) {
  if (value === null || value === undefined) return '—';
  if (value === -2 || value === -1) return '?';
  if (value < 0) return '0';
  return String(value);
}

// ============================================================================
// 4. TAGS AUTO — détection et rendu des [XXX]
// ============================================================================
// Les descriptions FR contiennent des marqueurs entre crochets ([VAACT],
// [ATK], [DEF]…). On les extrait et on les affiche en badges colorés.
//
// Un tag est : crochet ouvrant + [A-Z0-9_-]+ + crochet fermant. La regex
// est insensible à la casse en lecture, mais on normalise en MAJUSCULES
// pour que [vaact] et [VAACT] soient considérés identiques.
function extractTags(descFr) {
  if (!descFr) return [];
  const matches = descFr.match(/\[([A-Z0-9_-]+)\]/gi);
  if (!matches) return [];
  const seen = new Set();
  const tags = [];
  for (const m of matches) {
    const tag = m.slice(1, -1).toUpperCase();
    if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
  }
  return tags;
}

// Hash déterministe d'une chaîne → teinte HSL (0-359). Deux tags identiques
// auront toujours la même couleur, dans le Vérif comme dans le Traducteur.
// Pas de crypto ici : un simple modulo sur une somme pondérée suffit.
function tagHue(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
  return h;
}

// Construit le HTML des badges. Les couleurs dépendent du thème actif
// (pastel sur fond clair, saturées sur fond sombre). On les injecte en
// inline plutôt qu'en CSS car elles varient par tag ET par thème — pas
// possible de tout faire en CSS pur avec des classes statiques.
function renderTagsHtml(descFr) {
  const tags = extractTags(descFr);
  if (!tags.length) return '';
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return tags.map(tag => {
    const h = tagHue(tag);
    const bg = isDark ? `hsla(${h}, 60%, 40%, 0.18)` : `hsl(${h}, 70%, 92%)`;
    const fg = isDark ? `hsl(${h}, 70%, 70%)` : `hsl(${h}, 65%, 32%)`;
    return `<span class="tag-badge" style="background:${bg};color:${fg}">[${esc(tag)}]</span>`;
  }).join('');
}

// ============================================================================
// 5. FILTRES
// ============================================================================
// Le filtre « VAACT » ne dépend plus d'un préfixe textuel : il cherche le
// tag [VAACT] dans la description FR. Si le format change un jour (nouveau
// marqueur), un seul endroit à mettre à jour.
function isVaactCard(card) {
  return extractTags(card.desc_fr).includes('VAACT');
}

// Une carte est « incomplète » si l'un des deux côtés (EN ou FR) manque.
function isIncompleteCard(card) {
  return card.missingFr === true || card.missingEn === true;
}

// Lit l'état des filtres depuis le DOM (checkboxes) + l'état JS (keywords).
// Centralisé pour éviter les désynchros entre UI et logique.
function getFilterState() {
  return {
    vaact: !!document.getElementById('filterVaact')?.checked,
    incomplete: !!document.getElementById('filterIncomplete')?.checked,
    keywords: customKeywords,
  };
}

// Compte les filtres actifs pour le badge (chaque keyword compte comme 1).
function countActiveFilters() {
  const { vaact, incomplete, keywords } = getFilterState();
  return (vaact ? 1 : 0) + (incomplete ? 1 : 0) + keywords.length;
}

// Retourne la liste des cartes qui passent tous les filtres actifs.
// Les filtres sont cumulatifs (ET logique entre eux).
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

// Met à jour le badge du bouton Filtres. Le badge n'est visible que si au
// moins un filtre est actif.
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
// 6. TOAST — message éphémère
// ============================================================================
let toastTimer;

function showToast(message) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ============================================================================
// 7. IMAGES — YGOPRODeck + cache double (mémoire + localStorage)
// ============================================================================
// Cache clé = card.id, pas card.name_en. Raison : deux cartes peuvent
// partager le même nom (alt-arts, rééditions), et un nom vide casserait
// le cache. L'id est unique côté YGO, c'est la clé naturelle.
const imageCache = {};

async function fetchCardImage(card) {
  if (!card || !card.id) return null;
  const key = card.id;

  // 1) Cache mémoire : hit immédiat, pas de parsing localStorage.
  if (imageCache[key] !== undefined) return imageCache[key];

  // 2) Cache localStorage : persiste entre sessions.
  const lsKey = 'img_' + key;
  try {
    const cached = localStorage.getItem(lsKey);
    if (cached) {
      imageCache[key] = cached;
      return cached;
    }
  } catch (e) { /* stockage indisponible : on continue sans cache */ }

  // L'API YGOPRODeck accepte le nom EN. Le nom FR ne marche pas avec le
  // paramètre `name=` (il faut `fname=` + `language=fr`, plus lent et moins
  // fiable). On se rabat sur le nom EN quand disponible.
  const name = card.name_en || card.name_fr;
  if (!name) {
    imageCache[key] = null;
    return null;
  }

  // Timeout via AbortController : si YGOPRODeck pend, on libère l'UI.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(name)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      imageCache[key] = null;
      return null;
    }
    const data = await res.json();
    const imgUrl = data.data?.[0]?.card_images?.[0]?.image_url_cropped
                || data.data?.[0]?.card_images?.[0]?.image_url
                || null;
    imageCache[key] = imgUrl;
    if (imgUrl) {
      try { localStorage.setItem(lsKey, imgUrl); } catch (e) {}
    }
    return imgUrl;
  } catch (err) {
    clearTimeout(timer);
    imageCache[key] = null;
    return null;
  }
}

// Crée (si absent) le placeholder 🃏 dans un conteneur parent.
function ensurePlaceholder(parent) {
  let ph = parent.querySelector('.img-placeholder');
  if (!ph) {
    ph = document.createElement('div');
    ph.className = 'img-placeholder';
    ph.textContent = '🃏';
    parent.style.position = 'relative';
    parent.appendChild(ph);
  }
  return ph;
}

async function loadCardImage(card) {
  const imgEl = document.getElementById('cardImg');
  if (!imgEl) return;

  // Reset complet : on annule les handlers précédents pour éviter qu'un
  // onload d'une carte A déclenche après que la carte B soit affichée.
  imgEl.onload = null;
  imgEl.onerror = null;
  imgEl.removeAttribute('src');
  imgEl.style.display = 'none';
  imgEl.alt = card?.name_fr || card?.name_en || 'Carte';

  const parent = imgEl.parentElement;
  ensurePlaceholder(parent);

  const imgUrl = await fetchCardImage(card);

  // Vérification anti-race : si l'utilisateur a navigué pendant le fetch,
  // la carte courante a changé. On abandonne silencieusement.
  if (getFilteredCards()[currentIndex] !== card) return;
  if (!imgUrl) return;

  // On retire le placeholder seulement après confirmation du chargement.
  // Sans ce découplage, une image 404 laisserait un rectangle vide.
  imgEl.onload = () => {
    const ph = parent.querySelector('.img-placeholder');
    if (ph) ph.remove();
    imgEl.style.display = 'block';
  };
  imgEl.onerror = () => {
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
    /* le placeholder est resté en place, on le laisse */
  };
  imgEl.src = imgUrl;
}

// ============================================================================
// 8. CHARGEMENT — SQLite + fusion
// ============================================================================
// Fetch un .cdb et valide son entête SQLite. L'entête magique fait 15
// octets (« SQLite format 3 ») ; on lit 16 par sécurité. Sans cette
// vérif, un 404 renverrait du HTML et `new SQL.Database` planterait avec
// un message cryptique.
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

    // Les DBs SQLite allouent de la mémoire WASM. On les ferme dès qu'on
    // a extrait les données, sinon la RAM grimpe à chaque rechargement.
    enDb.close();
    frDb.close();

    loadingText.textContent = 'Fusion des traductions…';
    CARDS = mergeCards(enCards, frCards);

    // Logs console : utiles pour vérifier rapidement l'intégrité des .cdb.
    const missingFr = CARDS.filter(c => c.missingFr).length;
    const missingEn = CARDS.filter(c => c.missingEn).length;
    console.log(`✅ ${CARDS.length} cartes chargées`);
    console.log(`   • ${missingFr} sans traduction FR`);
    console.log(`   • ${missingEn} sans original EN`);

    // Bascule d'écran : loading → app.
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('navBar').style.display = 'block';
    document.body.classList.add('has-nav'); // active le padding-bottom

    updateTopbarHeight();
    renderCustomChips();
    updateFiltersBadge();
    render();

  } catch (err) {
    console.error('❌ Erreur:', err);
    // textContent et non innerHTML : err.message peut contenir des < > qui
    // seraient interprétés comme du HTML.
    loadingText.textContent = `❌ Erreur : ${err.message}`;
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:12px;font-size:12px;opacity:.75;';
    hint.textContent = 'Vérifie que les fichiers .cdb sont bien dans data/ et accessibles.';
    loadingText.appendChild(hint);
  }
}

// ============================================================================
// 9. EXTRACTION — SQL → objet carte
// ============================================================================
// Renvoie { [id]: { id, name, desc, type, atk, def, level, race, attribute } }.
// Le SELECT sur `datas` peut échouer si la table n'existe pas (cdb minimal) ;
// on continue alors sans les infos de stats.
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
// 10. FUSION — merge EN/FR + détection orphelines
// ============================================================================
// Trois cas :
//   • id présent dans EN et FR       → carte normale
//   • id présent dans EN seulement   → missingFr = true
//   • id présent dans FR seulement   → missingEn = true
//
// Les orphelines sont loguées en console (console.table) pour que le
// développeur puisse les inspecter sans UI dédiée.
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
        race: en.race ?? null,
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
      // Fallback sur les stats FR si l'EN n'en a pas (cas rare).
      type: en.type || fr.type || '',
      atk: en.atk ?? null,
      def: en.def ?? null,
      level: en.level ?? null,
      attribute: en.attribute || '',
      race: en.race ?? null,
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
      race: fr.race ?? null,
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

  // Tri par id numérique croissant : ordre stable et familier.
  result.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  return result;
}

// ============================================================================
// 11. RENDU — affichage de la carte courante
// ============================================================================
function render() {
  if (!CARDS.length) return;
  const filtered = getFilteredCards();

  // Cas « aucun résultat » : on vide tout, désactive la nav, place un
  // message explicite. Le placeholder image revient.
  if (!filtered.length) {
    document.getElementById('infoId').textContent = '—';
    document.getElementById('infoType').textContent = '—';
    document.getElementById('infoAttr').textContent = '—';
    document.getElementById('infoStats').textContent = '—';
    document.getElementById('infoLevel').textContent = '—';
    document.getElementById('origName').textContent = '—';
    document.getElementById('origDesc').textContent = 'Aucune carte ne correspond aux filtres actifs.';
    document.getElementById('translationSection').innerHTML = '';

    const imgEl = document.getElementById('cardImg');
    if (imgEl) {
      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
      ensurePlaceholder(imgEl.parentElement);
    }

    document.getElementById('navCenter').textContent = '0 / 0';
    document.getElementById('prevBtn').disabled = true;
    document.getElementById('nextBtn').disabled = true;
    return;
  }

  // currentIndex peut être hors borne après un changement de filtre.
  if (currentIndex >= filtered.length) currentIndex = 0;
  const card = filtered[currentIndex];

  loadCardImage(card);

  // Panneau gauche : stats techniques.
  document.getElementById('infoId').textContent = card.id || '—';
  document.getElementById('infoType').textContent = typeToString(card.type);
  document.getElementById('infoAttr').textContent = attributeToString(card.attribute);
  document.getElementById('infoStats').textContent =
    formatStat(card.atk) + ' / ' + formatStat(card.def);
  document.getElementById('infoLevel').textContent = card.level ?? '—';

  // Texte original (EN).
  document.getElementById('origName').textContent = card.name_en || '—';
  document.getElementById('origDesc').textContent = card.desc_en || '—';

  // Traduction (FR) + tags.
  renderTranslation(card);

  // Barre de navigation + compteur.
  document.getElementById('navCenter').textContent = `${currentIndex + 1} / ${filtered.length}`;
  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').disabled = currentIndex === filtered.length - 1;
}

// Construit le HTML de la section « Traduction » : badges, nom, description.
// Utilise innerHTML car tout le contenu utilisateur passe par esc() avant
// injection. Les badges manquants sont contextuels (FR ou EN selon le cas).
function renderTranslation(card) {
  const container = document.getElementById('translationSection');

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

  // Tous les tags (dont [VAACT]) passent par le même système coloré.
  const tagsHtml = renderTagsHtml(card.desc_fr);

  container.innerHTML = `
    <div class="translation${card.missingFr || card.missingEn ? ' incomplete' : ''}">
      <div class="trans-head">
        <div class="trans-meta">
          <span class="badge-source manual">Traduction</span>
          ${tagsHtml}
          ${missingBadge}
        </div>
      </div>
      <div class="trans-name">${frName}</div>
      <div class="trans-desc">${frDesc}</div>
    </div>
  `;
}

// ============================================================================
// 12. NAVIGATION
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

// Raccourcis clavier globaux. On ignore les flèches si l'utilisateur est
// en train de taper dans un input (recherche, mot-clé).
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') goPrev();
  else if (e.key === 'ArrowRight') goNext();
});

// ============================================================================
// 13. PANNEAU FILTRES
// ============================================================================
const filtersBtn = document.getElementById('filtersBtn');
const filtersPanel = document.getElementById('filtersPanel');

function openFiltersPanel() {
  if (!filtersPanel) return;
  filtersPanel.classList.add('open');
  filtersBtn?.setAttribute('aria-expanded', 'true');
}

// `restoreFocus` : true quand on ferme via Échap (l'utilisateur veut
// revenir au bouton). false sur clic extérieur (il va ailleurs).
function closeFiltersPanel(restoreFocus = false) {
  if (!filtersPanel) return;
  const wasOpen = filtersPanel.classList.contains('open');
  filtersPanel.classList.remove('open');
  filtersBtn?.setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus) filtersBtn?.focus();
}

if (filtersBtn && filtersPanel) {
  filtersBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // évite que le clic ferme immédiatement via le listener document
    if (filtersPanel.classList.contains('open')) {
      closeFiltersPanel();
    } else {
      openFiltersPanel();
    }
  });

  // Fermeture au clic extérieur
  document.addEventListener('click', (e) => {
    if (!filtersPanel.contains(e.target) && !filtersBtn.contains(e.target)) {
      closeFiltersPanel();
    }
  });

  // Fermeture à Échap + retour du focus
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filtersPanel.classList.contains('open')) {
      closeFiltersPanel(true);
    }
  });
}

// ============================================================================
// 14. FILTRES — checkboxes + mots-clés personnalisés
// ============================================================================
['filterVaact', 'filterIncomplete'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    currentIndex = 0; // reset : la liste filtrée change, l'index n'est plus valide
    render();
    updateFiltersBadge();
  });
});

const customInput = document.getElementById('customKeywordInput');
const customAddBtn = document.getElementById('customAddBtn');
const customChips = document.getElementById('customChips');
const customResetBtn = document.getElementById('filterResetBtn');

function addCustomKeyword(rawValue) {
  const value = (rawValue || '').trim().toLowerCase();
  if (!value) return;
  if (customKeywords.includes(value)) return; // pas de doublon

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

// Affiche les chips actifs dans le panneau. Chaque chip a son ✕ individuel
// pour retirer le mot-clé correspondant. Le `data-keyword` permet de
// retrouver la valeur au clic (les event listeners sont re-créés à chaque
// renderCustomChips, donc les anciens listeners sont collectés par le GC).
function renderCustomChips() {
  if (!customChips) return;

  if (!customKeywords.length) {
    customChips.innerHTML = '';
    return;
  }

  customChips.innerHTML = customKeywords.map(kw => `
    <span class="custom-chip">
      <span class="chip-label">${esc(kw)}</span>
      <button type="button" class="chip-remove" data-keyword="${esc(kw)}" title="Retirer" aria-label="Retirer le filtre : ${esc(kw)}">✕</button>
    </span>
  `).join('');

  customChips.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // n'ouvre/ferme pas le panneau
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

// Bouton « Tout effacer » : reset des checkboxes ET des keywords.
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
// 15. RECHERCHE
// ============================================================================
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');

// Affiche/masque la croix ✕ selon si le champ contient quelque chose.
// La classe .has-search est posée sur le wrapper pour piloter le CSS.
function updateSearchIndicator() {
  if (!searchInput) return;
  const wrap = searchInput.closest('.search-wrap') || searchInput.parentElement;
  if (wrap) wrap.classList.toggle('has-search', searchInput.value.trim().length > 0);
}

// Trouve la première carte correspondante dans la liste *filtrée* (pas
// dans CARDS) et s'y déplace. Si rien trouvé → toast d'erreur.
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
  } else {
    showToast(`Aucune carte ne correspond à « ${q} »`);
  }
}

if (searchInput) {
  searchInput.addEventListener('input', updateSearchIndicator);

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
// 16. UTILITAIRES
// ============================================================================

// Échappe le HTML dans une chaîne destinée à être injectée via innerHTML.
// Utilisé partout où on insère du contenu utilisateur (noms de cartes,
// descriptions, mots-clés).
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// La topbar peut changer de hauteur (wrap en mobile, changement de contenu).
// On expose sa hauteur réelle en CSS via --topbar-height pour que le
// panneau filtres mobile s'ancre correctement, sans valeur en dur.
function updateTopbarHeight() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  document.documentElement.style.setProperty('--topbar-height', topbar.offsetHeight + 'px');
}
window.addEventListener('resize', updateTopbarHeight);

// ============================================================================
// 17. THÈME
// ============================================================================
const THEME_KEY = 'vaact-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? 'Basculer en thème clair' : 'Basculer en thème sombre');
  }
}

// Init : localStorage → préférence système → clair par défaut.
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

  // Les couleurs des tags dépendent du thème. On re-render la carte courante
  // pour que les teintes s'adaptent immédiatement (pastel ↔ saturé).
  const filtered = getFilteredCards();
  const card = filtered[currentIndex];
  if (card) renderTranslation(card);
}

const themeBtn = document.getElementById('themeToggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

// ============================================================================
// 18. INIT
// ============================================================================
loadCards();
