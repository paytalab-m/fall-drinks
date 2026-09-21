/* =========================================================
   가을 취향 테스트 · 우리만의 블렌딩  —  app.js
   Vanilla JS · 해시 라우팅 SPA · Firebase/배포 범위 밖(mock)
   =========================================================

   콘텐츠 데이터(음료 카피·토핑·매트릭스·퀴즈)는 data.js 로 분리 (먼저 로드).

   구조
   1) DIAGNOSIS   — Q2~Q5 → 6취향군 스코어링, Q6 → 최종 음료
   2) BLEND       — 베이스+토핑 → 점수/등급/메뉴명
   3) STATE/UTIL  — 세션 상태, URL 파라미터, localStorage
   4) ROUTER      — 해시 라우팅
   5) PAGES       — 라우트별 렌더 (A/B 흐름)
   6) SELFTEST    — 진단·궁합 로직 런타임 자가검증 (콘솔)
*/

'use strict';

/* =========================================================
   2) DIAGNOSIS — Q2~Q5 → 6취향군 스코어
   ========================================================= */
// 각 문항 옵션 index → 가점 받을 취향군 배열. Q2 가중 최고(방향), Q5 최저.
// (설계 근거: 기획안 Q2=큰 취향 방향, Q3 질감, Q4 단맛, Q5 온도)
const GROUP_WEIGHTS = {
  Q2: { w: 3, map: [[4], [1, 2, 3], [5, 6], [1]] },          // 커피/고소/산뜻/달콤
  Q3: { w: 2, map: [[1, 3], [2, 4], [2, 5], [1, 4, 6]] },     // 니트/도자기/패브릭/쿠션
  Q4: { w: 2, map: [[1, 4, 5, 6], [1, 3, 6], [2], [5]] },     // 확실달콤/은은구움/고소담백/새콤과일
  Q5: { w: 1, map: [[3, 4], [1, 2, 3], [2, 5, 6], [1, 4, 6]] }, // 핫팩/머플러/걷기/실내
};

// answers: {Q2,Q3,Q4,Q5} = 선택 옵션 index(0~3) → 취향군(1~6)
function diagnoseGroup(answers) {
  const score = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const key of ['Q2', 'Q3', 'Q4', 'Q5']) {
    const idx = answers[key];
    if (idx == null) continue;
    const { w, map } = GROUP_WEIGHTS[key];
    for (const g of map[idx]) score[g] += w;
  }
  // 최고점 그룹, 동점은 낮은 번호 우선(결정적)
  let best = 1;
  for (let g = 2; g <= 6; g++) if (score[g] > score[best]) best = g;
  console.log('[진단] 취향군 점수', score, '→ 그룹', best);
  return { group: best, score };
}

// Q6 선택('a'|'b') + 그룹 → 최종 음료 id
function resolveDrink(group, q6choice) {
  const drinkId = GROUP_Q6[group][q6choice].drink;
  console.log('[진단] 최종 음료', drinkId, DRINKS[drinkId].name);
  return drinkId;
}

/* =========================================================
   3) BLEND — 베이스 + 토핑 → 점수 / 등급 / 메뉴명
   ========================================================= */
