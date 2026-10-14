param([int]$X,[int]$Y,[int]$Width,[int]$Height,[string]$Directory)
# Isolated CI desktop only. Capture continuously, without slow per-stage
# PowerShell launches that would accidentally let a native show-fade finish.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
public class SyterFilm {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  public static void Record(int x,int y,int width,int height,string dir) {
    SetProcessDPIAware();
    var frames=new List<Bitmap>(); var times=new List<long>();
    File.WriteAllText(Path.Combine(dir,"ready"),"ready");
    try {
      while(!File.Exists(Path.Combine(dir,"stop")) && frames.Count<360) {
        long started=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        DwmFlush();
        var bitmap=new Bitmap(width,height,PixelFormat.Format24bppRgb);
        using(var graphics=Graphics.FromImage(bitmap))
          graphics.CopyFromScreen(x,y,0,0,bitmap.Size,CopyPixelOperation.SourceCopy);
        frames.Add(bitmap); times.Add(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        int sleep=(int)(16-(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-started));
        if(sleep>0) Thread.Sleep(sleep);
      }
      for(int i=0;i<frames.Count;i++)
        frames[i].Save(Path.Combine(dir,String.Format("frame-{0:D3}.png",i)),ImageFormat.Png);
      File.WriteAllText(Path.Combine(dir,"times.json"),"["+String.Join(",",times)+"]");
    } finally { foreach(var frame in frames)frame.Dispose(); }
  }
}
'@
[SyterFilm]::Record($X,$Y,$Width,$Height,$Directory)