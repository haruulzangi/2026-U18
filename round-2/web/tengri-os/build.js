const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');

const src = fs.readFileSync('public/desktop.js', 'utf8');

// Anti-inspection layer (gets obfuscated with everything else)
const antiInspect = `
(function(){
  document.addEventListener('contextmenu',function(e){e.preventDefault();return false;},true);
  document.addEventListener('keydown',function(e){
    if(e.key==='F12')e.preventDefault();
    if(e.ctrlKey&&e.shiftKey&&'IJCijc'.indexOf(e.key)!==-1)e.preventDefault();
    if(e.ctrlKey&&(e.key==='u'||e.key==='U'||e.key==='s'||e.key==='S'))e.preventDefault();
  },true);
  setInterval(function(){
    if(window.outerHeight-window.innerHeight>250||window.outerWidth-window.innerWidth>250){
      try{document.getElementById('desktop').style.filter='blur(20px) saturate(0)';}catch(x){}
    }else{
      try{document.getElementById('desktop').style.filter='';}catch(x){}
    }
  },2500);
})();
`;

const fullCode = antiInspect + '\n' + src;
console.log('Obfuscating desktop.js (' + fullCode.length + ' bytes)...');

const result = JavaScriptObfuscator.obfuscate(fullCode, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,           // Don't freeze page
  disableConsoleOutput: false,      // Don't break SSE/fetch
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,             // CRITICAL: keep global fn names (called from HTML onclick)
  selfDefending: false,             // Don't break on whitespace changes
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  // Reserve global names used in HTML ondblclick/onclick attributes
  reservedNames: [
    'openBrowser','openWebhook','openNotes','openHelp',
    'closeWin','minWin','showWin','focusWin',
    'brGo','brNav','brReload','copyHook',
    'boot','SID'
  ],
});

const obfuscated = result.getObfuscatedCode();
fs.writeFileSync('public/desktop.min.js', obfuscated);
console.log('Output: desktop.min.js (' + obfuscated.length + ' bytes)');

if (process.env.DOCKER_BUILD) {
  fs.unlinkSync('public/desktop.js');
  console.log('Removed source desktop.js');
} else {
  console.log('Kept source desktop.js (local build)');
}