// 마인스트림 토핑 → 기존 MATRIX 열(구 10토핑 순서)
const OLD_COL = { yuzu: 0, chestnut: 1, cream: 3, cinnamon: 4, honey: 6, shot: 8 };
function scoreOf(baseId, toppingId) {
  const rowKey = MATRIX_KEY[baseId];
  if (toppingId in OLD_COL) return MATRIX[rowKey][OLD_COL[toppingId]];
  // 괴식(김치·대파·고수): 낮은 점수(≤48) · 음료 group으로 결정적 변주 → 당황 다람쥐
  const base = { kimchi: 6, greenonion: 16, cilantro: 26 }[toppingId] ?? 20;
  return Math.min(48, base + (DRINKS[baseId].group * 5) % 18);
}
function blend(baseId, toppingId) {
  const score = scoreOf(baseId, toppingId);
  const grade = GRADES.find(g => score >= g.min);
  const menu = COMBO_MENUS[`${baseId}+${toppingId}`] || null; // (참고) 실메뉴 조합
  const base = DRINKS[baseId];
  const topping = TOPPINGS.find(t => t.id === toppingId);
  const blendName = menu || `${topping.name}${base.name}`; // {토핑}{음료}
  return { score, grade, menu, blendName, base, topping };
}
// 블렌드 결과 이미지 (미리 제작한 조합 이미지)
// 자산 경로 → 단독HTML이면 인라인 data URI, 멀티파일이면 원본 경로
// (JS에서 동적으로 .src 대입하는 경우 빌드 정규식이 못 잡으므로 이걸로 감싼다)
const IMG_BASE = 'https://cdn.jsdelivr.net/gh/paytalab-m/fall-drinks@main/'; // 이미지 CDN(webp). 비우면 로컬 원본(png)
function assetURL(p) {
  if (typeof A === 'function' && window.__A) return A(p);        // 단일파일 빌드(인라인 data URI)
  if (!IMG_BASE) return p;                                        // 로컬 테스트(원본 png)
  return IMG_BASE + p.replace(/^[./]+/, '').replace(/\.png(\?[^"']*)?$/i, '.webp');
}
function blendImg(baseId, toppingId) { return assetURL(`assets/blends/${baseId}_${toppingId}.png`); }
// 이미지 미리 받아 캐시에 올려둠(깜빡임·지연 로딩 방지)
function preloadImg(p) { try { new Image().src = assetURL(p); } catch {} }

/* =========================================================
   4) STATE / UTIL
   ========================================================= */
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// URL 파라미터: 해시 뒤 쿼리(#route?ownerId=..) 파싱
function parseHash() {
  const raw = location.hash.slice(1) || 'a-start';
  const [route, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { route, params };
}

// ownerId 생성: 닉네임 + 랜덤 (raw · URL 인코딩은 transport 계층에서만)
function makeOwnerId(nick) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${nick}_${rand}`;
}
// parseHash가 이미 1회 디코드하므로 여기선 split만
function ownerNickFromId(ownerId) {
  return (ownerId || '').split('_')[0] || '친구';
}
// A의 ownerId를 브라우저에 고정: 같은 닉이면 재사용(순위판 키 유지) · 닉 바뀌면 새로 발급
function getOrCreateOwnerId(nick) {
  const stored = LS.get('passorder_ownerId');
  if (stored && ownerNickFromId(stored) === nick) return stored;
  const id = makeOwnerId(nick);
  LS.set('passorder_ownerId', id);
  return id;
}

// 닉네임 입력 미완료 경고 (빨간 테두리 + 흔들림 + 안내문) · 공통
function flagInput(input, msg) {
  input.style.borderColor = 'var(--maple)';
  input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
  let err = input.parentElement.querySelector('.field-err');
  if (!err) { err = document.createElement('div'); err.className = 'field-err'; input.insertAdjacentElement('afterend', err); }
  err.textContent = msg;
  input.focus();
}
function clearInputErr(input) {
  input.style.borderColor = '';
  const err = input.parentElement.querySelector('.field-err');
  if (err) err.remove();
}

// 음료 미디어 (이미지 → 없으면 이모지 폴백)
function drinkMedia(drink) {
  return `<div class="drink-media">
    <img src="${assetURL(`assets/drinks/${drink.id}.png`)}" alt="${drink.name}"
         onerror="this.replaceWith(document.createTextNode('${drink.emoji}'))" />
  </div>`;
}

// 결과 컵: 100% 완성이면 실제 조합 이미지(assets/combos/{base}_{topping}.png),
// 이미지 없으면(3개) 베이스컵+토핑뱃지 합성으로 자동 폴백.
function resultCup(d, top, is100) {
  if (is100) {
    return `<div class="bresult-cup">
      <img class="combo-cup" src="${assetURL(`assets/combos/${d.id}_${top.id}.png`)}" alt="${d.name}+${top.name}"
           data-base="${d.id}" data-top="${top.id}" onerror="renderComboFallback(this)" />
    </div>`;
  }
  return `<div class="bresult-cup">${drinkMedia(d)}<div class="combo-badge">${toppingImg(top)}</div></div>`;
}
function renderComboFallback(img) {
  const cup = img.closest('.bresult-cup');
  const d = DRINKS[img.dataset.base];
  const t = TOPPINGS.find(x => x.id === img.dataset.top);
  if (cup && d && t) cup.innerHTML = drinkMedia(d) + `<div class="combo-badge">${toppingImg(t)}</div>`;
}

// 1:1 씬 이미지 슬롯 (assets/scenes/{key}.png → 없으면 이모지 플레이스홀더)
// 실제 일러스트를 같은 경로에 넣으면 자동 교체됨.
function sceneSlot(key, emoji, label) {
  return `<div class="scene">
    <img src="${assetURL(`assets/scenes/${key}.png`)}" alt="" onerror="this.remove()" />
    <div class="scene-ph">
      <div class="emoji">${emoji}</div>
      ${label ? `<div class="label">${label}</div>` : ''}
    </div>
  </div>`;
}

// 토핑 이미지 (assets/toppings/{id}.png → 없으면 이모지 폴백)
function toppingImg(t) {
  return `<img src="${assetURL(`assets/toppings/${t.id}.png`)}" alt="${t.name}"
    onerror="this.replaceWith(document.createTextNode('${t.emoji}'))" />`;
}

// 딥링크 (음료 검색) — 앱 브릿지 명세
function orderDeepLink(query, nick, menu) {
  const params = new URLSearchParams({
    query: query || '',
    nick: (nick || '').slice(0, 20),   // 닉네임(귀속용)
    menu: menu || query || '',          // 결과 메뉴명
    vid: getVid(),                      // 방문자 식별
    ref: 'cvol4'
  });
  return `applinkspassorder://search/home/list?${params.toString()}`; // 앱 정상작동 확인된 경로 (닉/메뉴/vid 첨부)
}

// 공유 (mock: 데스크톱 alert / 앱 브릿지는 window.shareLink · webkit 명세)
// ⚠️ 함수명은 shareLink 금지 — 전역 함수는 window.shareLink(네이티브 브릿지)와 충돌.
async function shareContent(message) {
  // 메시지 안의 실제 공유 링크 추출 (http/https/file 모두 · 없으면 현재 URL)
  const link = (message.match(/(?:https?|file):\/\/\S+/) || [location.href])[0];
  // 1) 웹 표준 공유하기 (Web Share API) — url만 공유 → OG 카드 1개(이미지+제목+설명). 별도 텍스트 버블 없음.
  //    초대 문구는 og:description(index.html)에 넣어 카드 안에 표시됨.
  if (navigator.share) {
    try { await navigator.share({ title: '가을 음료 취향 테스트', url: link }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* 사용자가 취소 */ }
  }
  // 2) 패스오더 앱 웹뷰 네이티브 브리지
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android') && window.shareLink) {
    window.shareLink.postMessage(JSON.stringify({ message, url: link })); return;
  }
  if (ua.includes('iphone') && window.webkit?.messageHandlers?.shareLink) {
    window.webkit.messageHandlers.shareLink.postMessage({ message, url: link }); return;
  }
  // 3) 폴백: 클립보드 복사 → 프롬프트
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link)
      .then(() => alert('링크가 복사됐어요! 📋\n새 탭에 붙여넣어 열어보세요.\n\n' + link))
      .catch(() => prompt('아래 링크를 복사하세요 (Ctrl/Cmd+C)', link));
  } else {
    prompt('아래 링크를 복사하세요 (Ctrl/Cmd+C)', link);
  }
}
window.shareContent = shareContent;

// 세션 상태 (A 진행 중 임시 저장)
const session = { nick: '', answers: {}, group: null, baseDrink: null, ownerId: '' };

/* =========================================================
   5) ROUTER
   ========================================================= */
const ROUTES = {
  'a-start':  renderAStart,
  'a-quiz':   renderAQuiz,
  'a-result': renderAResult,
  'a-board':  renderABoard,
  'b-start':  renderBStart,
  'b-pick':   renderBPick,
  'b-loading': renderBLoading,
  'b-result': renderBResult,
};

function navigate(route, params) {
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = route + query;
}

// 좌상단 뒤로가기 버튼 (전 화면 공통, a-start 에선 숨김)
function ensureBackBtn() {
  let b = document.getElementById('backBtn');
  if (!b) {
    b = document.createElement('button');
    b.id = 'backBtn'; b.className = 'back-btn'; b.type = 'button';
    b.setAttribute('aria-label', '뒤로가기'); b.textContent = '‹';
    b.addEventListener('click', () => history.back());
    document.body.appendChild(b);
  }
  return b;
}

// 우상단 다시하기(↻) 버튼 — 결과창에서만 표시, 누르면 처음(a-start)부터
function ensureRedoBtn() {
  let b = document.getElementById('redoBtn');
  if (!b) {
    b = document.createElement('button');
    b.id = 'redoBtn'; b.className = 'redo-btn'; b.type = 'button';
    b.setAttribute('aria-label', '다시하기'); b.textContent = '↻';
    b.addEventListener('click', () => { location.hash = 'a-start'; });
    document.body.appendChild(b);
  }
  return b;
}

const RESULT_ROUTES = ['a-result', 'b-result'];
function router() {
  const { route, params } = parseHash();
  const render = ROUTES[route] || renderNotFound;
  const app = document.getElementById('app');
  if (bRoulette) { clearInterval(bRoulette); bRoulette = null; } // 토핑 룰렛 정리
  app.innerHTML = '';
  render(app, params);
  // 진입점·전환·결과창은 뒤로가기 숨김. 결과창엔 다시하기(↻) 표시
  const noBack = route === 'a-start' || route === 'b-start' || route === 'b-loading' || RESULT_ROUTES.includes(route);
  ensureBackBtn().style.display = noBack ? 'none' : 'flex';
  ensureRedoBtn().style.display = (route === 'b-result') ? 'flex' : 'none'; // a-result는 새로고침 오해 소지로 숨김
  if (route !== 'a-quiz') logStep(route, params.ownerId); // 화면 도달(퀴즈는 문항별로 renderQuizStep에서)
  window.scrollTo(0, 0);
  console.log('[router]', route, params);
}

// 순위판 실시간 갱신: 다른 탭에서 참여(localStorage board 변경)하거나 탭 복귀 시 결과창 재렌더
function refreshIfBoardView() { if (RESULT_ROUTES.includes(parseHash().route) || parseHash().route === 'a-board') router(); }
window.addEventListener('storage', e => { if (e.key && e.key.startsWith('passorder_board')) refreshIfBoardView(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfBoardView(); });

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  session.entry = new URLSearchParams(location.search).get('utm_source') || 'direct'; // 진입 채널
  ['assets/loading/1.png','assets/loading/2.png','assets/loading/3.png'].forEach(preloadImg); // 로더 프레임 미리로드(깜빡임 방지)
  router();
  if (location.search.includes('selftest') || location.hash.includes('selftest')) selftest();
});

