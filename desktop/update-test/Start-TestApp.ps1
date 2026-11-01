# Disposable CI transport injection only. No installed source/configuration edits.
# Production publisher validation still reads the unchanged GitHub configuration.
function Start-TestApp([string]$exe){
 $inspectorPort=51874
 $process=Start-Process $exe -ArgumentList '--force-renderer-accessibility',"--inspect=127.0.0.1:$inspectorPort" -PassThru
 $deadline=[DateTime]::UtcNow.AddSeconds(20);$target=$null
 while([DateTime]::UtcNow -lt $deadline){
  try{$targets=Invoke-RestMethod "http://127.0.0.1:$inspectorPort/json/list" -TimeoutSec 2;$target=@($targets|Where-Object{$_.webSocketDebuggerUrl})[0];if($target){break}}catch{}
  Start-Sleep -Milliseconds 100
 }
 if(!$target){throw 'Disposable application main-process inspector did not become available'}
 $expression=@'
(async()=>{
 const req=process.mainModule&&process.mainModule.require?process.mainModule.require.bind(process.mainModule):require;
 const {app}=req('electron');await app.whenReady();
 if(app.getVersion()!=='__SYTER_FROM_VERSION__')throw Error('Test needs the actual installed __SYTER_FROM_VERSION__ application');
 const updater=req('electron-updater').autoUpdater;
 const config=await updater.configOnDisk.value;
 if(config.provider!=='github'||config.owner!=='mishakozlov723-wq'||config.repo!=='syter-releases')throw Error('Production updater identity changed');
 await req('./lifecycle/update-trust').requireUpdatePublisher(updater,'github');
 // setFeedURL changes this process's transport only, not configOnDisk or files.
 updater.setFeedURL({provider:'generic',url:'http://127.0.0.1:51873/',useMultipleRangeRequest:false});
 await new Promise(resolve=>setTimeout(resolve,500));
 await updater.checkForUpdates();
 return {version:app.getVersion(),repository:config.repo};
})()
'@
 $socket=[Net.WebSockets.ClientWebSocket]::new();$cancel=[Threading.CancellationTokenSource]::new();$cancel.CancelAfter(20000)
 try{
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl,$cancel.Token).GetAwaiter().GetResult()
  $json=@{id=1;method='Runtime.evaluate';params=@{expression=$expression;awaitPromise=$true;returnByValue=$true}}|ConvertTo-Json -Depth 6 -Compress
  $bytes=[Text.Encoding]::UTF8.GetBytes($json)
  $socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult()
  $buffer=New-Object byte[] 65536
  while($true){
   $message=[IO.MemoryStream]::new()
   try{
    do{$received=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult();if($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){throw 'Inspector closed before confirming test transport'};$message.Write($buffer,0,$received.Count)}while(!$received.EndOfMessage)
    $response=[Text.Encoding]::UTF8.GetString($message.ToArray())|ConvertFrom-Json
   }finally{$message.Dispose()}
   if($response.id -ne 1){continue}
   if($response.error -or $response.result.exceptionDetails){throw ('Cannot configure disposable update transport: '+($response|ConvertTo-Json -Depth 8 -Compress))}
   if($response.result.result.value.version -ne '__SYTER_FROM_VERSION__'){throw 'Installed updater version was not confirmed'}
   Write-Host 'PASS: actual __SYTER_FROM_VERSION__ publisher guard accepted unchanged GitHub config; process-local test transport attached'
   break
  }
 }finally{$socket.Dispose();$cancel.Dispose()}
}
