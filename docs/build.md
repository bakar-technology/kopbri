# Windows paketi

`npm start` Electron geliştirme giriş noktasıdır. `npm run build` Windows x64 NSIS kurucusunu üretir.

Tam kurucuyu üretmek için `package.json` içindeki `build.extraResources` dizinlerini yerelde hazırla:

| Dizin | İçerik |
| --- | --- |
| `.kopbri/node-runtime` | Windows x64 Node.js ve npm dağıtımı |
| `.kopbri/github-runtime` | Windows x64 `gh.exe` |
| `.kopbri/speech` | Whisper CLI ve Türkçe model dosyaları, ufakzeka-kulak, Vosk, Supertonic ve Piper çalışma dosyaları |

Bu kaynakların dağıtım koşulları kendi lisanslarına bağlıdır. Yerel hesap verileri ve model dosyaları Git ile takip edilmez.