/* =========================================================
   6) PAGES  (Phase 1 = 스텁 · Phase 2~3에서 구현)
   ========================================================= */
function stub(app, title, note) {
  app.innerHTML = `
    <div class="page center">
      <span class="badge">가을 취향 테스트</span>
      <h1 class="headline title-font">${title}</h1>
      <div class="stub-note">${note}</div>
      <div class="spacer"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="location.hash='a-start'">🍁 A 시작으로</button>
      </div>
    </div>`;
}

// ---- 공통: 주문 딥링크 (mock) ----
function orderMock(query, nick, menu) {
  const link = orderDeepLink(query, nick, menu);
  const ua = navigator.userAgent.toLowerCase();
  if (ua.match('android') != null || ua.indexOf('iphone') > -1) {
    location.href = link; // 앱 웹뷰: 딥링크 진입
  } else {
    console.log('order deeplink mock:', link);
    alert(`'${query}' 주문 딥링크로 이동합니다 (mock)\n${link}`);
  }
}
window.orderMock = orderMock;

// ---- 주문 귀속(attribution): 누가·어느 시나리오·어떤 결과메뉴로 넘어갔나 ----
// vid = 가상 방문자 식별자. 닉네임 중복 대비, 브라우저별 1회 생성·유지.
function getVid() {
  let v = LS.get('passorder_vid');
  if (!v) {
    v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    LS.set('passorder_vid', v);
  }
  return v;
}

