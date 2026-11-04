(() => {
  const dialog=document.getElementById('mailDialog'), form=dialog.querySelector('form');
  const status=document.getElementById('mailStatus'), list=document.getElementById('mailMessages');
  const secret=form.elements.secret, client=form.elements.client, provider=form.elements.provider;
  const open=document.getElementById('openMail');
  let busy=false;
  function setStatus(text){status.textContent=text;}
  async function action(name,callback) {
    if(busy)return;
    busy=true;
    for(const button of form.querySelectorAll('button'))button.disabled=true;
    provider.disabled=true;
    setStatus('E-posta kontrol ediliyor…');
    try {
      if(!window.bb?.mail)throw Error('E-posta bağlantısı masaüstü uygulamasında kullanılabilir.');
      await callback((payload)=>window.bb.mail(provider.value,name,payload));
    } catch(error) {setStatus(error.message.replace(/^.*Error: /,''));}
    finally {
      busy=false; provider.disabled=false;
      for(const button of form.querySelectorAll('button'))button.disabled=false;
    }
  }
  function refreshStatus(){
    secret.closest('label').hidden=provider.value!=='gmail';
    document.getElementById('mailOAuth').hidden=provider.value==='imap';
    document.getElementById('mailImap').hidden=provider.value!=='imap';
    client.value='';secret.value='';form.elements.pass.value='';list.replaceChildren();
    return action('status',async call=>setStatus((await call()).connected?'E-posta hesabı bağlı.':'OAuth istemci bilgilerini gir ve hesabını bağla.'));
  }
  form.onsubmit=event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(form));
    const credentials={...values,id:client.value,secret:secret.value,canSend:form.elements.canSend.checked};
    secret.value='';form.elements.pass.value='';
    return action('connect',async call=>{await call(credentials);client.value='';setStatus('E-posta hesabı bağlı.');});
  };
  provider.onchange=refreshStatus;
  document.getElementById('mailRefresh').onclick=()=>action('list',async call=>{
    const rows=await call({unread:form.elements.unread.checked});
    list.replaceChildren(...rows.map(item=>{
      const row=document.createElement('li'), headline=document.createElement('strong');
      headline.textContent=(item.unread?'● ':'')+(item.subject || '(no subject)');
      const from=document.createElement('small');from.textContent=item.from || '';
      const preview=document.createElement('p');preview.textContent=item.preview || '';
      row.append(headline,from,preview);return row;
    }));
    setStatus(rows.length?'Son iletiler gösteriliyor.':'Görüntülenecek ileti yok.');
  });
  document.getElementById('mailDisconnect').onclick=()=>action('disconnect',async call=>{await call();list.replaceChildren();setStatus('E-posta bağlantısı kaldırıldı.');});
  document.getElementById('mailClose').onclick=()=>dialog.close();
  const field=id=>document.getElementById(id);
  field('mailSend').onclick=()=>{
    const button=field('mailSend');
    if(busy || button.disabled)return;
    button.disabled=true;
    action('send',async call=>{
      const result=await call({to:field('mailTo').value,subject:field('mailSubject').value,body:field('mailBody').value});
      if (result?.sent) {
        for(const id of ['mailTo','mailSubject','mailBody'])field(id).value='';
        setStatus('E-posta gönderildi.');
      } else setStatus('Gönderim iptal edildi.');
    }).finally(()=>{button.disabled=false;});
  };
  dialog.onclose=()=>{list.replaceChildren();secret.value='';client.value='';form.elements.pass.value='';};
  open.onclick=()=>{dialog.showModal();refreshStatus();};
  window.bb?.onMailDraft?.(draft=>{
    field('mailTo').value=draft.to;
    field('mailSubject').value=draft.subject;
    field('mailBody').value=draft.body;
    if(!dialog.open)dialog.showModal();
    refreshStatus();
    field('mailTo').focus();
  });
})();
