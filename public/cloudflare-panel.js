(() => {
  const $=id=>document.getElementById(id), dialog=$('cloudflareDialog'), form=$('cloudflareForm');
  const call=(...args)=>window.bb.cloudflare(...args);
  const status=text=>{ $('cloudflareStatus').textContent=text; };
  function rows(container,items,label,empty) {
    container.replaceChildren(...items.map(item=>{
      const node=document.createElement('li');node.textContent=label(item);return node;
    }));
    if(!items.length){const row=document.createElement('li');row.textContent=empty;container.append(row);}
  }
  async function workers() {
    const accountId=$('cloudflareAccounts').value;
    if(!accountId)return;
    try { rows($('cloudflareWorkers'),await call('workers',{accountId}),item=>item.name,'Bu hesapta Worker yok.'); }
    catch {rows($('cloudflareWorkers'),[],null,'Worker listesi için Workers Scripts Read izni gerekli.');}
  }
  async function refresh() {
    status('Cloudflare bağlantısı kontrol ediliyor…');
    const data=await call('inventory');
    form.hidden=data.connected;
    $('cloudflareInventory').hidden=!data.connected;
    $('cloudflareDisconnect').hidden=!data.connected;
    if(!data.connected){status('Cloudflare API belirtecini gir.');return;}
    status('Bağlı · görüntüleme erişimi');
    rows($('cloudflareZones'),data.zones,item=>item.name+' · '+item.status,data.zonesAvailable?'Erişilebilir bölge yok.':'Bölge listesi için Zone Read izni gerekli.');
    $('cloudflareAccounts').replaceChildren(...data.accounts.map(item=>new Option(item.name,item.id)));
    if(data.accounts.length)workers();
    else rows($('cloudflareWorkers'),[],null,'Worker görmek için hesap kimliği veya hesap okuma izni gerekli.');
  }
  function open() {
    if(dialog.open)return;
    dialog.showModal();
    if(!window.bb?.cloudflare){status('Cloudflare bağlantısı masaüstü uygulamasında kullanılabilir.');return;}
    refresh().catch(()=>status('Cloudflare’a ulaşılamadı.'));
  }
  $('cloudflareClose').onclick=()=>dialog.close();
  $('cloudflareAccounts').onchange=workers;
  $('cloudflareDisconnect').onclick=async()=>{await call('disconnect');await refresh();};
  form.onsubmit=async event=>{
    event.preventDefault();
    const data=new FormData(form);
    form.querySelector('button').disabled=true;
    status('API belirteci doğrulanıyor…');
    try { await call('connect',{token:data.get('token'),accountId:data.get('account')});form.reset();await refresh(); }
    catch(error){status(error.message.replace(/^.*Error: /,''));}
    finally{form.elements.token.value='';form.querySelector('button').disabled=false;}
  };
  dialog.onclose=()=>form.reset();
  window.kopbriCloudflare={open};
})();
