// public/yellowStickyNotes.js — checklist UI with persistence via /sticky-notes
(function(){
  const SAVE_DEBOUNCE = 500; // ms
  let saveTimer = null;
  let currentKey = 'default';

  function makeItem(text="", done=false){
    const li = document.createElement('li');
    li.className = 'ysn-item';

    const box = document.createElement('label');
    box.className = 'ysn-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!done;
    box.appendChild(input);

    const span = document.createElement('span');
    span.className = 'ysn-text';
    span.contentEditable = 'true';
    span.spellcheck = true;
    span.dataset.placeholder = 'Пиши тук…';
    if (text) span.textContent = text;

    li.appendChild(box);
    li.appendChild(span);

    // listeners that should trigger save
    input.addEventListener('change', onCheckboxChange);
    span.addEventListener('input', scheduleSave);

    return li;
  }

  function ensureList(editor){
    let ul = editor.querySelector(':scope > ul.ysn-list');
    if (!ul){
      ul = document.createElement('ul');
      ul.className = 'ysn-list';
      editor.innerHTML='';
      editor.appendChild(ul);
    }
    if (!ul.children.length){ ul.appendChild(makeItem('')); }
    return ul;
  }

  function caretToEnd(el){
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }

  // Helper to derive sticky note key from URL or global
  function getStickyKey(){
    try{
      if (window && window.YSN_KEY && typeof window.YSN_KEY === 'string') return window.YSN_KEY;
      const params = new URLSearchParams(location.search);
      const qKey = params.get('ysn') || params.get('sticky') || params.get('key');
      if (qKey) return qKey;
      const p = location.pathname.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'');
      return p || 'default';
    }catch(_e){ return 'default'; }
  }

  function collectItems(ul){
    const out = [];
    ul.querySelectorAll(':scope > li.ysn-item').forEach(li=>{
      const span = li.querySelector('.ysn-text');
      const chk  = li.querySelector('input[type="checkbox"]');
      const text = (span && span.textContent ? span.textContent : '').trim();
      // keep empty lines only if NOT last one
      if (text.length || chk.checked){
        out.push({ text, done: !!(chk && chk.checked) });
      }
    });
    return out;
  }

  function scheduleSave(){
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSaveNow, SAVE_DEBOUNCE);
  }

  async function doSaveNow(){
    saveTimer = null;
    try{
      const editor = document.getElementById('ysn-editor');
      if (!editor) return;
      const ul = editor.querySelector(':scope > ul.ysn-list');
      if (!ul) return;
      const items = collectItems(ul);
      await fetch('/sticky-notes', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ key: currentKey, items })
      });
    }catch(_e){ /* ignore network issues */ }
  }

  function onCheckboxChange(e){
    e.stopPropagation();
    const input = e.target.closest('input[type="checkbox"]');
    if (!input) return;
    const li = input.closest('li.ysn-item');
    if (!li) return;
    if (input.checked){
      // Persist checked item into done log (server file)
      try{
        const span = li.querySelector('.ysn-text');
        const text = (span && span.textContent) ? span.textContent.trim() : '';
        if (text){
          fetch('/sticky-notes/done-append', {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ key: currentKey, text, at: new Date().toISOString() })
          }).catch(()=>{});
        }
      }catch(_e){}
      // remove visually then save
      li.classList.add('removing');
      setTimeout(()=>{
        const ul = li.parentNode; li.remove();
        if (!ul.querySelector('li')) ul.appendChild(makeItem(''));
        scheduleSave();
      }, 180);
    } else {
      scheduleSave();
    }
  }

  async function loadExistingInto(ul){
    try{
      const res = await fetch('/sticky-notes?key=' + encodeURIComponent(currentKey), { cache: 'no-store' });
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      ul.innerHTML = '';
      if (!items.length) {
        ul.appendChild(makeItem(''));
      } else {
        for (const it of items){ ul.appendChild(makeItem(String(it.text||''), !!it.done)); }
      }
    }catch(_e){ /* if failing, just keep a single empty item */ }
  }

  async function mount(){
    try{
      const res = await fetch('/yellowStickyNotes.html', { cache:'no-store' });
      const html = await res.text();
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      const style = wrap.querySelector('#ysn-style');
      const root  = wrap.querySelector('#ysn-root');
      if (style) document.head.appendChild(style);
      if (root)  document.body.appendChild(root);

      const panel  = root.querySelector('#ysn-panel');
      const toggle = root.querySelector('.ysn-toggle');
      const close  = root.querySelector('.ysn-close');
      const editor = root.querySelector('#ysn-editor');
      editor.setAttribute('contenteditable','false');

      // key used for persistence (file name on server side)
      currentKey = getStickyKey();

      toggle.addEventListener('click', ()=> panel.classList.toggle('open'));
      if (close) close.addEventListener('click', ()=> panel.classList.remove('open'));

      const ul = ensureList(editor);
      // Load from server (creates file on first POST later)
      await loadExistingInto(ul);

      // Enter -> нов ред; Shift+Enter -> мек ред, only inside .ysn-text
      editor.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter' && !e.shiftKey){
          const sel = window.getSelection();
          if (!sel || !sel.anchorNode) return;
          const anchor = sel.anchorNode.nodeType===3 ? sel.anchorNode.parentElement : sel.anchorNode;
          const span = anchor && anchor.closest ? anchor.closest('.ysn-text') : null;
          if (!span) return; // only when typing inside a checklist text
          const li = span.closest('li.ysn-item');
          if (!li){ return; }
          e.preventDefault();
          const next = makeItem('');
          li.insertAdjacentElement('afterend', next);
          const nextSpan = next.querySelector('.ysn-text');
          nextSpan.focus();
          caretToEnd(nextSpan);
          scheduleSave();
        }
      });

      // Пейст → всеки ред нова точка
      editor.addEventListener('paste', (e)=>{
        const sel = window.getSelection();
        if (!sel || !sel.anchorNode) return;
        const anchor = sel.anchorNode.nodeType===3 ? sel.anchorNode.parentElement : sel.anchorNode;
        const span = anchor && anchor.closest ? anchor.closest('.ysn-text') : null;
        const li = span ? span.closest('li.ysn-item') : null;
        if (!li || !span) return;
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;
        const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        if (!lines.length) return;
        e.preventDefault();
        if (span.textContent.trim()===''){ span.textContent = lines.shift(); }
        let cur = li;
        for (const ln of lines){ const n = makeItem(ln); cur.insertAdjacentElement('afterend', n); cur = n; }
        const lastSpan = cur.querySelector('.ysn-text'); lastSpan.focus(); caretToEnd(lastSpan);
        scheduleSave();
      });

      // Клик по checkbox -> remove handled in onCheckboxChange (already schedules save)

      // Клик върху фон → фокус върху последната точка или съответния текст
      editor.addEventListener('click', (e)=>{
        const t = e.target;
        if (t.classList && t.classList.contains('ysn-text')) return; // already in text
        if (t.closest && t.closest('li.ysn-item')){
          const li = t.closest('li.ysn-item');
          const sp = li.querySelector('.ysn-text');
          sp.focus(); caretToEnd(sp);
          return;
        }
        if (t.id === 'ysn-editor'){
          const last = ul.lastElementChild || makeItem('');
          if (!ul.lastElementChild) ul.appendChild(last);
          const sp = last.querySelector('.ysn-text');
          sp.focus(); caretToEnd(sp);
        }
      });

      // Save when panel is closed or before page unload
      if (close) close.addEventListener('click', doSaveNow);
      window.addEventListener('beforeunload', doSaveNow);

    }catch(e){ console.warn('yellowStickyNotes mount failed:', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();