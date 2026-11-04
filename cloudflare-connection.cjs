'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {safeStorage}=require('electron');
const identifier=/^[a-f0-9]{32}$/i;
function connection(dataRoot) {
  const file=path.join(dataRoot,'.kopbri','desktop','cloudflare.secure');
  async function load() {
    try { return JSON.parse(safeStorage.decryptString(await fs.readFile(file))); } catch { return null; }
  }
  async function api(token,endpoint) {
    const response=await fetch('https://api.cloudflare.com/client/v4'+endpoint,{
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(10000),
      redirect:'error'
    });
    const data=await response.json();
    if (!response.ok || !data.success) throw Error(response.status===403?'Cloudflare okuma izni eksik.':'Cloudflare isteği tamamlanamadı.');
    return data.result;
  }
  async function inventory(credentials) {
    if(!credentials)return {connected:false};
    const {token,accountId}=credentials;
    const [accounts,zones]=await Promise.allSettled([
      accountId?Promise.resolve([{id:accountId,name:'Seçili hesap'}]):api(token,'/accounts?per_page=30'),
      api(token,'/zones?per_page=50')
    ]);
    const accountList=accounts.status==='fulfilled'?accounts.value.map(item=>({id:item.id,name:item.name})):[];
    if(!accountList.length && zones.status==='fulfilled') {
      const discovered=new Map();
      for(const item of zones.value)if(identifier.test(item.account?.id||''))discovered.set(item.account.id,item.account.name);
      for(const [id,name] of discovered)accountList.push({id,name});
    }
    const zoneList=zones.status==='fulfilled'?zones.value.map(item=>({name:item.name,status:item.status,account:item.account?.name})):[];
    return {connected:true,accounts:accountList,zones:zoneList,zonesAvailable:zones.status==='fulfilled',accountsAvailable:accounts.status==='fulfilled'};
  }
  return async function action(name,payload) {
    if(name==='status')return {connected:Boolean(await load())};
    if(name==='disconnect'){await fs.rm(file,{force:true});return {connected:false};}
    if(name==='connect'){
      const token=String(payload?.token||'').trim(), accountId=String(payload?.accountId||'').trim();
      if(!/^[A-Za-z0-9_-]{30,160}$/.test(token) || (accountId&&!identifier.test(accountId))) throw Error('API belirtecini ve varsa hesap kimliğini kontrol et.');
      if(!safeStorage.isEncryptionAvailable())throw Error('Bu cihazda güvenli kimlik bilgisi saklama kullanılamıyor.');
      const endpoint=accountId && token.startsWith('cfat_') ? '/accounts/'+accountId+'/tokens/verify' : '/user/tokens/verify';
      let result;
      try { result=await api(token,endpoint); }
      catch(error) { if(accountId && endpoint==='/user/tokens/verify') result=await api(token,'/accounts/'+accountId+'/tokens/verify'); else throw error; }
      if(result.status!=='active')throw Error('Cloudflare API belirteci etkin değil.');
      const credentials={token,accountId};
      await fs.mkdir(path.dirname(file),{recursive:true});
      await fs.writeFile(file+'.tmp',safeStorage.encryptString(JSON.stringify(credentials)));
      await fs.rename(file+'.tmp',file);
      return {connected:true};
    }
    const credentials=await load();
    if(name==='inventory')return inventory(credentials);
    if(name==='workers'){
      const id=String(payload?.accountId||'');
      if(!credentials || !identifier.test(id) || (credentials.accountId && credentials.accountId!==id))throw Error('Bir Cloudflare hesabı seç.');
      const rows=await api(credentials.token,'/accounts/'+id+'/workers/scripts');
      return rows.map(item=>({name:item.id,modified:item.modified_on}));
    }
    throw Error('Bilinmeyen Cloudflare işlemi.');
  };
}
module.exports=connection;
