const setup = window.kopbriSetup;
const $ = id => document.getElementById(id);
setup.onState((id,state,error) => {
  const row = $(id);
  row.dataset.state = state;
  row.querySelector('span').textContent = {ready:'Hazır',installing:'İndiriliyor…',error:'Kurulamadı'}[state];
  if (error) row.title = error;
});
async function start() {
  $('retry').hidden = true; $('done').disabled = true;
  $('setupStatus').textContent = 'Sağlayıcı araçları kontrol ediliyor…';
  try {
    const result = await setup.start();
    const failed = Object.values(result).includes('error');
    $('setupStatus').textContent = failed ? 'Bazı araçlar indirilemedi. Tekrar deneyebilir veya hazır araçlarla devam edebilirsin.' : 'Araçlar hazır. Uygulamada sağlayıcı hesaplarını bağlayabilirsin.';
    $('retry').hidden = !failed;
  } catch {
    $('retry').hidden = false;
    $('setupStatus').textContent = 'Araç kurulumu başlatılamadı. Tekrar deneyebilirsin.';
  } finally { $('done').disabled = false; }
}
$('retry').onclick = start;
$('done').onclick = setup.finish;
start();
