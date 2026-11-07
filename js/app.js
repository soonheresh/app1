/* 환자 설문 관리 PWA — 프레임워크 없는 단일 페이지 앱 */
(() => {
  'use strict';

  // ---------- 유틸 ----------
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $brand = document.getElementById('brand');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmt = (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  };
  async function sha256(text) {
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return 'plain:' + text; // 비보안(http) 환경 대비
  }

  const TYPES = {
    text: '단답형', textarea: '서술형', number: '숫자', date: '날짜',
    radio: '단일 선택', checkbox: '복수 선택', yesno: '예/아니오', scale: '0–10 척도',
  };
  const STATUS = { new: '신규', reviewed: '확인함', done: '처리완료' };

  // ---------- 설정 ----------
  const Settings = {
    get() {
      try { return JSON.parse(localStorage.getItem('ps-settings')) || {}; } catch { return {}; }
    },
    set(patch) {
      const s = { ...this.get(), ...patch };
      localStorage.setItem('ps-settings', JSON.stringify(s));
      return s;
    },
  };

  const Auth = {
    isIn: () => sessionStorage.getItem('ps-admin') === '1',
    async login(pin) {
      const s = Settings.get();
      const hash = s.pinHash || (await sha256('0000'));
      if ((await sha256(pin)) === hash) { sessionStorage.setItem('ps-admin', '1'); return true; }
      return false;
    },
    logout() { sessionStorage.removeItem('ps-admin'); },
  };
  // 관리자 화면 10분 무조작 시 자동 잠금
  let idleTimer;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    if (Auth.isIn()) idleTimer = setTimeout(() => { Auth.logout(); toast('자동 잠금되었습니다'); go('#/'); }, 10 * 60 * 1000);
  };
  ['click', 'keydown', 'touchstart'].forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));

  // ---------- 초기 데이터 ----------
  async function seed() {
    const s = Settings.get();
    if (s.seeded) return;
    const now = Date.now();
    await DB.bulkPut('surveys', DEFAULT_SURVEYS.map((x, i) => ({ ...x, createdAt: now + i, updatedAt: now + i })));
    Settings.set({ seeded: true, clinicName: s.clinicName || '' });
  }

  // ---------- 라우터 ----------
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const routes = [
    [/^#?\/?$/, home],
    [/^#\/fill\/([^/]+)$/, fill],
    [/^#\/thanks$/, thanks],
    [/^#\/admin$/, adminLogin],
    [/^#\/admin\/responses$/, guard(responses)],
    [/^#\/admin\/response\/([^/]+)$/, guard(responseDetail)],
    [/^#\/admin\/surveys$/, guard(surveys)],
    [/^#\/admin\/survey\/([^/]+)$/, guard(surveyEditor)],
    [/^#\/admin\/settings$/, guard(settings)],
  ];
  function guard(fn) {
    return (...a) => (Auth.isIn() ? fn(...a) : go('#/admin'));
  }
  async function route() {
    document.getElementById('toast').classList.remove('show');
    const h = location.hash || '#/';
    const s = Settings.get();
    $brand.textContent = s.clinicName ? `${s.clinicName} 설문` : '환자 설문';
    renderNav(h);
    for (const [re, fn] of routes) {
      const m = h.match(re);
      if (m) {
        try { await fn(...m.slice(1).map(decodeURIComponent)); } catch (e) { console.error(e); $app.innerHTML = `<p class="empty">오류가 발생했습니다: ${esc(e.message)}</p>`; }
        $app.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        return;
      }
    }
    go('#/');
  }
  window.addEventListener('hashchange', route);

  function renderNav(h) {
    if (!Auth.isIn() || !h.startsWith('#/admin')) {
      $nav.innerHTML = h.startsWith('#/fill') || h === '#/thanks' ? '' : '<a href="#/admin" class="navlink">관리자</a>';
      return;
    }
    const link = (href, label) => `<a href="${href}" class="navlink ${h.startsWith(href) ? 'on' : ''}">${label}</a>`;
    $nav.innerHTML = link('#/admin/responses', '응답') + link('#/admin/survey', '설문지') + link('#/admin/settings', '설정') +
      '<button class="navlink" data-act="logout">잠금</button>';
    $nav.querySelector('[data-act=logout]').onclick = () => { Auth.logout(); go('#/'); };
  }

  // ---------- 환자: 설문 선택 ----------
  async function home() {
    const list = (await DB.all('surveys')).filter((s) => s.active).sort((a, b) => a.createdAt - b.createdAt);
    const s = Settings.get();
    $app.innerHTML = `
      <section class="hero">
        <h1>${s.clinicName ? esc(s.clinicName) + '<br>' : ''}설문지 작성</h1>
        <p>작성하실 설문지를 선택해 주세요.</p>
      </section>
      <div class="cards">
        ${list.length ? list.map((x) => `
          <a class="card big" href="#/fill/${esc(x.id)}">
            <strong>${esc(x.title)}</strong>
            <span>${esc(x.description || '')}</span>
            <em>${x.questions.length}개 문항</em>
          </a>`).join('') : '<p class="empty">사용 가능한 설문지가 없습니다. 관리자 메뉴에서 설문지를 활성화해 주세요.</p>'}
      </div>`;
  }

  // ---------- 환자: 설문 작성 ----------
  function fieldHTML(q) {
    const name = `q_${q.id}`;
    const req = q.required ? 'required' : '';
    switch (q.type) {
      case 'textarea': return `<textarea name="${name}" rows="3" ${req}></textarea>`;
      case 'number': return `<input type="number" inputmode="decimal" name="${name}" ${req}>`;
      case 'date': return `<input type="date" name="${name}" ${req}>`;
      case 'radio':
      case 'yesno': {
        const opts = q.type === 'yesno' ? ['예', '아니오'] : q.options || [];
        return `<div class="choices">${opts.map((o) => `<label class="choice"><input type="radio" name="${name}" value="${esc(o)}" ${req}><span>${esc(o)}</span></label>`).join('')}</div>`;
      }
      case 'checkbox':
        return `<div class="choices" data-group="${name}" ${q.required ? 'data-required' : ''}>${(q.options || []).map((o) => `<label class="choice"><input type="checkbox" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</div>`;
      case 'scale':
        return `<div class="scale">${Array.from({ length: 11 }, (_, i) => `<label class="choice num"><input type="radio" name="${name}" value="${i}" ${req}><span>${i}</span></label>`).join('')}</div>`;
      default: return `<input type="text" name="${name}" ${req}>`;
    }
  }

  async function fill(id) {
    const sv = await DB.get('surveys', id);
    if (!sv || !sv.active) { $app.innerHTML = '<p class="empty">설문지를 찾을 수 없습니다.</p><p class="center"><a class="btn" href="#/">처음으로</a></p>'; return; }
    $app.innerHTML = `
      <form class="survey" id="sf" novalidate>
        <header class="survey-head">
          <h1>${esc(sv.title)}</h1>
          ${sv.description ? `<p>${esc(sv.description)}</p>` : ''}
          <p class="hint"><b class="req">*</b> 표시는 필수 문항입니다.</p>
        </header>
        <fieldset class="block">
          <legend>기본 정보</legend>
          <div class="grid2">
            <label class="q">이름 <b class="req">*</b><input name="p_name" required autocomplete="off"></label>
            <label class="q">생년월일 <b class="req">*</b><input type="date" name="p_birth" required></label>
            <div class="q">성별 <b class="req">*</b>
              <div class="choices">${['남', '여'].map((g) => `<label class="choice"><input type="radio" name="p_gender" value="${g}" required><span>${g}</span></label>`).join('')}</div>
            </div>
            <label class="q">연락처<input type="tel" name="p_phone" inputmode="tel" placeholder="010-0000-0000" autocomplete="off"></label>
          </div>
        </fieldset>
        <fieldset class="block">
          <legend>설문 문항</legend>
          ${sv.questions.map((q, i) => `
            <div class="q" data-q="${esc(q.id)}">
              <div class="qlabel"><span class="qn">${i + 1}.</span> ${esc(q.label)} ${q.required ? '<b class="req">*</b>' : ''}</div>
              ${q.help ? `<div class="help">${esc(q.help)}</div>` : ''}
              ${fieldHTML(q)}
            </div>`).join('')}
        </fieldset>
        <fieldset class="block consent">
          <label class="choice wide"><input type="checkbox" name="consent" required>
            <span>진료 목적의 개인정보(건강정보 포함) 수집·이용에 동의합니다. <b class="req">*</b></span></label>
        </fieldset>
        <div class="actions">
          <a class="btn ghost" href="#/">취소</a>
          <button class="btn primary" type="submit">제출하기</button>
        </div>
      </form>`;

    const form = document.getElementById('sf');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
      let firstBad = null;
      const mark = (el) => { const box = el.closest('.q, .block') || el; box.classList.add('invalid'); firstBad = firstBad || box; };
      form.querySelectorAll('[required]').forEach((el) => {
        if (el.type === 'radio') { if (!form.querySelector(`[name="${el.name}"]:checked`)) mark(el); }
        else if (el.type === 'checkbox') { if (!el.checked) mark(el); }
        else if (!el.value.trim()) mark(el);
      });
      form.querySelectorAll('[data-group][data-required]').forEach((g) => { if (!g.querySelector(':checked')) mark(g); });
      if (firstBad) { firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('필수 문항을 확인해 주세요'); return; }

      const fd = new FormData(form);
      const answers = {};
      sv.questions.forEach((q) => {
        const vals = fd.getAll(`q_${q.id}`).map(String);
        answers[q.id] = q.type === 'checkbox' ? vals : (vals[0] ?? '').trim();
      });
      const resp = {
        id: uid(),
        surveyId: sv.id,
        surveyTitle: sv.title,
        questions: sv.questions.map(({ id, label, type }) => ({ id, label, type })), // 작성 시점 문항 스냅샷
        patient: {
          name: fd.get('p_name').trim(), birth: fd.get('p_birth'), gender: fd.get('p_gender') || '', phone: (fd.get('p_phone') || '').trim(),
        },
        answers,
        status: 'new',
        memo: '',
        createdAt: Date.now(),
      };
      await DB.put('responses', resp);
      go('#/thanks');
    });
  }

  function thanks() {
    $app.innerHTML = `
      <section class="hero done">
        <div class="check">✓</div>
        <h1>제출이 완료되었습니다</h1>
        <p>작성해 주셔서 감사합니다. 잠시 기다려 주세요.</p>
        <p class="hint" id="cd">10초 후 첫 화면으로 돌아갑니다.</p>
        <a class="btn primary" href="#/">처음으로</a>
      </section>`;
    let n = 10;
    const t = setInterval(() => {
      n -= 1;
      const cd = document.getElementById('cd');
      if (!cd || location.hash !== '#/thanks') return clearInterval(t);
      cd.textContent = `${n}초 후 첫 화면으로 돌아갑니다.`;
      if (n <= 0) { clearInterval(t); go('#/'); }
    }, 1000);
  }

  // ---------- 관리자: 로그인 ----------
  function adminLogin() {
    if (Auth.isIn()) return go('#/admin/responses');
    const first = !Settings.get().pinHash;
    $app.innerHTML = `
      <form class="login" id="lf">
        <h1>관리자 로그인</h1>
        <input type="password" name="pin" inputmode="numeric" autocomplete="current-password" placeholder="PIN" required autofocus>
        <button class="btn primary" type="submit">확인</button>
        ${first ? '<p class="hint">초기 PIN은 <b>0000</b> 입니다. 로그인 후 설정에서 꼭 변경하세요.</p>' : ''}
      </form>`;
    document.getElementById('lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = e.target.pin.value;
      if (await Auth.login(pin)) { resetIdle(); go('#/admin/responses'); }
      else { toast('PIN이 올바르지 않습니다'); e.target.pin.value = ''; }
    });
  }

  // ---------- 관리자: 응답 목록 ----------
  const listState = { q: '', survey: '', status: '' };
  async function responses() {
    const [all, svs] = await Promise.all([DB.all('responses'), DB.all('surveys')]);
    all.sort((a, b) => b.createdAt - a.createdAt);
    const counts = { new: all.filter((r) => r.status === 'new').length };
    $app.innerHTML = `
      <div class="pagehead">
        <h1>응답 목록 <small>${all.length}건 · 신규 ${counts.new}건</small></h1>
        <div class="row">
          <button class="btn" data-act="csv">CSV 내보내기</button>
        </div>
      </div>
      <div class="filters">
        <input type="search" id="fq" placeholder="이름·연락처 검색" value="${esc(listState.q)}">
        <select id="fs"><option value="">모든 설문지</option>${svs.map((s) => `<option value="${esc(s.id)}" ${listState.survey === s.id ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select>
        <select id="fst"><option value="">모든 상태</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${listState.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div id="rlist"></div>`;

    const filtered = () => all.filter((r) => {
      const q = listState.q.trim().toLowerCase();
      if (q && !(`${r.patient.name} ${r.patient.phone}`.toLowerCase().includes(q))) return false;
      if (listState.survey && r.surveyId !== listState.survey) return false;
      if (listState.status && r.status !== listState.status) return false;
      return true;
    });
    const draw = () => {
      const rows = filtered();
      document.getElementById('rlist').innerHTML = rows.length ? `
        <ul class="rlist">${rows.map((r) => `
          <li><a href="#/admin/response/${esc(r.id)}">
            <span class="badge s-${r.status}">${STATUS[r.status]}</span>
            <strong>${esc(r.patient.name)}</strong>
            <span class="muted">${esc(r.patient.gender)} ${r.patient.birth ? '· ' + esc(r.patient.birth) : ''}</span>
            <span class="muted grow">${esc(r.surveyTitle)}</span>
            <time>${fmt(r.createdAt)}</time>
          </a></li>`).join('')}</ul>` : '<p class="empty">표시할 응답이 없습니다.</p>';
    };
    draw();
    document.getElementById('fq').addEventListener('input', (e) => { listState.q = e.target.value; draw(); });
    document.getElementById('fs').addEventListener('change', (e) => { listState.survey = e.target.value; draw(); });
    document.getElementById('fst').addEventListener('change', (e) => { listState.status = e.target.value; draw(); });
    $app.querySelector('[data-act=csv]').onclick = () => exportCSV(filtered());
  }

  const answerText = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '');

  function exportCSV(rows) {
    if (!rows.length) return toast('내보낼 응답이 없습니다');
    // 문항 열: 문항 라벨 기준으로 합침 (여러 설문지가 섞여도 한 표로)
    const cols = [];
    const seen = new Set();
    rows.forEach((r) => r.questions.forEach((q) => { const k = `${r.surveyTitle}::${q.label}`; if (!seen.has(k)) { seen.add(k); cols.push({ k, label: rows.some((x) => x.surveyTitle !== r.surveyTitle) ? `[${r.surveyTitle}] ${q.label}` : q.label }); } }));
    const head = ['접수일시', '설문지', '상태', '이름', '생년월일', '성별', '연락처', '메모', ...cols.map((c) => c.label)];
    const lines = rows.map((r) => {
      const byKey = {};
      r.questions.forEach((q) => { byKey[`${r.surveyTitle}::${q.label}`] = answerText(r.answers[q.id]); });
      return [fmt(r.createdAt), r.surveyTitle, STATUS[r.status], r.patient.name, r.patient.birth, r.patient.gender, r.patient.phone, r.memo, ...cols.map((c) => byKey[c.k] ?? '')];
    });
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [head, ...lines].map((l) => l.map(cell).join(',')).join('\r\n');
    download(csv, `설문응답_${fmt(Date.now()).replace(/[: ]/g, '-')}.csv`, 'text/csv;charset=utf-8');
  }

  function download(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- 관리자: 응답 상세 ----------
  async function responseDetail(id) {
    const r = await DB.get('responses', id);
    if (!r) { $app.innerHTML = '<p class="empty">응답을 찾을 수 없습니다.</p>'; return; }
    const age = r.patient.birth ? Math.floor((r.createdAt - new Date(r.patient.birth)) / (365.2425 * 864e5)) : null;
    $app.innerHTML = `
      <div class="pagehead noprint">
        <a href="#/admin/responses" class="btn ghost">← 목록</a>
        <div class="row">
          <button class="btn" data-act="print">인쇄</button>
          <button class="btn danger" data-act="del">삭제</button>
        </div>
      </div>
      <article class="detail">
        <header>
          <h1>${esc(r.patient.name)} <small>${esc(r.patient.gender)}${age != null && !isNaN(age) ? ` · 만 ${age}세` : ''}</small></h1>
          <dl class="meta">
            <div><dt>설문지</dt><dd>${esc(r.surveyTitle)}</dd></div>
            <div><dt>접수</dt><dd>${fmt(r.createdAt)}</dd></div>
            <div><dt>생년월일</dt><dd>${esc(r.patient.birth) || '-'}</dd></div>
            <div><dt>연락처</dt><dd>${r.patient.phone ? `<a href="tel:${esc(r.patient.phone)}">${esc(r.patient.phone)}</a>` : '-'}</dd></div>
          </dl>
        </header>
        <ol class="answers">
          ${r.questions.map((q) => {
            const v = r.answers[q.id];
            const t = answerText(v);
            const shown = q.type === 'scale' && t !== '' ? `<span class="scalebar"><i style="width:${Number(t) * 10}%"></i></span> <b>${esc(t)}</b> / 10` : (t ? esc(t).replace(/\n/g, '<br>') : '<span class="muted">(응답 없음)</span>');
            return `<li><div class="qlabel">${esc(q.label)}</div><div class="ans">${shown}</div></li>`;
          }).join('')}
        </ol>
        <section class="block manage">
          <h2>관리</h2>
          <div class="choices" id="st">${Object.entries(STATUS).map(([k, v]) => `<label class="choice"><input type="radio" name="status" value="${k}" ${r.status === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
          <label class="q">메모<textarea id="memo" rows="3" placeholder="진료 메모 (환자에게 보이지 않음)">${esc(r.memo)}</textarea></label>
          <button class="btn primary noprint" data-act="save">저장</button>
        </section>
      </article>`;

    // 열람 시 신규 → 확인함 자동 변경
    if (r.status === 'new') { r.status = 'reviewed'; await DB.put('responses', r); $app.querySelector('input[value=reviewed]').checked = true; }

    $app.querySelector('[data-act=print]').onclick = () => window.print();
    $app.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`${r.patient.name}님의 응답을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      await DB.del('responses', r.id); toast('삭제했습니다'); go('#/admin/responses');
    };
    $app.querySelector('[data-act=save]').onclick = async () => {
      r.status = $app.querySelector('input[name=status]:checked').value;
      r.memo = document.getElementById('memo').value;
      await DB.put('responses', r); toast('저장했습니다');
    };
  }

  // ---------- 관리자: 설문지 목록 ----------
  async function surveys() {
    const [list, resps] = await Promise.all([DB.all('surveys'), DB.all('responses')]);
    list.sort((a, b) => a.createdAt - b.createdAt);
    $app.innerHTML = `
      <div class="pagehead">
        <h1>설문지 관리</h1>
        <a class="btn primary" href="#/admin/survey/new">+ 새 설문지</a>
      </div>
      <ul class="rlist">${list.map((s) => `
        <li><a href="#/admin/survey/${esc(s.id)}">
          <span class="badge ${s.active ? 's-done' : 's-off'}">${s.active ? '사용중' : '중지'}</span>
          <strong>${esc(s.title)}</strong>
          <span class="muted grow">${s.questions.length}문항 · 응답 ${resps.filter((r) => r.surveyId === s.id).length}건</span>
          <time>${fmt(s.updatedAt)}</time>
        </a></li>`).join('')}</ul>
      ${list.length ? '' : '<p class="empty">설문지가 없습니다.</p>'}`;
  }

  async function surveyEditor(id) {
    let sv = id === 'new'
      ? { id: uid(), title: '', description: '', active: true, questions: [], createdAt: Date.now() }
      : await DB.get('surveys', id);
    if (!sv) { $app.innerHTML = '<p class="empty">설문지를 찾을 수 없습니다.</p>'; return; }
    sv = structuredClone(sv);
    const isNew = id === 'new';

    const qEditor = (q, i) => `
      <div class="qedit" data-i="${i}">
        <div class="qedit-head">
          <span class="qn">${i + 1}</span>
          <select data-f="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <label class="inline"><input type="checkbox" data-f="required" ${q.required ? 'checked' : ''}> 필수</label>
          <span class="grow"></span>
          <button type="button" class="icon" data-m="up" title="위로" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon" data-m="down" title="아래로" ${i === sv.questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon" data-m="dup" title="복제">⧉</button>
          <button type="button" class="icon danger" data-m="del" title="삭제">✕</button>
        </div>
        <input data-f="label" placeholder="질문 내용" value="${esc(q.label)}">
        <input data-f="help" placeholder="도움말 (선택)" value="${esc(q.help || '')}">
        ${['radio', 'checkbox'].includes(q.type) ? `<textarea data-f="options" rows="3" placeholder="선택지를 한 줄에 하나씩">${esc((q.options || []).join('\n'))}</textarea>` : ''}
      </div>`;

    const root = document.createElement('div');
    $app.replaceChildren(root);
    const draw = () => {
      root.innerHTML = `
        <div class="pagehead">
          <a href="#/admin/survey" class="btn ghost">← 목록</a>
          <div class="row">
            ${isNew ? '' : '<button class="btn" data-act="preview">미리보기</button><button class="btn danger" data-act="del">삭제</button>'}
            <button class="btn primary" data-act="save">저장</button>
          </div>
        </div>
        <section class="block">
          <label class="q">설문지 제목<input id="st" value="${esc(sv.title)}" placeholder="예: 초진 문진표"></label>
          <label class="q">안내 문구<textarea id="sd" rows="2">${esc(sv.description)}</textarea></label>
          <label class="choice wide"><input type="checkbox" id="sa" ${sv.active ? 'checked' : ''}><span>환자 화면에 표시 (사용중)</span></label>
          <p class="hint">이름·생년월일·성별·연락처와 개인정보 동의 항목은 모든 설문지에 자동으로 포함됩니다.</p>
        </section>
        <div id="qs">${sv.questions.map(qEditor).join('')}</div>
        <div class="actions"><button class="btn" data-act="add">+ 문항 추가</button></div>`;
    };

    // 입력값을 모델에 반영
    const sync = () => {
      sv.title = document.getElementById('st').value.trim();
      sv.description = document.getElementById('sd').value.trim();
      sv.active = document.getElementById('sa').checked;
      root.querySelectorAll('.qedit').forEach((el) => {
        const q = sv.questions[+el.dataset.i];
        q.type = el.querySelector('[data-f=type]').value;
        q.required = el.querySelector('[data-f=required]').checked;
        q.label = el.querySelector('[data-f=label]').value.trim();
        q.help = el.querySelector('[data-f=help]').value.trim();
        const o = el.querySelector('[data-f=options]');
        if (o) q.options = o.value.split('\n').map((s) => s.trim()).filter(Boolean);
      });
    };

    draw();
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-f=type]')) { sync(); draw(); }
    });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      const m = b.dataset.m;
      if (m) {
        sync();
        const i = +b.closest('.qedit').dataset.i;
        const qs = sv.questions;
        if (m === 'up') [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
        if (m === 'down') [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
        if (m === 'dup') qs.splice(i + 1, 0, { ...structuredClone(qs[i]), id: uid() });
        if (m === 'del') { if (!confirm('이 문항을 삭제할까요?')) return; qs.splice(i, 1); }
        draw();
        return;
      }
      if (act === 'add') {
        sync();
        sv.questions.push({ id: uid(), type: 'text', label: '', required: false });
        draw();
        const all = root.querySelectorAll('[data-f=label]');
        all[all.length - 1].focus();
      }
      if (act === 'save') {
        sync();
        if (!sv.title) return toast('설문지 제목을 입력하세요');
        const bad = sv.questions.findIndex((q) => !q.label || (['radio', 'checkbox'].includes(q.type) && !(q.options || []).length));
        if (bad >= 0) return toast(`${bad + 1}번 문항: 질문 내용과 선택지를 확인하세요`);
        sv.updatedAt = Date.now();
        await DB.put('surveys', sv);
        toast('저장했습니다');
        if (isNew) go(`#/admin/survey/${sv.id}`);
      }
      if (act === 'preview') window.open(`#/fill/${sv.id}`, '_blank');
      if (act === 'del') {
        if (!confirm('설문지를 삭제할까요? 이미 받은 응답은 그대로 보관됩니다.')) return;
        await DB.del('surveys', sv.id); toast('삭제했습니다'); go('#/admin/survey');
      }
    });
  }

  // ---------- 관리자: 설정 / 백업 ----------
  async function settings() {
    const s = Settings.get();
    $app.innerHTML = `
      <div class="pagehead"><h1>설정</h1></div>
      <section class="block">
        <h2>기본</h2>
        <label class="q">기관명 (환자 화면 상단 표시)<input id="cn" value="${esc(s.clinicName || '')}" placeholder="예: ○○한의원"></label>
        <button class="btn primary" data-act="name">저장</button>
      </section>
      <section class="block">
        <h2>관리자 PIN 변경</h2>
        <div class="grid2">
          <label class="q">새 PIN (4자리 이상)<input id="p1" type="password" inputmode="numeric" autocomplete="new-password"></label>
          <label class="q">새 PIN 확인<input id="p2" type="password" inputmode="numeric" autocomplete="new-password"></label>
        </div>
        <button class="btn primary" data-act="pin">PIN 변경</button>
      </section>
      <section class="block">
        <h2>백업 · 복원</h2>
        <p class="hint">모든 데이터는 <b>이 기기의 브라우저 안에만</b> 저장되며 외부 서버로 전송되지 않습니다. 브라우저 데이터 삭제·기기 분실 시 복구할 수 없으니 정기적으로 백업 파일을 내려받아 안전한 곳에 보관하세요.</p>
        <div class="row">
          <button class="btn" data-act="backup">백업 파일 내려받기 (JSON)</button>
          <label class="btn">백업 파일로 복원<input type="file" id="restore" accept="application/json,.json" hidden></label>
        </div>
      </section>
      <section class="block">
        <h2>데이터 정리</h2>
        <div class="row">
          <button class="btn danger" data-act="purgeDone">처리완료 응답 일괄 삭제</button>
          <button class="btn danger" data-act="purgeAll">모든 응답 삭제</button>
        </div>
      </section>`;

    $app.querySelector('[data-act=name]').onclick = () => { Settings.set({ clinicName: document.getElementById('cn').value.trim() }); toast('저장했습니다'); route(); };
    $app.querySelector('[data-act=pin]').onclick = async () => {
      const a = document.getElementById('p1').value; const b = document.getElementById('p2').value;
      if (a.length < 4) return toast('PIN은 4자리 이상이어야 합니다');
      if (a !== b) return toast('PIN이 일치하지 않습니다');
      Settings.set({ pinHash: await sha256(a) }); toast('PIN을 변경했습니다');
      document.getElementById('p1').value = document.getElementById('p2').value = '';
    };
    $app.querySelector('[data-act=backup]').onclick = async () => {
      const data = { app: 'patient-survey', version: 1, exportedAt: new Date().toISOString(), surveys: await DB.all('surveys'), responses: await DB.all('responses') };
      download(JSON.stringify(data, null, 2), `설문백업_${fmt(Date.now()).replace(/[: ]/g, '-')}.json`, 'application/json');
    };
    document.getElementById('restore').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'patient-survey' || !Array.isArray(data.surveys) || !Array.isArray(data.responses)) throw new Error('형식이 올바르지 않습니다');
        if (!confirm(`설문지 ${data.surveys.length}개, 응답 ${data.responses.length}건을 가져옵니다. 같은 항목은 덮어씁니다. 계속할까요?`)) return;
        await DB.bulkPut('surveys', data.surveys);
        await DB.bulkPut('responses', data.responses);
        toast('복원했습니다');
      } catch (err) { toast('복원 실패: ' + err.message); }
      e.target.value = '';
    };
    $app.querySelector('[data-act=purgeDone]').onclick = async () => {
      const done = (await DB.all('responses')).filter((r) => r.status === 'done');
      if (!done.length) return toast('처리완료 응답이 없습니다');
      if (!confirm(`처리완료 응답 ${done.length}건을 삭제할까요?`)) return;
      for (const r of done) await DB.del('responses', r.id);
      toast(`${done.length}건 삭제했습니다`);
    };
    $app.querySelector('[data-act=purgeAll]').onclick = async () => {
      if (prompt('모든 응답을 삭제하려면 "삭제"라고 입력하세요') !== '삭제') return;
      await DB.clear('responses'); toast('모든 응답을 삭제했습니다');
    };
  }

  // 라우트 별칭: 메뉴의 '#/admin/survey' → 설문지 목록
  routes.push([/^#\/admin\/survey$/, guard(surveys)]);

  // ---------- 시작 ----------
  seed().then(route);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e)));
  }
})();
