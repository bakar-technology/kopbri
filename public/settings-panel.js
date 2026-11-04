(() => {
  const $ = id => document.getElementById(id);
  const panel = $('connectionsDialog');
  let returnFrom, firstRun=false;
  function paintProvider(provider,state) {
    const row = panel.querySelector('[data-provider="'+provider+'"]');
    row.querySelector('small').textContent = state?.loggedIn ? 'Hesap bağlı' : state?.found ? 'Kurulu · hesap bağlanmadı' : 'Araç bulunamadı';
    row.querySelector('button').textContent = state?.loggedIn ? 'Hesabı aç' : 'Bağla';
    row.querySelector('button').disabled = state?.found===false;
    row.dataset.ready = String(Boolean(state?.loggedIn));
  }
  function refresh() {
    fetch('/api/status').then(response=>response.json()).then(data=>{
      for (const provider of ['codex','claude','gemini']) paintProvider(provider,data[provider]);
    }).catch(()=>{ $('connectionsHint').textContent='Hesap durumları kontrol edilemedi. Yeniden deneyebilirsin.'; });
    window.bb?.githubAction('profile').then(profile=>{
      $('settingsGithubStatus').textContent=profile?'@'+profile.login:'Hesap bağlanmadı';
      $('settingsGithub').textContent=profile?'Projeleri aç':'Bağla';
    }).catch(()=>{ $('settingsGithubStatus').textContent='GitHub durumu alınamadı'; });
    window.bb?.cloudflare('status').then(result=>{
      $('settingsCloudflareStatus').textContent=result.connected?'Bağlı · görüntüleme erişimi':'Bağlanmadı';
      $('settingsCloudflare').textContent=result.connected?'Aç':'Bağla';
    }).catch(()=>{ $('settingsCloudflareStatus').textContent='Cloudflare durumu alınamadı'; });
  }
  function open(first=false) {
    if (panel.open) return;
    firstRun ||= first;
    $('connectionsTitle').textContent=first?'kopbri’ye hoş geldin':'Bağlantılar';
    $('connectionsHint').textContent='Ajan sağlayıcılarını ve GitHub hesabını buradan yönet.';
    panel.showModal();
    refresh();
  }
  $('openSettings').onclick=()=>open();
  function finish() {
    window.bb?.onboarding('done');
    panel.close();
    if (firstRun) {
      firstRun=false;
      document.getElementById('desktopOffice')?.contentWindow?.kopbriOffice?.welcomeRecruiter();
    }
  }
  $('connectionsDone').onclick=finish;
  $('connectionsLater').onclick=finish;
  panel.querySelectorAll('[data-provider] button').forEach(button=>button.onclick=()=>{
    const provider=button.closest('[data-provider]').dataset.provider;
    returnFrom='model';
    panel.close();
    $('openChats').click();
    window.openLogin?.(provider);
  });
  $('loginClose').addEventListener('click',()=>{ if(returnFrom==='model'){returnFrom=null;open();} });
  $('settingsGithub').onclick=()=>{
    returnFrom='github';panel.close();window.kopbriGithub?.open();
  };
  $('githubDialog').addEventListener('close',()=>{ if(returnFrom==='github'){returnFrom=null;open();} });
  $('settingsCloudflare').onclick=()=>{returnFrom='cloudflare';panel.close();window.kopbriCloudflare?.open();};
  $('cloudflareDialog').addEventListener('close',()=>{if(returnFrom==='cloudflare'){returnFrom=null;open();}});
  window.kopbriSettings={open};
  if (window.bb?.onboarding && !new URLSearchParams(location.search).has('spotlight')) {
    window.bb.onboarding('get').then(done=>{if(!done)open(true);}).catch(()=>{});
  }
})();