// 이벤트 로그 훅. GA/Apps Script 엔드포인트 확정 전엔 콘솔에만 남김.
// ⚠️ no-cors fetch 완료는 저장 성공이 아님 — 최종 주문전환은 UAR/주문로그 조인으로 확인.
const TRACK_URL = ''; // 예: Apps Script /exec. 값 넣으면 자동 전송.
function track(event, data) {
  const payload = { event, ts: Date.now(), ...data };
  console.log('[track]', payload);
  if (TRACK_URL) {
    try {
      fetch(TRACK_URL, { method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
    } catch {}
  }
}

// ---- 구글시트(Apps Script) 전송 헬퍼 (BOARD_API로 no-cors POST) ----
function sheetPost_(obj) {
  if (!BOARD_API) return;
  try {
    fetch(BOARD_API, { method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(obj) });
  } catch {}
}
// 내 결과 저장(A 완주)
function postResult(ownerId, baseDrink) {
  const d = DRINKS[baseDrink];
  sheetPost_({ type: 'result', owner_id: ownerId, nick: session.nick, vid: getVid(),
    entry: session.entry || 'direct', drink_id: baseDrink, drink_name: d ? d.name : '' });
}
// 화면 도달 로그(퍼널·이탈). role은 단계 접두사로 판별
function logStep(step, ownerId) {
  sheetPost_({ type: 'step', vid: getVid(), role: (step && step[0] === 'b') ? 'B' : 'A',
    owner_id: ownerId || '', step: step });
}
// 버튼 플래그 (tab='result'|'join')
function flagClick(tab, field, ownerId) {
  const body = { type: 'flag', tab: tab, field: field, owner_id: ownerId, value: 'Y' };
  if (tab === 'join') body.vid = getVid();
  sheetPost_(body);
}

// 주문 CTA → 패스오더 웹 검색결과(https://app.passorder.co.kr/search?q=…). q= 로 검색 실행됨(라이브 검증).
// query = 검색할 메뉴명(비100%=베이스음료 / 100%=실제 메뉴). menu = 웹 결과 메뉴명(귀속용).
function orderPass(scenario, nick, query, menu) {
  const vid = getVid();
  const params = new URLSearchParams({
    q: query || '',                    // 웹 검색 파라미터(메인에서 q= 로 검색창 채움)
    utm_source: 'fall_taste_test', utm_medium: 'referral',
    utm_campaign: 'fall_drinks_2026', utm_content: 'fall_taste_test',
    scenario: scenario, vid: vid, nick: (nick || '').slice(0, 20), menu: menu || query || ''
  });
  const url = 'https://app.passorder.co.kr/search?' + params.toString();
  track('order_click', { scenario, vid, nick, query, menu, url });
  location.href = url;
}
window.orderPass = orderPass;

// 패스오더 홈으로 이동 (비100% · 비유저 대비: 특정 메뉴가 아니라 홈에서 둘러보기)
// ⚠️ 홈 딥링크 스킴은 담당자 확인 후 확정 (mock 값)
function orderHomeMock() {
  const link = 'applinkspassorder://home';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.match('android') != null || ua.indexOf('iphone') > -1) {
    location.href = link;
  } else {
    console.log('home deeplink mock:', link);
    alert(`패스오더 홈으로 이동합니다 (mock)\n${link}`);
  }
}
window.orderHomeMock = orderHomeMock;

/* ---------------- #a-start · 시작 스킨 (일러스트 baked-in) ---------------- */
function renderAStart(app) {
  app.innerHTML = `
    <div class="page rpage">
      <div class="start-skin">
        <img class="skin-bg" src="${assetURL('assets/result-skins/start-skin-blank-v11.png')}" alt="" />
        <div class="ss-title">가을 음료<br>취향 테스트</div>
        <div class="ss-sub">이 가을, 당신의 음료 유형은?</div>
        <div class="ss-nickwrap">
          <input id="nick" class="input" type="text" maxlength="10" placeholder="닉네임을 입력해주세요" autocomplete="off" />
        </div>
        <button class="ss-cta" id="startBtn">🍁 테스트 시작하기</button>
      </div>
    </div>`;
  const input = app.querySelector('#nick');
  const go = () => {
    const nick = input.value.trim();
    if (!nick) { flagInput(input, '닉네임을 입력해주세요'); return; }
    session.nick = nick;
    session.ownerId = getOrCreateOwnerId(nick); // 퀴즈 단계부터 owner_id 붙이려고 미리 생성
    quizState = { step: 0, answers: {}, group: null, q6: null, prologueDone: false };
    navigate('a-quiz');
  };
  app.querySelector('#startBtn').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  input.addEventListener('input', () => clearInputErr(input));
}

/* ---------------- #a-quiz · 프롤로그 + Q1~Q7 ---------------- */
// 순서: 프롤로그(프롤로그 글 + 닉네임 입력) → Q1~Q5, Q6(동적), Q7  = 7스텝
let quizState = { step: 0, answers: {}, group: null, q6: null, prologueDone: false };
const QUIZ_STEPS = 7;

function renderAQuiz(app) {
  if (!quizState.prologueDone) { renderPrologue(app); return; }
  renderQuizStep(app);
}

// 프롤로그 화면 · 스토리만 (닉네임은 시작화면에서 수집)
function renderPrologue(app) {
  if (!session.nick) { navigate('a-start'); return; } // 닉네임 없이 진입 시 시작화면으로
  app.innerHTML = `
    <div class="page prologue-page rpage">
      <img class="prologue-bg" src="${assetURL('assets/scenes/prologue.png')}" alt="" onerror="this.style.display='none'" />
      <div class="prologue-content">
        <div class="prologue-story">${QUIZ.prologue}</div>
        <div class="spacer"></div>
        <div class="btn-row">
          <button id="prologueBtn" class="btn btn-cta3d" style="font-size:18px;padding:19px">마켓 둘러보러 가기 →</button>
        </div>
        <div class="pl-lift"></div>
      </div>
    </div>`;
  const go = () => { quizState.prologueDone = true; renderQuizStep(app); };
  app.querySelector('#prologueBtn').addEventListener('click', go);
}

function renderQuizStep(app) {
  const s = quizState.step;
  const pct = Math.round(((s + 1) / QUIZ_STEPS) * 100);

  // 스텝 → 문항 결정 (+ 씬 이미지 key/emoji)
  let q, opts, key, kind, sceneKey, sceneEmoji;
  if (s <= 4) {
    // Q1~Q5 (QUIZ.questions[0..4])
    const item = QUIZ.questions[s];
    key = item.key; q = item.q; opts = item.opts; kind = item.scored ? 'scored' : 'flavor';
    sceneKey = item.key.toLowerCase(); sceneEmoji = item.scene;
  } else if (s === 5) {
    // Q6 · 취향군 확정 후 2택
    const group = diagnoseGroup(quizState.answers).group;
    quizState.group = group;
    const g6 = GROUP_Q6[group];
    key = 'Q6'; q = g6.q; opts = [g6.a.label, g6.b.label]; kind = 'q6';
    sceneKey = `q6-${group}`; sceneEmoji = g6.scene;
  } else {
    // Q7 (QUIZ.questions[5])
    const item = QUIZ.questions[5];
    key = item.key; q = item.q; opts = item.opts; kind = 'flavor';
    sceneKey = item.key.toLowerCase(); sceneEmoji = item.scene;
  }

  app.innerHTML = `
    <div class="page qpage">
      <div class="progress"><span style="width:${pct}%"></span></div>
      <div class="step-count">${s + 1} <span class="muted">/ ${QUIZ_STEPS}</span></div>
      ${sceneSlot(sceneKey, sceneEmoji)}
      <div class="question">${q}</div>
      <div class="options">
        ${opts.map((o, i) => `<button class="option" data-i="${i}">${o}</button>`).join('')}
      </div>
    </div>`;

  app.querySelectorAll('.option').forEach(btn => {
    btn.addEventListener('click', () => onQuizAnswer(key, kind, Number(btn.dataset.i)));
  });
  logStep('a-quiz-' + (quizState.step + 1), session.ownerId); // 문항별 이탈 측정
}

function onQuizAnswer(key, kind, idx) {
  if (kind === 'q6') quizState.q6 = idx === 0 ? 'a' : 'b';
  else quizState.answers[key] = idx; // scored/flavor 공통 저장(flavor는 미반영)

  if (quizState.step < QUIZ_STEPS - 1) {
    quizState.step++;
    renderQuizStep(document.getElementById('app'));
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  const group = quizState.group ?? diagnoseGroup(quizState.answers).group;
  const baseDrink = resolveDrink(group, quizState.q6 || 'a');
  const ownerId = getOrCreateOwnerId(session.nick);
  session.group = group; session.baseDrink = baseDrink;
  postResult(ownerId, baseDrink); // 내 결과 저장(원격 시트)

  // 결과 화면 이미지 미리로드(로딩 1.6s 동안) → 결과 도달 시 즉시 표시
  preloadImg(`assets/drinks/${baseDrink}.png`);
  preloadImg('assets/result-skins/result-skin-blank-v13.png');
  preloadImg('assets/result-skins/result-skin-extension-blank-v16.png');

  // 로딩 화면 → 결과
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page center" style="justify-content:center">
      <div class="loader-frames">
        <img src="${assetURL('assets/loading/1.png')}" alt="" />
        <img src="${assetURL('assets/loading/2.png')}" alt="" />
        <img src="${assetURL('assets/loading/3.png')}" alt="" />
      </div>
      <h1 class="headline title-font">분석중…</h1>
      <div class="muted">${session.nick}님의 가을 한 잔을 찾고 있어요</div>
    </div>`;
  setTimeout(() => navigate('a-result', { ownerId, baseDrink }), 1600);
}

/* ---------------- #a-result · 12종 결과 ---------------- */
// 취향군별 결과카드 테마색 [accent, accent-soft]
const GROUP_THEME = {
  1: ['#E8843C', '#FBEAD7'], // 포근·달큰 (오렌지)
  2: ['#9C6B3F', '#EFE2D2'], // 진한 고소 (브라운)
  3: ['#D89A3A', '#F7EAD0'], // 은은·고소 (골드)
  4: ['#8A5A2B', '#EBE0D2'], // 커피 디저트 (딥브라운)
  5: ['#C0432E', '#F7DAD3'], // 산뜻 과일 (단풍레드)
  6: ['#E07A3E', '#FBE6D6'], // 부드러운 과일 (감빛)
};

function renderAResult(app, p) {
  const baseDrink = p.baseDrink || session.baseDrink;
  const ownerId = p.ownerId || getOrCreateOwnerId(session.nick || '나');
  const d = DRINKS[baseDrink];
  if (!d) { navigate('a-start'); return; }
  const aNick = ownerNickFromId(ownerId);

  // 일러스트 스킨(result-skin-blank) 슬롯을 PIL로 실측한 좌표(%)에 텍스트를 얹음
  const TAG_X = [22.0, 40.7, 59.3, 78.0]; // v12 pill 중심 x% (정밀 실측)
  const tags = d.tags.map((t, i) => `<span class="rs-tag" style="left:${TAG_X[i]}%">#${t}</span>`).join('');

  // 순위판: 참여자 있으면 랭킹, 없으면 "채워지는 구조" 미리보기 스켈레톤 (노멀 플로우 행)
  const board = getBoard(ownerId).slice().sort((a, b) => b.score - a.score);
  const rankRow = (medal, chip, nick, blend, score, arc, extra = '') =>
    `<div class="exr${extra}"><span class="exr-medal">${medal}</span><span class="exr-chip">${chip}</span><span class="exr-info"><b>${nick}</b> · ${blend}</span><span class="exr-score"${arc ? ` style="color:${arc}"` : ''}>${score}%</span></div>`;
  const blendBox = board.length
    ? `<div class="ex-rows">${board.slice(0, 3).map((e, i) => {
        const tp = TOPPINGS.find(t => t.id === e.topping);
        const arc = e.score >= 60 ? 'var(--orange)' : e.score >= 20 ? 'var(--gold)' : 'var(--maple)';
        return rankRow(['🥇', '🥈', '🥉'][i], tp ? toppingImg(tp) : '', e.bnick, e.blendName, e.score, arc, e.score === 100 ? ' is-100' : '');
      }).join('')}</div>${board.length > 3 ? `<div class="ex-more" onclick="location.hash='a-board?ownerId=${encodeURIComponent(ownerId)}&baseDrink=${baseDrink}'">전체 ${board.length}명 순위 보기 ›</div>` : ''}`
    : `<div class="ex-rows ex-preview" aria-hidden="true">${[['🥇', '김시럽', '크림'], ['🥈', '강토핑', '꿀'], ['🥉', '최크림', '대파']]
        .map(([m, nm, top]) => rankRow(m, '🍯', nm, `${top}${d.name}`, '?', '', ' is-skeleton')).join('')}</div><div class="ex-invite">${aNick}님의 <b>${d.name}</b>에<br/>어울리는 <b>토핑</b>을 추가해보세요👇</div>`;

  app.innerHTML = `
    <div class="page rpage">
      <!-- 상단 결과 카드 = 일러스트 스킨(v5, 풀블리드) + 텍스트 오버레이 -->
      <div class="result-skin">
        <img class="skin-bg" src="${assetURL('assets/result-skins/result-skin-blank-v13.png')}" alt="" />
        <div class="rs-badge">🍁 ${aNick}님의 가을 음료 취향은?</div>
        <span class="rs-title">${d.name}</span>
        <div class="rs-subtitle">${d.typeTitle} 음료</div>
        <div class="rs-drink"><img src="${assetURL(`assets/drinks/${d.id}.png`)}" alt="${d.name}"
             onerror="this.replaceWith(document.createTextNode('${d.emoji}'))" /></div>
        ${tags}
        <div class="rs-why">${d.why}</div>
      </div>
      <!-- 하단 확장 스킨(v5) + 오버레이: 궁합(위) → 부탁 → 대표카페 → 주문 → 다시 -->
      <div class="result-ext2">
        <img class="ext-bg" src="${assetURL('assets/result-skins/result-skin-extension-blank-v16.png')}" alt="" />
        <div class="ex-blend">
          <div class="ex-title">🏆 친구와의 토핑 궁합</div>
          ${blendBox}
        </div>
        <button class="btn btn-primary ex-share" id="shareBtn">🔗 친구에게 토핑 부탁하기</button>
        <div class="ex-cafe">
          <div class="ex-cafe-title">이 음료 파는 대표 카페</div>
          <div class="ex-cafe-list">
            ${d.cafes.map(c => { const i = c.indexOf(' · '); const b = i >= 0 ? c.slice(0, i) : c; const m = i >= 0 ? c.slice(i + 3) : ''; return `<div class="ex-cafe-row"><span class="ex-cafe-b">${b}</span><span class="ex-cafe-m">${m}</span></div>`; }).join('')}
          </div>
        </div>
        <button class="btn btn-primary ex-order" id="aOrderBtn">🛒 ${d.name} 주문하기</button>
        <button class="btn btn-ghost ex-again" id="aAgainBtn">🔄 다시 하기</button>
      </div>
    </div>`;

  app.querySelector('#shareBtn').addEventListener('click', () => {
    flagClick('result', '공유클릭', ownerId);
    const url = shareUrlForB(ownerId, baseDrink);
    shareContent(`우리 둘 취향을 섞으면 어떤 한 잔이 나올까?\n네 취향 한 스푼을 더해서 우리만의 커스텀 음료를 만들어보자!\n${url}`);
  });
  app.querySelector('#aOrderBtn').addEventListener('click', () => { flagClick('result', '주문클릭', ownerId); orderMock(d.name, aNick, d.name); });
  app.querySelector('#aAgainBtn').addEventListener('click', () => { flagClick('result', '다시하기클릭', ownerId); location.hash = 'a-start'; });

  syncBoard(ownerId, changed => { if (changed && parseHash().route === 'a-result') router(); }); // 원격(다른 기기) 참여 합산
}

// 인라인블록 텍스트가 부모 폭을 넘으면 minPx까지 폰트 축소 (nowrap 1줄 보장)
function fitOneLine(el, maxPx, minPx) {
  if (!el) return;
  const parentW = el.parentElement.clientWidth;
  let size = maxPx;
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > parentW && size > minPx) { size -= 0.5; el.style.fontSize = size + 'px'; }
}

// B 초대 링크: 절대 URL (#b-start?ownerId=..&baseDrink=..)
// 공유·초대 링크는 패스링크로 (해시·쿼리 보존 확인됨 → b-start/a-board 정상 진입)
const SHARE_BASE = 'https://passorder.kr/fall-drinks';
function shareUrlForB(ownerId, baseDrink) {
  return `${SHARE_BASE}#b-start?ownerId=${encodeURIComponent(ownerId)}&baseDrink=${baseDrink}`;
}
// 순위판(a-board) 공유 URL
function shareUrlForBoard(ownerId, baseDrink) {
  return `${SHARE_BASE}#a-board?ownerId=${encodeURIComponent(ownerId)}&baseDrink=${baseDrink}`;
}

/* ---------------- #b-start · 토핑 뽑기 (b-start + b-pick 결합 · 룰렛) ---------------- */
let bRoulette = null;
function renderBStart(app, p) {
  const { ownerId, baseDrink } = p;
  const d = DRINKS[baseDrink];
  if (!ownerId || !d) { stub(app, '잘못된 링크', '공유 링크 정보가 없어요. 친구에게 링크를 다시 받아주세요.'); return; }
  const aNick = ownerNickFromId(ownerId);

  // 재참여 방지: 이미 담았으면 결과로 바로 이동
  const prev = LS.get(participatedKey(ownerId));
  if (prev) { navigate('b-result', { ownerId, baseDrink, topping: prev.topping, bnick: prev.bnick, revisit: '1' }); return; }

  // 이 음료의 픽 가능한 토핑(블렌드 이미지 보유)
  const pool = (BLENDS[baseDrink] && BLENDS[baseDrink].length) ? BLENDS[baseDrink] : TOPPINGS.map(t => t.id);

  app.innerHTML = `
    <div class="bgame">
      <img class="bgame-bg" src="${assetURL('assets/game/stage-9x16.png')}" alt="" onerror="this.remove()" />
      <div class="bg-head">
        <div class="bg-badge">🎁 초대장이 도착했어요</div>
        <div class="bg-title">${aNick}님의 <b>${d.name}</b>에<br/>어울리는 토핑을 뽑아주세요!</div>
      </div>
      <div class="bg-stage">
        <span class="bg-topping" id="bgTopping"><img src="${assetURL(`assets/toppings/${pool[0]}.png`)}" alt="" onerror="this.style.visibility='hidden'" /></span>
        <span class="bg-drink"><img src="${assetURL(`assets/drinks/${d.id}.png`)}" alt="${d.name}" onerror="this.parentElement.textContent='🥤'" /></span>
      </div>
      <div class="bg-lower">
        <input id="bnick" class="input" type="text" maxlength="10" placeholder="내 닉네임 (예: 철수)" autocomplete="off" />
        <button id="startBtn" class="btn btn-primary bg-stop">🎡 룰렛 돌리기</button>
        <button id="stopBtn" class="btn btn-primary bg-stop" style="display:none">STOP!</button>
        <div class="bg-hint" id="bgHint">닉네임을 입력하고 룰렛을 돌려요</div>
      </div>
    </div>`;

  // 토핑 순환: 시작 전엔 천천히(미리보기) → '룰렛 돌리기' 누르면 빠르게
  let idx = Math.floor(Math.random() * pool.length);
  const el = app.querySelector('#bgTopping img');
  const spin = () => { idx = (idx + 1) % pool.length; el.src = assetURL(`assets/toppings/${pool[idx]}.png`); };
  el.src = assetURL(`assets/toppings/${pool[idx]}.png`);
  bRoulette = setInterval(spin, 420); // 미리보기(느린 회전)

  const input = app.querySelector('#bnick');
  const startBtn = app.querySelector('#startBtn');
  const stopBtn = app.querySelector('#stopBtn');
  const hint = app.querySelector('#bgHint');

  const startGame = () => {
    const bnick = input.value.trim();
    if (!bnick) { flagInput(input, '닉네임을 입력해야 시작할 수 있어요'); return; }
    input.disabled = true; input.style.display = 'none';
    startBtn.style.display = 'none';
    stopBtn.style.display = '';
    hint.textContent = '빠르게 지나가는 토핑! STOP을 눌러 멈춰요 🎯';
    if (bRoulette) clearInterval(bRoulette);       // 느린 미리보기 정지
    bRoulette = setInterval(spin, 85);             // 빠른 회전 시작

    const stop = () => {
      if (!bRoulette) return;
      clearInterval(bRoulette); bRoulette = null;
      const picked = pool[idx];
      stopBtn.disabled = true;
      // 낙하 연출: 토핑이 음료 안으로 풍덩 → 물방울 → 컵 흔들림
      app.querySelector('.bg-topping').classList.add('drop');
      app.querySelector('.bg-drink img').classList.add('shake');
      const splash = document.createElement('div');
      splash.className = 'bg-splash'; splash.textContent = '💦';
      app.querySelector('.bg-stage').appendChild(splash);
      setTimeout(() => navigate('b-loading', { ownerId, baseDrink, topping: picked, bnick }), 1150);
    };
    stopBtn.addEventListener('click', stop);
  };
  startBtn.addEventListener('click', startGame);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
  input.addEventListener('input', () => clearInputErr(input));
}
// (구) b-pick 제거 — 링크가 남아 들어와도 b-start로
function renderBPick(app, p) { navigate('b-start', p); }

/* ---------------- #b-loading · 블렌딩 중 (STOP 후 로딩) ---------------- */
function renderBLoading(app, p) {
  const { ownerId, baseDrink, topping, bnick } = p;
  if (!ownerId || !baseDrink || !topping) { navigate('b-start', p); return; }
  // b결과 이미지 미리로드(로딩 1.5s 동안) → 결과 즉시 표시
  preloadImg(`assets/blends/${baseDrink}_${topping}.png`);
  preloadImg(`assets/combos/${baseDrink}_${topping}.png`);
  preloadImg('assets/result-skins/scenario-b-result-skin-blank-v7.png');
  preloadImg('assets/result-skins/scenario-b-result-skin-10-50-blank-v7.png');
  preloadImg('assets/result-skins/scenario-b-result-extension-blank-v8.png');
  app.innerHTML = `
    <div class="page center" style="justify-content:center">
      <div class="loader-frames">
        <img src="${assetURL('assets/loading/1.png')}" alt="" />
        <img src="${assetURL('assets/loading/2.png')}" alt="" />
        <img src="${assetURL('assets/loading/3.png')}" alt="" />
      </div>
      <h1 class="headline title-font">블렌딩 중…</h1>
      <div class="muted">우리만의 음료 궁합을 확인하고 있어요</div>
    </div>`;
  const q = '?' + new URLSearchParams({ ownerId, baseDrink, topping, bnick: bnick || '나' }).toString();
  setTimeout(() => { location.replace('#b-result' + q); }, 1500);
}

/* ---------------- #b-result · 블렌딩 궁합 ---------------- */
function renderBResult(app, p) {
  const { ownerId, baseDrink, topping, bnick, revisit } = p;
  const d = DRINKS[baseDrink];
  const top = TOPPINGS.find(t => t.id === topping);
  if (!ownerId || !d || !top) { stub(app, '결과 없음', '잘못된 접근이에요.'); return; }
  const aNick = ownerNickFromId(ownerId);
  const myNick = bnick || '나';
  const r = blend(baseDrink, topping);
  // 주문 검색어/버튼 라벨: 100%=실제 메뉴명 / 그 외=베이스 음료명 (예: 대파밤라떼 → 밤라떼)
  const orderQuery = r.score === 100 ? (r.menu || r.blendName) : d.name;

  // 참여 결과 저장 — 이 링크(ownerId)에 아직 참여 안 했을 때만 1회 기록.
  // (b결과 새로고침·재진입해도 순위판에 중복으로 안 찍힘. revisit 플래그와 무관하게 기록 존재로 판정)
  if (!LS.get(participatedKey(ownerId))) {
    const entry = { bnick: myNick, topping, score: r.score, blendName: r.blendName, menu: r.menu };
    LS.set(participatedKey(ownerId), { topping, bnick: myNick, score: r.score, blendName: r.blendName });
    addToBoard(ownerId, entry);
    postParticipation(ownerId, entry); // 원격(다른 기기 합산)에도 기록
  }
  syncBoard(ownerId, changed => { if (changed && parseHash().route === 'b-result') router(); }); // 원격 참여 합산

  const low = r.score <= 50; // 0~50% → 당황 다람쥐 스킨
  const skin = low ? 'scenario-b-result-skin-10-50-blank-v7' : 'scenario-b-result-skin-blank-v7';
  const arc = r.score >= 60 ? 'var(--orange)' : r.score >= 20 ? 'var(--gold)' : 'var(--maple)';

  // 순위: A(친구) 보드에서 내 순위
  const board = getBoard(ownerId).slice().sort((a, b) => b.score - a.score);
  const myIdx = board.findIndex(e => e.bnick === myNick && e.topping === topping && e.score === r.score);
  const myRank = myIdx >= 0 ? myIdx + 1 : board.length;
  const total = board.length;
  const rankRow = (rank, chip, nick, blend, score, a2, mine) =>
    `<div class="brk-row${mine ? ' mine' : ''}"><span class="brk-medal">${rank}</span><span class="brk-chip">${chip}</span><span class="brk-info"><b>${nick}</b> · ${blend}</span><span class="brk-score" style="color:${a2}">${score}%</span></div>`;
  const medals = ['🥇', '🥈', '🥉'];
  let rankRows = board.slice(0, 3).map((e, i) => {
    const tp = TOPPINGS.find(t => t.id === e.topping);
    const a2 = e.score >= 60 ? 'var(--orange)' : e.score >= 20 ? 'var(--gold)' : 'var(--maple)';
    return rankRow(medals[i], tp ? toppingImg(tp) : '', (i === myIdx ? e.bnick + ' (나)' : e.bnick), e.blendName, e.score, a2, i === myIdx);
  }).join('');
  if (myIdx >= 3) rankRows += rankRow(myRank, toppingImg(top), myNick + ' (나)', r.blendName, r.score, arc, true);

  app.innerHTML = `
    <div class="bresult2">
      <div class="br-card">
        <img class="skin-bg" src="${assetURL(`assets/result-skins/${skin}.png`)}" alt="" />
        <div class="br-grade">${r.grade.emoji} ${r.grade.label}</div>
        <div class="br-name">${r.blendName}</div>
        <div class="br-combo">${aNick}의 ${d.name} + 내가 담은 ${top.name}</div>
        <div class="br-blend"><img src="${blendImg(baseDrink, topping)}" alt="${r.blendName}" onerror="this.style.visibility='hidden'" /></div>
        <div class="br-bar"><div class="br-bar-fill" style="width:0%;background:${arc}"></div></div>
        <div class="br-score" style="color:${arc}">궁합 <b>0%</b></div>
        <div class="br-copy">${r.grade.copy}</div>
      </div>

      <div class="br-ext">
        <img class="ext-bg" src="${assetURL('assets/result-skins/scenario-b-result-extension-blank-v8.png')}" alt="" />
        <div class="br-rank">
          <div class="br-rank-title">🏆 ${aNick}님의 가을 음료 궁합 순위</div>
          <div class="br-rank-list">${rankRows}</div>
          <div class="br-myrank">나는 전체 <b>${total}</b>명 중 <b>${myRank}위</b>!</div>
        </div>
        <div class="br-capture">📸 결과를 캡쳐해서 친구에게 공유해 보세요!</div>
        <button class="btn btn-primary br-cta1" id="bRedoBtn">🍁 나도 가을 취향 테스트하기</button>
        <div class="br-orderhint">가입없이 내 주변 카페에서 주문하기 ☕️</div>
        <button class="btn br-cta2" id="bOrderBtn">${orderQuery} 주문하기</button>
      </div>
    </div>`;

  app.querySelector('#bOrderBtn').addEventListener('click', () => { flagClick('join', '주문클릭', ownerId); orderPass('b', myNick, orderQuery, r.blendName); });
  app.querySelector('#bRedoBtn').addEventListener('click', () => { flagClick('join', '나도테스트클릭', ownerId); session.entry = 'from_friend'; location.hash = 'a-start'; });

  // 궁합 게이지 차오름 + 숫자 카운트업
  const fill = app.querySelector('.br-bar-fill');
  const scoreB = app.querySelector('.br-score b');
  setTimeout(() => {
    if (fill) fill.style.width = r.score + '%';
    if (scoreB) {
      const dur = 900, t0 = performance.now();
      const tick = (now) => {
        const q = Math.min(1, (now - t0) / dur);
        scoreB.textContent = Math.round(q * r.score) + '%';
        if (q < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, 500);
}

// 재참여 방지 localStorage 키
function participatedKey(ownerId) { return `passorder_participated_${ownerId}`; }

/* ---------------- 순위판(내 음료에 담긴 토핑) ----------------
   localStorage = 같은 기기 즉시 반영 · BOARD_API(구글 Apps Script) = 기기 간 합산.
   BOARD_API가 비어있으면 localStorage만(=같은 기기 한정, 예전 동작). */
const BOARD_API = 'https://script.google.com/macros/s/AKfycbxx-zfWyKQjAw_bSEqs3hnByygbXdHrk52w6slhRQc1kb-s1V02tCwh6OiOD9_c74xr1A/exec';
function boardKey(ownerId) { return `passorder_board_${ownerId}`; }
function addToBoard(ownerId, entry) {
  const list = LS.get(boardKey(ownerId)) || [];
  // 동일 (닉+토핑) 중복 방지
  if (list.some(e => e.bnick === entry.bnick && e.topping === entry.topping)) return;
  list.push({ ...entry, at: Date.now() });
  LS.set(boardKey(ownerId), list);
}
// 실제 참여 결과만 반환 (없으면 빈 배열 → 결과 페이지엔 유도 메시지)
function getBoard(ownerId) {
  return LS.get(boardKey(ownerId)) || [];
}

// 원격(다른 기기) 참여를 로컬에 병합 · 중복(닉+토핑) 제거. 변경되면 true
function mergeBoard(ownerId, remote) {
  const list = getBoard(ownerId);
  const seen = new Set(list.map(e => e.bnick + '|' + e.topping));
  let changed = false;
  (remote || []).forEach(e => {
    if (!e || e.bnick == null) return;
    const k = e.bnick + '|' + e.topping;
    if (!seen.has(k)) { list.push(e); seen.add(k); changed = true; }
  });
  if (changed) LS.set(boardKey(ownerId), list);
  return changed;
}
// 원격 참여 기록(POST) — no-cors + text/plain(프리플라이트 회피). 로컬에도 이미 저장돼 있음
function postParticipation(ownerId, entry) {
  const t = TOPPINGS.find(x => x.id === entry.topping);
  sheetPost_({ type: 'join', owner_id: ownerId, bnick: entry.bnick, vid: getVid(),
    topping_id: entry.topping, topping_name: t ? t.name : '',
    score: entry.score, blend_name: entry.blendName });
}
// 원격 순위판 읽기(JSONP: Apps Script는 CORS-GET 불가라 script 태그로) → 병합 후 onDone(changed)
function syncBoard(ownerId, onDone) {
  if (!BOARD_API) return;
  const cb = '__bcb' + Math.random().toString(36).slice(2, 8);
  const s = document.createElement('script');
  const cleanup = () => { try { delete window[cb]; } catch {} s.remove(); };
  window[cb] = (resp) => { let ch = false; try { ch = mergeBoard(ownerId, resp && resp.board); } finally { cleanup(); onDone && onDone(ch); } };
  s.onerror = cleanup;
  s.src = BOARD_API + '?action=board&owner_id=' + encodeURIComponent(ownerId) + '&callback=' + cb;
  document.body.appendChild(s);
}

/* ---------------- #a-board · 내 음료 순위판 ---------------- */
function renderABoard(app, p) {
  const { ownerId, baseDrink } = p;
  const d = DRINKS[baseDrink];
  if (!ownerId || !d) { stub(app, '순위판 없음', '공유 링크 정보가 없어요.'); return; }
  const aNick = ownerNickFromId(ownerId);
  const list = getBoard(ownerId).slice().sort((a, b) => b.score - a.score);

  const rows = list.map((e, i) => {
    const top = TOPPINGS.find(t => t.id === e.topping);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    const arc = e.score >= 60 ? 'var(--orange)' : e.score >= 20 ? 'var(--gold)' : 'var(--maple)';
    return `<div class="board-row${e.score === 100 ? ' is-100' : ''}">
      <div class="board-rank">${medal}</div>
      <div class="board-chip">${top ? toppingImg(top) : ''}</div>
      <div class="board-info">
        <div class="board-nick">${e.bnick}</div>
        <div class="board-blend">${e.blendName}</div>
      </div>
      <div class="board-score" style="color:${arc}">${e.score}<span>%</span></div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <div class="page board-page">
      <div class="center">
        <span class="badge">🏆 우리 음료 순위판</span>
        <h1 class="headline title-font" style="font-size:23px;margin-top:14px">${aNick}님의 ${d.name}에<br/>친구들이 담아준 토핑</h1>
        <div class="muted" style="font-size:13.5px;margin-top:2px">궁합이 높은 순서로 보여줘요</div>
      </div>
      <div class="board-list">${rows || `
        ${['🥇', '🥈', '🥉'].map(m => `<div class="board-row is-skeleton" aria-hidden="true"><div class="board-rank">${m}</div><div class="board-chip">🍯</div><div class="board-info"><div class="board-nick">친구</div><div class="board-blend">토핑 블렌딩</div></div><div class="board-score">?<span>%</span></div></div>`).join('')}
        <div class="board-empty">아직 참여한 친구가 없어요.<br/>링크를 공유하면 위처럼 순위가 채워져요!</div>`}</div>
      <div class="spacer"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="boardShareBtn">🔗 친구에게 토핑 부탁하기</button>
        <button class="btn btn-ghost" onclick="location.hash='a-start'">🍁 나도 다시 하기</button>
      </div>
    </div>`;

  app.querySelector('#boardShareBtn').addEventListener('click', () => {
    const url = shareUrlForB(ownerId, baseDrink);
    shareContent(`우리 둘 취향을 섞으면 어떤 한 잔이 나올까?\n네 취향 한 스푼을 더해줘!\n${url}`);
  });
}

// 한글 조사: 받침 유무로 이/가·을/를 등 선택 (word + [받침용, 무받침용])
function josa(word, [withF, noF]) {
  const c = word.charCodeAt(word.length - 1);
  const hasFinal = c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0;
  return word + (hasFinal ? withF : noF);
}
function renderNotFound(app) { stub(app, '404', '알 수 없는 경로입니다.'); }

/* =========================================================
   7) SELFTEST — 진단·궁합 로직 자가검증 (콘솔)
   실행: URL 에 ?selftest 또는 #a-start?selftest, 혹은 콘솔에서 selftest()
   ========================================================= */
function selftest() {
  const results = [];
  const ok = (name, cond) => { results.push({ name, pass: !!cond }); if (!cond) console.error('❌ FAIL:', name); };

  // A) 6개 취향군 모두 도달 가능 (각 그룹 대표 프로필)
  const groupProfiles = {
    1: { Q2: 3, Q3: 3, Q4: 0, Q5: 3 }, // 단호박형 → 그룹1
    2: { Q2: 1, Q3: 1, Q4: 2, Q5: 1 }, // 흑임자형 → 그룹2
    3: { Q2: 1, Q3: 0, Q4: 1, Q5: 0 }, // 대추형(핫팩) → 그룹3
    4: { Q2: 0, Q3: 1, Q4: 0, Q5: 0 }, // 토피넛형 → 그룹4
    5: { Q2: 2, Q3: 2, Q4: 3, Q5: 2 }, // 애플티형 → 그룹5
    6: { Q2: 2, Q3: 3, Q4: 1, Q5: 2 }, // 배형 → 그룹6
  };
  for (const [g, prof] of Object.entries(groupProfiles)) {
    ok(`그룹${g} 도달`, diagnoseGroup(prof).group === Number(g));
  }

  // B) 모든 답 조합(4^4=256)이 유효 그룹(1~6)으로 귀결 + 결정적
  let allValid = true;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) {
    const g = diagnoseGroup({ Q2: a, Q3: b, Q4: c, Q5: d }).group;
    if (g < 1 || g > 6) allValid = false;
  }
  ok('256개 조합 전부 유효 그룹', allValid);

  // C) 12개 음료 모두 Q6로 도달 가능
  const reachable = new Set();
  for (let g = 1; g <= 6; g++) { reachable.add(GROUP_Q6[g].a.drink); reachable.add(GROUP_Q6[g].b.drink); }
  ok('12개 음료 전부 도달', reachable.size === 12 && Object.keys(DRINKS).every(id => reachable.has(id)));

  // D) 블렌드: 픽 가능한 84조합 전부 이미지·점수 유효 (마인스트림=매트릭스, 괴식=낮음)
  let blendOk = true, grossLow = true, cnt = 0;
  for (const [baseId, tops] of Object.entries(BLENDS)) {
    for (const topId of tops) {
      cnt++;
      const r = blend(baseId, topId);
      if (!(r.score >= 0 && r.score <= 100) || !r.topping) { blendOk = false; console.error('  blend bad', baseId, topId, r.score); }
      if (GROSS.includes(topId) && r.score > 50) { grossLow = false; console.error('  gross not low', baseId, topId, r.score); }
    }
  }
  ok('블렌드 84조합 점수/토핑 유효', blendOk && cnt === 84);
  ok('괴식(김치·대파·고수) 전부 ≤50%', grossLow);

  // E) 궁합: 매트릭스 12행 x 10열 모두 0~100 정수
  let matrixOk = true;
  for (const row of Object.values(MATRIX)) {
    if (row.length !== 10) matrixOk = false;
    for (const v of row) if (!Number.isInteger(v) || v < 0 || v > 100) matrixOk = false;
  }
  ok('매트릭스 12x10 값 범위', matrixOk);

  // F) 등급 경계: 100→완벽, 99→찰떡, 60→의외, 19→사고
  ok('등급 100', blend('appletea', 'yuzu').grade.label === '완벽한 블렌딩');
  ok('등급 <20', GRADES.find(g => 15 >= g.min).label === '블렌딩 사고');

  const passed = results.filter(r => r.pass).length;
  console.log(`\n🧪 SELFTEST ${passed}/${results.length} 통과`);
  console.table(results);
  return results.every(r => r.pass);
}
window.selftest = selftest;
