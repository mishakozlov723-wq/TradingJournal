// Native offline bootstrapper. Payload is embedded but never opened/copied
// before user consent. The journal and electron-updater remain unchanged.
using System;
using System.IO;
using System.Reflection;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32;
[assembly: AssemblyTitle("SYTER Installer")]
[assembly: AssemblyProduct("SYTER")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
namespace SyterInstaller {
 static class Program {
  [STAThread] static void Main() {
   bool owner;
   string sid=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
   using(var mutex=new Mutex(true,"Local\\SYTER_Installer_"+sid,out owner)) {
    if(!owner)return;
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(true);
    Application.Run(new InstallerWindow());
   }
  }
 }
 sealed class Fonts : IDisposable {
  public readonly PrivateFontCollection Regular=new PrivateFontCollection(),Bold=new PrivateFontCollection();
  IntPtr p1,p2;readonly List<Font> ownedFonts=new List<Font>();
  public Fonts(){p1=Load("FontRegular",Regular);p2=Load("FontBold",Bold);}
  static IntPtr Load(string resource,PrivateFontCollection collection){
   using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)){
    byte[] data=new byte[stream.Length];stream.Read(data,0,data.Length);
    IntPtr p=Marshal.AllocHGlobal(data.Length);Marshal.Copy(data,0,p,data.Length);collection.AddMemoryFont(p,data.Length);return p;
   }
  }
  public Font Get(float size,bool bold=false){var font=new Font((bold?Bold:Regular).Families[0],size,FontStyle.Regular,GraphicsUnit.Pixel);ownedFonts.Add(font);return font;}
  public void Dispose(){foreach(var font in ownedFonts)font.Dispose();ownedFonts.Clear();Regular.Dispose();Bold.Dispose();Marshal.FreeHGlobal(p1);Marshal.FreeHGlobal(p2);}
 }
 static class Shapes {
  public static GraphicsPath Round(RectangleF r,float radius){
   var p=new GraphicsPath();float d=radius*2;
   p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;
  }
 }
 // Render glyphs at 3x target resolution and downsample for smooth grayscale edges.
 // Fonts and layout are sized for the final DPI; no low-resolution bitmap is enlarged.
 static class TextPaint {
  public static void Draw(Graphics target,string text,Font font,Color color,Rectangle area,bool centered=false,bool right=false){
   if(String.IsNullOrEmpty(text)||area.Width<=0||area.Height<=0)return;
   const int sample=3;
   using(var image=new Bitmap(area.Width*sample,area.Height*sample,System.Drawing.Imaging.PixelFormat.Format32bppPArgb))
   using(var g=Graphics.FromImage(image))using(var brush=new SolidBrush(color))using(var format=new StringFormat()){
    g.Clear(Color.Transparent);g.ScaleTransform(sample,sample);g.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
    format.Alignment=centered?StringAlignment.Center:right?StringAlignment.Far:StringAlignment.Near;
    format.LineAlignment=centered?StringAlignment.Center:StringAlignment.Near;
    g.DrawString(text,font,brush,new RectangleF(0,0,area.Width,area.Height),format);
    var state=target.Save();
    try{target.InterpolationMode=InterpolationMode.HighQualityBicubic;target.PixelOffsetMode=PixelOffsetMode.HighQuality;target.DrawImage(image,area,new Rectangle(0,0,image.Width,image.Height),GraphicsUnit.Pixel);}finally{target.Restore(state);}
   }
  }
 }
 sealed class BrandLabel:Label {
  public bool SoftChanges;readonly Stopwatch textReveal=Stopwatch.StartNew();
  protected override void OnTextChanged(EventArgs e){base.OnTextChanged(e);textReveal.Restart();Invalidate();}
  public void Pulse(){if(Visible&&SoftChanges&&textReveal.ElapsedMilliseconds<160)Invalidate();}
  public BrandLabel(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);}
  protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(BackColor);float opacity=SoftChanges?Math.Min(1f,textReveal.ElapsedMilliseconds/160f):1f;opacity=opacity*opacity*(3-2*opacity);TextPaint.Draw(e.Graphics,Text,Font,Color.FromArgb((int)(ForeColor.A*opacity),ForeColor),ClientRectangle,false,TextAlign==ContentAlignment.TopRight);}
 }
 sealed class BrandButton:Button {
  public bool CloseButton,KeyboardFocusVisible;
  public BrandButton(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);AccessibleRole=AccessibleRole.PushButton;FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;Cursor=Cursors.Hand;TabStop=true;}
  protected override void OnPaint(PaintEventArgs e){
   var g=e.Graphics;g.Clear(BackColor);g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
   if(CloseButton){using(var pen=new Pen(Enabled?Color.FromArgb(160,168,180):Color.FromArgb(80,84,90),1.5f)){float c=Width/2f,d=Width*5f/44f;g.DrawLine(pen,c-d,c-d,c+d,c+d);g.DrawLine(pen,c+d,c-d,c-d,c+d);}if(Focused&&Enabled&&KeyboardFocusVisible){using(var pen=new Pen(Color.White,1))g.DrawRectangle(pen,3,3,Width-7,Height-7);}return;}
   float scale=Font.Size/15f;
   using(var shape=Shapes.Round(new RectangleF(0,0,Width-1,Height-1),12*scale))
   using(var brush=new LinearGradientBrush(ClientRectangle,Enabled?Color.FromArgb(78,230,171):Color.FromArgb(38,114,85),Enabled?Color.FromArgb(52,211,153):Color.FromArgb(27,100,76),45f))g.FillPath(brush,shape);
   TextPaint.Draw(g,Text,Font,Color.FromArgb(6,37,26),ClientRectangle,true);
   if(Focused&&Enabled&&KeyboardFocusVisible){using(var p=new Pen(Color.White,1))using(var shape=Shapes.Round(new RectangleF(3*scale,3*scale,Width-7*scale,Height-7*scale),9*scale))g.DrawPath(p,shape);}
  }
 }
 sealed class FileProgress:Control {
  public double Percent;public bool Finishing,Indeterminate;
  readonly Stopwatch clock=Stopwatch.StartNew(),reveal=Stopwatch.StartNew();readonly bool animate;
  public bool MotionEnabled {get{return animate;}}
  [DllImport("user32.dll")]static extern bool SystemParametersInfo(uint action,uint param,out bool value,uint flags);
  public FileProgress(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);AccessibleRole=AccessibleRole.ProgressBar;AccessibleName="Installation file progress";bool enabled;animate=!SystemParametersInfo(0x1042,0,out enabled,0)||enabled;}
  public void Waiting(bool value){if(Indeterminate==value)return;Indeterminate=value;AccessibleName=value?"Preparing installation":"Installation file progress";AccessibilityNotifyClients(AccessibleEvents.NameChange,-1);}
  protected override void OnVisibleChanged(EventArgs e){base.OnVisibleChanged(e);if(Visible){reveal.Restart();AccessibilityNotifyClients(AccessibleEvents.Show,-1);}}
  public void Pulse(){if(Visible&&animate&&(Indeterminate||Finishing||reveal.ElapsedMilliseconds<180))Invalidate();}
  protected override void OnPaint(PaintEventArgs e){
   e.Graphics.Clear(BackColor);
   float opacity=animate?Math.Min(1f,reveal.ElapsedMilliseconds/180f):1f;opacity=opacity*opacity*(3-2*opacity);
   if(opacity>=1f){DrawBar(e.Graphics);return;}
   using(var image=new Bitmap(Width,Height))using(var layer=Graphics.FromImage(image))using(var attributes=new System.Drawing.Imaging.ImageAttributes()){
    DrawBar(layer);var matrix=new System.Drawing.Imaging.ColorMatrix();matrix.Matrix33=opacity;attributes.SetColorMatrix(matrix);
    e.Graphics.DrawImage(image,ClientRectangle,0,0,Width,Height,GraphicsUnit.Pixel,attributes);
   }
  }
  void DrawBar(Graphics g){
   g.SmoothingMode=SmoothingMode.AntiAlias;
   float radius=Height/2f;
   using(var background=new SolidBrush(Color.FromArgb(34,39,51)))using(var shape=Shapes.Round(new RectangleF(0,0,Width,Height),radius))g.FillPath(background,shape);
   // Unknown duration is a moving highlight, never a pretend percentage.
   float width=Indeterminate?Width:(float)(Width*Math.Min(100,Math.Max(0,Percent))/100);if(width<1)return;
   using(var shape=Shapes.Round(new RectangleF(0,0,width,Height),Math.Min(radius,width/2f))){
    if(Indeterminate||Finishing){
     float phase=animate?(float)(clock.Elapsed.TotalSeconds%1.6/1.6):0.5f;
     using(var brush=new LinearGradientBrush(new RectangleF(-Width+phase*Width*2,0,Width*2,Height),Color.FromArgb(27,134,98),Color.FromArgb(27,134,98),0f)){
      brush.InterpolationColors=new ColorBlend(){Colors=new[]{Color.FromArgb(27,134,98),Color.FromArgb(52,211,153),Color.FromArgb(170,248,213),Color.FromArgb(52,211,153),Color.FromArgb(27,134,98)},Positions=new[]{0f,0.3f,0.5f,0.7f,1f}};
      g.FillPath(brush,shape);
     }
    }else using(var brush=new SolidBrush(Color.FromArgb(52,211,153)))g.FillPath(brush,shape);
   }
  }
 }

 sealed class InstallerWindow:Form {
  static readonly Color Bg=Color.FromArgb(5,6,8),TextColor=Color.FromArgb(242,243,245),Dim=Color.FromArgb(160,168,180);
  const float LayoutScale=600f/520f;
  readonly Dictionary<Control,Tuple<float,bool>> typeSizes=new Dictionary<Control,Tuple<float,bool>>();
  readonly Fonts fonts=new Fonts();readonly Label title,subtitle,version,platform,stage,percent,transfer,location,error;
  readonly BrandButton primary,close;readonly FileProgress progress;
  readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
  bool busy,installed,retryLaunch,disposed;string temporary,payload,session,installedExe;
  long lastProcessed=-1,totalWork;float dpiScale=1f;int pollTick;string lastStage="";
  [DllImport("user32.dll")]static extern bool ReleaseCapture();
  [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,IntPtr l);
  public InstallerWindow(){
   Text="SYTER Installer";FormBorderStyle=FormBorderStyle.None;ClientSize=new Size(520,440);MinimumSize=Size;MaximumSize=Size;
   Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);AutoScaleMode=AutoScaleMode.None;StartPosition=FormStartPosition.CenterScreen;BackColor=Bg;DoubleBuffered=true;KeyPreview=true;
   using(var icon=Assembly.GetExecutingAssembly().GetManifestResourceStream("Logo")){
    var picture=new PictureBox(){Left=25,Top=17,Width=26,Height=26,SizeMode=PictureBoxSizeMode.Zoom,Image=new Bitmap(Image.FromStream(icon)),BackColor=Bg};Controls.Add(picture);picture.MouseDown+=Drag;
   }
   var word=Label("S Y T E R",15, true,57,17,160,30);word.MouseDown+=Drag;
   close=new BrandButton(){Name="CloseAction",CloseButton=true,Text="Close",AccessibleName="Close",Left=456,Top=7,Width=44,Height=44,BackColor=Bg};Controls.Add(close);close.Click+=(s,e)=>Close();
   var eyebrow=Label("DESKTOP INSTALLER",14,false,29,78,360,23);eyebrow.ForeColor=Dim;
   title=Label("Your journal, on desktop.",28,true,28,108,464,42);
   subtitle=Label("The same SYTER. A dedicated desktop app.",15,false,29,152,462,34);subtitle.ForeColor=Dim;
   version=Label("Version  "+BuildInfo.Version,14,false,29,193,240,27);version.ForeColor=Dim;
   platform=Label("Windows",14,false,320,193,171,27);platform.ForeColor=Dim;platform.TextAlign=ContentAlignment.TopRight;
   stage=Label("",14,false,29,196,380,27);stage.Visible=false;
   percent=Label("",14,false,418,196,73,27);percent.TextAlign=ContentAlignment.TopRight;percent.Visible=false;
   progress=new FileProgress(){Left=29,Top=230,Width=462,Height=5,Visible=false};Controls.Add(progress);((BrandLabel)stage).SoftChanges=progress.MotionEnabled;
   transfer=Label("",14,false,29,243,462,26);transfer.ForeColor=Dim;transfer.Visible=false;
   location=Label("",14,false,29,279,462,72);location.ForeColor=Dim;location.Visible=false;
   error=Label("",14,false,29,233,462,105);error.ForeColor=Color.FromArgb(252,165,165);error.Visible=false;
   title.Name="Title";stage.Name="Stage";percent.Name="Percent";transfer.Name="Transfer";location.Name="Location";
   primary=new BrandButton(){Name="PrimaryAction",Text="Install SYTER →",AccessibleName="Install SYTER",Left=29,Top=365,Width=462,Height=48,Font=fonts.Get(15,true),BackColor=Bg};Controls.Add(primary);typeSizes.Add(primary,Tuple.Create(15f,true));primary.Click+=Primary;
   primary.GotFocus+=(s,e)=>primary.Invalidate();primary.LostFocus+=(s,e)=>primary.Invalidate();
   close.GotFocus+=(s,e)=>close.Invalidate();close.LostFocus+=(s,e)=>close.Invalidate();
   primary.MouseDown+=(s,e)=>SetKeyboardFocus(false);close.MouseDown+=(s,e)=>SetKeyboardFocus(false);
   MouseDown+=Drag;
   FormClosing+=(s,e)=>{if(busy)e.Cancel=true;};
   KeyDown+=(s,e)=>{if(e.KeyCode==Keys.Escape&&!busy)Close();};
   timer.Interval=20;timer.Tick+=(s,e)=>{if(++pollTick%10==0&&busy&&!String.IsNullOrEmpty(session))ReadProgress();progress.Pulse();((BrandLabel)stage).Pulse();};
   Shown+=(s,e)=>{SetKeyboardFocus(false);primary.Focus();};
  }
  Label Label(string text,float size,bool bold,int x,int y,int width,int height){var l=new BrandLabel(){Text=text,Left=x,Top=y,Width=width,Height=height,BackColor=Bg,ForeColor=TextColor,Font=fonts.Get(size,bold),UseCompatibleTextRendering=true,AutoSize=false,AccessibleRole=AccessibleRole.StaticText};Controls.Add(l);typeSizes.Add(l,Tuple.Create(size,bold));return l;}
  
  void SetKeyboardFocus(bool visible){primary.KeyboardFocusVisible=close.KeyboardFocusVisible=visible;primary.Invalidate();close.Invalidate();}
  protected override bool ProcessDialogKey(Keys keyData){if((keyData&Keys.KeyCode)==Keys.Tab)SetKeyboardFocus(true);return base.ProcessDialogKey(keyData);}
  protected override void OnLoad(EventArgs e){
   using(var g=CreateGraphics())ApplyLayout(g.DpiX/96f);
   base.OnLoad(e);
  }
  void ApplyLayout(float displayScale){
   MinimumSize=MaximumSize=Size.Empty;
   float factor=displayScale*LayoutScale,difference=factor/dpiScale;
   Scale(new SizeF(difference,difference));dpiScale=factor;
   // Keep fonts alive until controls have been disposed: native paint caches can still reference the old size.
   foreach(var entry in typeSizes)entry.Key.Font=fonts.Get(entry.Value.Item1*factor,entry.Value.Item2);
   ClientSize=new Size((int)Math.Round(520*factor),(int)Math.Round(440*factor));
   MinimumSize=MaximumSize=Size;CenterToScreen();
  }

  void Drag(object sender,MouseEventArgs e){if(e.Button!=MouseButtons.Left||e.Y>58&&sender==this)return;ReleaseCapture();SendMessage(Handle,0xA1,(IntPtr)2,IntPtr.Zero);}
  protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var pen=new Pen(Color.FromArgb(35,38,40),1))e.Graphics.DrawRectangle(pen,0,0,ClientSize.Width-1,ClientSize.Height-1);}
  void Busy(string heading,string status,bool waiting=false){SuspendLayout();busy=true;close.Enabled=false;primary.Enabled=false;primary.Text="Please wait…";primary.AccessibleName="Please wait";title.Text=heading;subtitle.Visible=false;version.Top=(int)Math.Round(151*dpiScale);platform.Top=version.Top;stage.Text=waiting?"Preparing installation…":status;stage.Visible=true;percent.Text="";percent.Visible=false;progress.Waiting(waiting);progress.Finishing=false;progress.Percent=0;progress.AccessibleName=waiting?"Preparing installation":"Installation file progress";progress.Visible=waiting;if(waiting){timer.Start();progress.Invalidate();}transfer.Visible=false;location.Visible=false;error.Visible=false;ResumeLayout(false);RefreshState();}
  void RefreshState(){Invalidate(true);Update();}
  void Launching(){
   SuspendLayout();busy=true;timer.Stop();close.Enabled=primary.Enabled=false;
   title.Text="Opening SYTER…";subtitle.Text="Your journal is opening.";subtitle.Visible=true;
   primary.Text="Please wait…";primary.AccessibleName="Please wait";
   stage.Visible=percent.Visible=progress.Visible=transfer.Visible=error.Visible=false;
   // Keep version, platform and path at their finished-screen positions: no moving child windows or stale copies.
   ResumeLayout(false);RefreshState();
  }
  void Ready(){busy=false;installed=true;timer.Stop();title.Text="SYTER is installed.";subtitle.Text="Everything is ready. Open your journal.";subtitle.Visible=true;version.Top=(int)Math.Round(193*dpiScale);platform.Top=version.Top;stage.Visible=percent.Visible=progress.Visible=transfer.Visible=false;location.Top=(int)Math.Round(233*dpiScale);location.Text=Path.GetDirectoryName(installedExe);location.Visible=true;close.Enabled=true;primary.Enabled=true;primary.Text="Launch SYTER →";primary.AccessibleName="Launch SYTER";RefreshState();}
  void Failure(Exception ex){busy=false;timer.Stop();title.Text="Let’s try that again.";subtitle.Text="The same SYTER. A dedicated desktop app.";subtitle.Visible=true;version.Top=platform.Top=(int)Math.Round(193*dpiScale);stage.Visible=percent.Visible=progress.Visible=transfer.Visible=location.Visible=false;error.Text=retryLaunch?"SYTER was installed but could not open. Try launching it again.":"Installation could not finish. Close SYTER if it is running, then try again.";error.Visible=true;close.Enabled=primary.Enabled=true;primary.Text="Try again →";primary.AccessibleName="Try again";Debug.WriteLine(ex);RefreshState();}
  async void Primary(object sender,EventArgs e){
   if(busy)return;
   if(installed||retryLaunch){try{Launching();await Task.Run((Action)(()=>{Process.Start(new ProcessStartInfo(installedExe){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(installedExe)});}));busy=false;Close();}catch(Exception ex){retryLaunch=true;Failure(ex);}return;}
   try{
    session=null;Busy("Installing SYTER…","",true);
    temporary=Path.Combine(Path.GetTempPath(),"syter-setup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temporary);payload=Path.Combine(temporary,"setup.exe");
    await Task.Run((Action)PreparePayload);
    session=Guid.NewGuid().ToString();lastProcessed=-1;lastStage="";
    Busy("Installing SYTER…","",true);
    using(var child=Process.Start(new ProcessStartInfo(payload,"/S --syter-session="+session){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden})){
     await Task.Run((Action)(()=>child.WaitForExit()));ReadProgress();if(child.ExitCode!=0)throw new IOException("Installation exit "+child.ExitCode);
    }
    installedExe=InstalledExecutable();Ready();Cleanup();
   }catch(Exception ex){Failure(ex);Cleanup();}
  }
  void PreparePayload(){
   using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload"))
   using(var output=new FileStream(payload,FileMode.CreateNew,FileAccess.Write,FileShare.None,262144))
   using(var hash=SHA256.Create()){
    byte[] buffer=new byte[262144];int count;long total=0;
    while((count=input.Read(buffer,0,buffer.Length))>0){hash.TransformBlock(buffer,0,count,null,0);output.Write(buffer,0,count);total+=count;}
    hash.TransformFinalBlock(new byte[0],0,0);string digest=BitConverter.ToString(hash.Hash).Replace("-","").ToLowerInvariant();
    if(total!=BuildInfo.PayloadSize||digest!=BuildInfo.Sha256)throw new IOException("Installer verification failed");
   }
  }
  void ReadProgress(){
   try{using(var root=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64))using(var key=root.OpenSubKey(@"Software\SYTER\Installer")){
    if(key==null||Convert.ToString(key.GetValue("Session"))!=session)return;
    long total,extracted,copied;
    if(!Int64.TryParse(Convert.ToString(key.GetValue("Total")),out total)||!Int64.TryParse(Convert.ToString(key.GetValue("Extracted")),out extracted)||!Int64.TryParse(Convert.ToString(key.GetValue("Copied")),out copied))return;
    if(total<=0||total>1073741823||extracted<0||copied<0||extracted>total||copied>total)return;
    string raw=Convert.ToString(key.GetValue("Stage"));long done=extracted+copied;totalWork=total*2;
    bool finishing=raw=="finalizing"||raw=="installed";
    if(lastProcessed==done&&lastStage==raw)return;lastProcessed=done;lastStage=raw;
    title.Text=finishing?"Finishing setup…":"Installing SYTER…";
    stage.Visible=true;stage.Text=finishing?"Registering SYTER and shortcuts":copied>0||raw=="copying"?"Installing files":"Unpacking files";
    double value=100.0*done/totalWork;percent.Text=Math.Floor(value)+"%";percent.Visible=true;
    progress.Waiting(false);progress.AccessibleName="Installation file progress";progress.Percent=value;progress.Finishing=finishing;progress.Visible=true;progress.Invalidate();
    transfer.Text=(done/1048576.0).ToString("F1")+" / "+(totalWork/1048576.0).ToString("F1")+" MB processed";transfer.Visible=true;
    location.Top=(int)Math.Round(279*dpiScale);location.Text=Convert.ToString(key.GetValue("Location"));location.Visible=!String.IsNullOrEmpty(location.Text);
   }}catch(IOException){}catch(System.Security.SecurityException){}
  }
  string InstalledExecutable(){using(var root=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64))using(var key=root.OpenSubKey(@"Software\SYTER\Desktop")){
   if(key==null||Convert.ToString(key.GetValue("Version"))!=BuildInfo.Version)throw new IOException("Installed version could not be verified");
   string directory=Convert.ToString(key.GetValue("InstallLocation"));
   if(String.IsNullOrEmpty(directory)||!Path.IsPathRooted(directory)||directory.StartsWith(@"\\"))throw new IOException("Invalid install location");
   string exe=Path.Combine(directory,"SYTER.exe");if(!File.Exists(exe))throw new IOException("Installed application missing");return exe;
  }}
  void Cleanup(){if(String.IsNullOrEmpty(temporary))return;try{Directory.Delete(temporary,true);temporary=null;}catch(IOException){}catch(UnauthorizedAccessException){}}
  protected override void Dispose(bool disposing){if(disposing&&!disposed){disposed=true;timer.Stop();timer.Dispose();Cleanup();base.Dispose(disposing);fonts.Dispose();return;}base.Dispose(disposing);}
 }
}
