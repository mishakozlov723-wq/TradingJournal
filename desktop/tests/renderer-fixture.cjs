'use strict';
const fixture = `<!doctype html><html><head><style>
html,body{margin:0;background:#080a0e;color:#dce5ef;font:14px Arial,sans-serif}
#appRoot{padding:36px}#appRoot h1{font-size:24px}button{color:inherit;background:#151a22;border:1px solid #354050;border-radius:8px;padding:10px}
#modalOverlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#000a}
#modalOverlay.open{display:flex}.modal-box{box-sizing:border-box;width:350px;padding:24px;background:#0d1118;border:1px solid #28313e;border-radius:12px;max-height:90vh;overflow:auto}
.row{display:flex;justify-content:space-between;margin-bottom:20px}input{box-sizing:border-box;width:100%;padding:10px;margin:8px 0;color:inherit;background:#151a22;border:1px solid #354050;border-radius:8px}
.submit-btn,#tradeModalSubmitBtn{margin-top:16px;width:100%;background:#70dbb6;color:#09231a}#tradeScreenshotField{margin-top:12px}
#testJournalScroll{padding:24px;background:#10151d;border:1px solid #28313e;border-radius:10px;margin-top:24px}
</style></head><body>
<div id="appRoot" style="display:block"><button id="openAddModal">Add Trade</button><div id="testJournalScroll" style="height:80px;overflow:auto"><div style="height:1000px">Calendar view</div></div></div>
<div id="modelCreateOverlay"></div><div id="modelDeleteOverlay"></div>
<div id="modalOverlay" class="open"><div class="modal-box">
<div class="row"><strong>Add Trade</strong><button id="closeModalBtn">Close</button></div>
<form id="tradeForm">
<label>RR<input id="magnitudeInput" value="2.25"></label><label>Risk %<input id="riskPercentInput" value="0.5"></label>
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
var activeTab='calendar',prepareCalls=[];
window.syterDesktop={
 prepareMiniMode:async(mini,animate)=>{prepareCalls.push({mini,animate,modalOpen:modalOverlay.classList.contains('open'),compact:document.body.classList.contains('syter-mini')});return animate;},
 cancelMiniMode:async()=>{},
 setMiniMode:async(mini,animate)=>{nativeCalls.push({mini,animate});return {mini,pinned:true};},
 setMiniPinned:async enabled=>enabled,
 miniReady:()=>{},
 onModeRequest:callback=>{window.requestModeForTest=callback;}
};
</script></body></html>`;
module.exports = fixture;
