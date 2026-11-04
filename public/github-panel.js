(() => {
  const $ = id => document.getElementById(id);
  const modal = $('githubDialog');
  const call = (...args) => window.bb?.githubAction(...args);
  let items = [], interval, generation=0, polling=false;
  function status(text) { $('githubStatus').textContent = text; }
  function draw() {
    const query = $('githubQuery').value.toLocaleLowerCase('tr').trim();
    const matches = items.filter(repo=>repo.name.toLocaleLowerCase('tr').includes(query));
    $('githubList').replaceChildren(...matches.map(repo=>{
      const button = document.createElement('button');
      button.type='button';
      const label = document.createElement('strong'); label.textContent=repo.name;
      const detail = document.createElement('span'); detail.textContent=(repo.private?'Özel':'Açık')+' · '+repo.branch;
      button.append(label,detail);
      button.title=repo.description || repo.name;
      button.onclick = async () => {
        button.disabled=true;
        status(repo.name+' için hedef klasörü seç…');
        try {
          const [owner,repository]=repo.name.split('/');
          const folder=await call('clone',{owner,repository});
          if (folder) { await window.loadWs?.(); status('Çalışma alanı açıldı: '+folder); }
          else status('Kopyalama iptal edildi.');
        } catch(error) { status(error.message.replace(/^.*Error: /,'')); }
        finally { button.disabled=false; }
      };
      return button;
    }));
    if (query && !matches.length) status('Aramana uygun depo bulunamadı.');
  }
  async function refresh(current) {
    if (!window.bb?.githubAction) { status('GitHub bağlantısı masaüstü uygulamasında kullanılabilir.');return; }
    const profile=await call('profile');
    if(current!==generation)return;
    $('githubConnect').hidden=Boolean(profile);
    $('githubDisconnect').hidden=!profile;
    $('githubQuery').hidden=!profile;
    $('githubCode').hidden=true;
    if(!profile) {items=[];draw();status('GitHub profilini bağlayarak depolarını aç.');return;}
    status('@'+profile.login+' · Depolar yükleniyor…');
    items=await call('repositories');
    if(current!==generation)return;
    draw();
    status('@'+profile.login+' · '+items.length+' depo');
  }
  function stopPolling(){clearInterval(interval);interval=null;}
  function open() {
    if(modal.open)return;
    const current=++generation;
    items=[];$('githubQuery').value='';$('githubList').replaceChildren();
    status('GitHub bağlantısı kontrol ediliyor…');modal.showModal();
    refresh(current).catch(()=>status('GitHub’a ulaşılamadı. Tekrar deneyebilirsin.'));
  }
  $('openGithub').onclick=open;
  $('githubClose').onclick=()=>modal.close();
  modal.onclose=()=>{generation++;stopPolling();};
  $('githubQuery').oninput=draw;
  $('githubConnect').onclick=async () => {
    stopPolling();
    try {
      await call('connect');
      status('Tarayıcıda GitHub yetkilendirmesini tamamla.');
      interval=setInterval(async()=>{
        if(polling)return;
        polling=true;
        try {
          const result=await call('login-state');
          if(!modal.open)return;
          if(result.code){$('githubCode').hidden=false;$('githubCode').textContent='Cihaz kodu: '+result.code;}
          if(result.state==='connected'){stopPolling();await refresh(generation);}
          else if(result.state==='error'){stopPolling();status('Bağlantı tamamlanamadı. Yeniden bağlanmayı dene.');}
        } catch {stopPolling();status('GitHub bağlantısı kontrol edilemedi.');}
        finally{polling=false;}
      },850);
    } catch {status('GitHub giriş ekranı açılamadı.');}
  };
  $('githubDisconnect').onclick=async()=>{
    try{await call('disconnect');await refresh(generation);}
    catch{status('GitHub bağlantısı kaldırılamadı.');}
  };
  window.kopbriGithub={open};
})();
