const {build}=require('../package.json');
const {win,nsis,extraResources,files,...shared}=build;
module.exports={
  ...shared,
  extraResources:[],
  files:files.filter(pattern=>!pattern.includes('/darwin/')),
  mac:{
    target:'dmg',
    icon:'build/icon.png',
    artifactName:'kopbri-macos-${version}-${arch}.dmg',
    category:'public.app-category.productivity',
    identity:null,
    extendInfo:{NSMicrophoneUsageDescription:'kopbri uses the microphone for voice conversations.'}
  }
};
