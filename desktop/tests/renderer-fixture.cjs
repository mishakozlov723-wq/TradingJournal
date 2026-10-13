'use strict';
const fixture = `<!doctype html><html><body>
<div id="appRoot" style="display:block"></div>
<div id="modelCreateOverlay"></div><div id="modelDeleteOverlay"></div>
<div id="modalOverlay" class="open"><div class="modal-box">
<div class="row"><button id="closeModalBtn">Close</button></div>
<form id="tradeForm">
<input id="magnitudeInput"><input id="riskPercentInput">
<div id="tradeScreenshotField"><div class="custom-file-picker"></div>
<input id="screenshotInput" type="file"><button id="screenshotRemoveBtn" type="button"></button>
<img id="screenshotPreview"><div id="screenshotPreviewWrap"></div><span id="screenshotFileName"></span></div>
<button id="tradeModalSubmitBtn" type="submit">Save</button><div id="saveError"></div>
</form></div></div>
<script>
var currentUser={},viewingUser='test',tradingModelsReady=true,tradingModelsUser='test';
var backtestTradeMode=false,currentScreenshot='draft-image',nativeCalls=[],openCount=0;
var firebase={auth:()=>({currentUser:{}})};
function openModal(){openCount++;document.getElementById('modalOverlay').classList.add('open');}
window.syterDesktop={
 setMiniMode:async(mini,animate)=>{nativeCalls.push({mini,animate});return {mini,pinned:true};},
 setMiniPinned:async enabled=>enabled,
 miniReady:()=>{},
 onModeRequest:callback=>{window.requestModeForTest=callback;}
};
</script></body></html>`;
module.exports = fixture;
