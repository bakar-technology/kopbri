(() => {
  const office = document.getElementById('desktopOffice');
  const trigger = document.getElementById('openOffice');
  const officeTabs = Array.from(document.querySelectorAll('[data-office-view]'));
  const chats = document.getElementById('openChats');
  const dialog = document.getElementById('desktopSearch');
  const input = document.getElementById('desktopQuery');
  const results = document.getElementById('desktopResults');
  const history = document.getElementById('desktopHistory');
  const historyList = document.getElementById('chatList');
  const historyQuery = document.getElementById('historyQuery');
  const usageDrawer = document.getElementById('usageDrawer');
  const spotlight = new URLSearchParams(location.search).has('spotlight');
  if (spotlight) document.body.classList.add('spotlight-only');
  const toolbar = document.getElementById('windowBar');
  const back = document.getElementById('windowBack'), forward = document.getElementById('windowForward');
  const nav = [];
  let navIndex = -1;
  function show(section,track=true) {
    const visible = Boolean(section);
    if (track && nav[navIndex]!==section) { nav.splice(navIndex+1,nav.length,section); navIndex = nav.length-1; }
    if (back) back.disabled = navIndex<=0;
    if (forward) forward.disabled = navIndex>=nav.length-1;
    office.hidden = !visible;
    document.body.classList.toggle('office-open',visible);
    trigger.setAttribute('aria-pressed',String(visible));
    officeTabs.forEach(button => button.setAttribute('aria-pressed',String(section===button.dataset.officeView)));
    chats.setAttribute('aria-pressed',String(!visible));
    if (visible && office.contentWindow.kopbriOffice) office.contentWindow.kopbriOffice.open(section);
  }
  if (toolbar) {
    back.onclick = () => { if (navIndex>0) show(nav[--navIndex],false); };
    forward.onclick = () => { if (navIndex<nav.length-1) show(nav[++navIndex],false); };
    document.getElementById('toggleSidebar').onclick = event => {
      const closed = document.body.classList.toggle('sidebar-closed');
      event.currentTarget.setAttribute('aria-pressed',String(closed));
    };
    toolbar.querySelectorAll('[data-window-menu]').forEach(button=>button.onclick = () => {
      const box = button.getBoundingClientRect();
      window.bb?.windowMenu(button.dataset.windowMenu,Math.round(box.left),Math.round(box.bottom));
    });
  }
  officeTabs.forEach(button => button.onclick = () => show(button.dataset.officeView));
  chats.onclick = () => show(null);
  office.addEventListener('load',() => {
    office.contentDocument.addEventListener('keydown',shortcut);
    if (spotlight) {
      office.contentDocument.addEventListener('keyup',releaseShortcut);
      office.contentDocument.addEventListener('kopbri-release-voice',() => window.bb?.spotlightAction('release'));
    }
    office.contentDocument.addEventListener('kopbri-office-view',event => {
      officeTabs.forEach(button => button.setAttribute('aria-pressed',String(event.detail===button.dataset.officeView)));
    });
  });
  show('office');
  const inMain = (mode,local) => spotlight ? () => window.bb?.spotlightAction('open',mode) : local;
  function maybeHide() {
    if (!spotlight) return;
    setTimeout(() => {
      if (!document.querySelector('dialog[open]') && !office.contentDocument?.querySelector('dialog[open]')) {
        window.bb?.spotlightAction('hide');
      }
    },0);
  }
  office.addEventListener('load',() => {
    if (!spotlight) return;
    office.contentDocument.body.dataset.spotlight = 'true';
    office.contentDocument.querySelectorAll('dialog').forEach(item=>item.addEventListener('close',maybeHide));
  });
  dialog.addEventListener('close',maybeHide);
  for (const id of ['sideNew','chatList']) document.getElementById(id).addEventListener('click',() => show(null),true);
  const normalize = value => value.toLocaleLowerCase('tr').trim();
  function filterHistory() {
    const query = normalize(historyQuery.value);
    let count = 0;
    for (const button of historyList.querySelectorAll('button')) {
      button.hidden = !normalize(button.textContent).includes(query);
      if (!button.hidden) count++;
    }
    const empty = document.getElementById('historyEmpty');
    empty.hidden = count!==0;
    empty.textContent = query ? 'Aramana uygun sohbet bulunamadı.' : 'Henüz kaydedilmiş sohbet yok.';
  }
  function openHistory() {
    if (history.open) return;
    historyQuery.value = ''; filterHistory(); history.showModal(); historyQuery.focus();
  }
  document.getElementById('openHistory').onclick = openHistory;
  document.getElementById('historyClose').onclick = () => history.close();
  historyList.addEventListener('click',event => { if (event.target.closest('button')) history.close(); });
  historyQuery.oninput = filterHistory;
  historyQuery.onkeydown = event => { if (event.key==='Enter') historyList.querySelector('button:not([hidden])')?.click(); };
  new MutationObserver(filterHistory).observe(historyList,{childList:true});
  document.getElementById('usageBtn')?.addEventListener('click',() => { usageDrawer.open = true; });
  new MutationObserver(() => {
    if (document.getElementById('usage').classList.contains('edit')) usageDrawer.open = true;
  }).observe(document.getElementById('usage'),{attributes:true,attributeFilter:['class']});
  function search() {
    const entries = [
      ['Ajan Ofisi',inMain('office',() => show('office'))],['Görevler',inMain('tasks',() => show('tasks'))],['Ajan konuşmaları',inMain('chat',() => show('chat'))],
      ['Sohbet geçmişi',inMain('history',openHistory)],['Token kullanımı',inMain('tokens',() => { usageDrawer.open = true; usageDrawer.querySelector('summary').focus(); })],
      ['GitHub projeleri',inMain('github',() => window.kopbriGithub?.open())],
      ['Ayarlar · Hesap bağlantıları',inMain('settings',() => window.kopbriSettings?.open())],
      ['Cloudflare bölgeleri ve Worker’lar',inMain('cloudflare',() => window.kopbriCloudflare?.open())],
      ['Klasör izinlerini kaldır',() => window.bb?.folderAccess('revoke','codex')],
      ['Yeni ajan',() => { show('office'); office.contentWindow.kopbriOffice?.newAgent(); }],
      ['Sesli ajan görüşmesi',openVoice],
      ['Notlar ve günlük',inMain('notes',() => { show(null); document.getElementById('notesBtn').click(); })],
      ['Yeni sohbet',inMain('new-chat',() => document.getElementById('sideNew').click())],
      ...Array.from(document.querySelectorAll('#chatList button'),(button,index) => ['Sohbet · '+button.textContent,inMain('history:'+index,() => button.click())])
    ];
    for (const entry of office.contentWindow.kopbriOffice?.search() ?? []) entries.push([entry.label,inMain(entry.tab+':'+entry.index,() => {
      show(entry.tab); office.contentWindow.kopbriOffice.open(entry.tab,entry.index);
    })]);
    if (input.value.trim()) entries.unshift(['Görev ata · '+input.value.trim(),() => {
      show('tasks'); office.contentWindow.kopbriOffice?.newTask(input.value.trim());
    }]);
    const words = input.value.trim().toLocaleLowerCase(window.kopbriLanguage?.() || 'tr').split(/\s+/);
    results.replaceChildren(...entries.filter(([label]) => words.every(word => [label,window.kopbriTranslate?.(label) || label].some(value=>value.toLocaleLowerCase(window.kopbriLanguage?.() || 'tr').includes(word)))).slice(0,60).map(([label,action]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = () => { dialog.close(); action(); };
      return button;
    }));
    if (!results.firstChild) results.textContent = 'Sonuç bulunamadı.';
  }
  function openSearch() {
    if (dialog.open) { input.focus(); return; }
    input.value = ''; search(); dialog.showModal(); input.focus();
  }
  function shortcut(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') { event.preventDefault(); openSearch(); }
  }
  function releaseShortcut(event) {
    if (!['Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(event.code)) return;
    if (office.contentWindow.kopbriOffice?.releaseVoice()) window.bb?.spotlightAction('release');
  }
  function openVoice() {
    show('office');
    if (spotlight) window.bb?.spotlightAction('voice-size');
    office.contentWindow.kopbriOffice?.voice();
  }
  window.bb?.onSpotlight?.(mode => {
    const api = office.contentWindow.kopbriOffice;
    if (mode==='dismiss') {
      document.querySelectorAll('dialog[open]').forEach(item=>item.close());
      office.contentDocument?.querySelectorAll('dialog[open]').forEach(item=>item.close('cancel'));
      window.bb?.spotlightAction('release');
      return;
    }
    if (mode==='voice-release') { api?.releaseVoice(); return; }
    if (mode==='voice-hold') { show('office'); api?.holdVoice(); return; }
    if (mode==='voice') { openVoice(); return; }
    if (mode.startsWith('voice-agent:')) { show('office'); api?.voice(Number(mode.slice(12))); return; }
    if (mode.startsWith('open:')) {
      const [,view,id] = mode.split(':');
      if (view==='history') { if (id!==undefined) historyList.children[Number(id)]?.click(); else openHistory(); }
      else if (view==='github') window.kopbriGithub?.open();
      else if (view==='settings') window.kopbriSettings?.open();
      else if (view==='cloudflare') window.kopbriCloudflare?.open();
      else if (view==='tokens') { usageDrawer.open = true; usageDrawer.querySelector('summary').focus(); }
      else if (view==='notes') { show(null); document.getElementById('notesBtn').click(); }
      else if (view==='new-chat') document.getElementById('sideNew').click();
      else if (['office','tasks','chat'].includes(view)) { show(view); if (id!==undefined) api?.open(view,Number(id)); }
      return;
    }
    openSearch();
  });
  document.addEventListener('keydown',shortcut);
  if (spotlight) document.addEventListener('keyup',releaseShortcut);
  document.getElementById('openSearch').onclick = openSearch;
  input.oninput = search;
  input.onkeydown = event => {
    if (event.key==='Enter') results.querySelector('button')?.click();
    if (event.key==='ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
  };
})();
