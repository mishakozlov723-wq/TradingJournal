// Native offline bootstrapper. Payload is embedded but never opened/copied
// before user consent. The journal and electron-updater remain unchanged.
using System;
using System.IO;
using System.Reflection;
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
  IntPtr p1,p2;
  public Fonts(){p1=Load("FontRegular",Regular);p2=Load("FontBold",Bold);}
  static IntPtr Load(string resource,PrivateFontCollection collection){
   using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)){
    byte[] data=new byte[stream.Length];stream.Read(data,0,data.Length);
    IntPtr p=Marshal.AllocHGlobal(data.Length);Marshal.Copy(data,0,p,data.Length);collection.AddMemoryFont(p,data.Length);return p;
   }
  }
  public Font Get(float size,bool bold=false){return new Font((bold?Bold:Regular).Families[0],size,FontStyle.Regular,GraphicsUnit.Pixel);}
  public void Dispose(){Regular.Dispose();Bold.Dispose();Marshal.FreeHGlobal(p1);Marshal.FreeHGlobal(p2);}
 }
 static class Shapes {
  public static GraphicsPath Round(RectangleF r,float radius){
   var p=new GraphicsPath();float d=radius*2;
   p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;
  }
 }
 sealed class BrandButton:Button {
  public bool CloseButton;
  public BrandButton(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;Cursor=Cursors.Hand;TabStop=true;}
  protected override void OnPaint(PaintEventArgs e){
   var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=TextRenderingHint.ClearTypeGridFit;
   if(CloseButton){using(var pen=new Pen(Enabled?Color.FromArgb(160,168,180):Color.FromArgb(80,84,90),1.5f)){float c=Width/2f,d=Width*5f/44f;g.DrawLine(pen,c-d,c-d,c+d,c+d);g.DrawLine(pen,c+d,c-d,c-d,c+d);}return;}
   using(var shape=Shapes.Round(new RectangleF(0,0,Width-1,Height-1),12))
   using(var brush=new LinearGradientBrush(ClientRectangle,Enabled?Color.FromArgb(78,230,171):Color.FromArgb(38,114,85),Enabled?Color.FromArgb(52,211,153):Color.FromArgb(27,100,76),45f))g.FillPath(brush,shape);
   using(var brush=new SolidBrush(Color.FromArgb(6,37,26)))
   using(var format=new StringFormat(){Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center})g.DrawString(Text,Font,brush,ClientRectangle,format);
   if(Focused&&Enabled){using(var p=new Pen(Color.White,1))using(var shape=Shapes.Round(new RectangleF(3,3,Width-7,Height-7),9))g.DrawPath(p,shape);}
  }
 }
 sealed class FileProgress:Control {
  public double Percent;public bool Finishing;int tick;
  public FileProgress(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);AccessibleRole=AccessibleRole.ProgressBar;AccessibleName="Installation file progress";}
  public void Pulse(){tick=(tick+1)%24;if(Finishing)Invalidate();}
  protected override void OnPaint(PaintEventArgs e){
   var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;
   using(var background=new SolidBrush(Color.FromArgb(34,39,51)))using(var shape=Shapes.Round(new RectangleF(0,0,Width,Height),2))g.FillPath(background,shape);
   float width=(float)(Width*Math.Min(100,Math.Max(0,Percent))/100);if(width<1)return;
   using(var shape=Shapes.Round(new RectangleF(0,0,width,Height),2)){
    if(Finishing){using(var brush=new LinearGradientBrush(new Rectangle(-Width+tick*Width/12,0,Width*2,Height),Color.FromArgb(52,211,153),Color.FromArgb(154,245,206),0f))g.FillPath(brush,shape);}
    else using(var brush=new SolidBrush(Color.FromArgb(52,211,153)))g.FillPath(brush,shape);
   }
  }
 }
 sealed class InstallerWindow:Form {
  static readonly Color Bg=Color.FromArgb(5,6,8),TextColor=Color.FromArgb(242,243,245),Dim=Color.FromArgb(160,168,180);
  readonly Fonts fonts=new Fonts();readonly Label title,subtitle,version,platform,stage,percent,transfer,location,error;
  readonly BrandButton primary,close;readonly FileProgress progress;
  readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
  bool busy,installed,retryLaunch,disposed;string temporary,payload,session,installedExe;
  long lastProcessed=-1,totalWork;float dpiScale=1f;string lastStage="";
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
   platform=Label("Windows · 64-bit",14,false,320,193,171,27);platform.ForeColor=Dim;platform.TextAlign=ContentAlignment.TopRight;
   stage=Label("",14,false,29,196,380,27);stage.Visible=false;
   percent=Label("",14,false,418,196,73,27);percent.TextAlign=ContentAlignment.TopRight;percent.Visible=false;
   progress=new FileProgress(){Left=29,Top=230,Width=462,Height=5,Visible=false};Controls.Add(progress);
   transfer=Label("",14,false,29,243,462,26);transfer.ForeColor=Dim;transfer.Visible=false;
   location=Label("",14,false,29,279,462,72);location.ForeColor=Dim;location.Visible=false;
   error=Label("",14,false,29,233,462,105);error.ForeColor=Color.FromArgb(252,165,165);error.Visible=false;
   title.Name="Title";stage.Name="Stage";percent.Name="Percent";transfer.Name="Transfer";location.Name="Location";
   primary=new BrandButton(){Name="PrimaryAction",Text="Install SYTER →",AccessibleName="Install SYTER",Left=29,Top=365,Width=462,Height=48,Font=fonts.Get(15,true),BackColor=Bg};Controls.Add(primary);primary.Click+=Primary;
   MouseDown+=Drag;
   FormClosing+=(s,e)=>{if(busy)e.Cancel=true;};
   KeyDown+=(s,e)=>{if(e.KeyCode==Keys.Escape&&!busy)Close();};
   timer.Interval=200;timer.Tick+=(s,e)=>{if(busy&&!String.IsNullOrEmpty(session))ReadProgress();progress.Pulse();};
   Shown+=(s,e)=>{primary.Focus();};
  }
  Label Label(string text,float size,bool bold,int x,int y,int width,int height){var l=new Label(){Text=text,Left=x,Top=y,Width=width,Height=height,BackColor=Bg,ForeColor=TextColor,Font=fonts.Get(size,bold),UseCompatibleTextRendering=true,AutoSize=false};Controls.Add(l);return l;}
  
  protected override void OnLoad(EventArgs e){
   MinimumSize=MaximumSize=Size.Empty;
   using(var g=CreateGraphics()){float factor=g.DpiX/96f;dpiScale=factor;if(Math.Abs(factor-1f)>0.01f){Scale(new SizeF(factor,factor));ClientSize=new Size((int)Math.Round(520*factor),(int)Math.Round(440*factor));}}
   MinimumSize=MaximumSize=Size;CenterToScreen();base.OnLoad(e);
  }

  void Drag(object sender,MouseEventArgs e){if(e.Button!=MouseButtons.Left||e.Y>58&&sender==this)return;ReleaseCapture();SendMessage(Handle,0xA1,(IntPtr)2,IntPtr.Zero);}
  protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var pen=new Pen(Color.FromArgb(35,38,40),1))e.Graphics.DrawRectangle(pen,0,0,ClientSize.Width-1,ClientSize.Height-1);}
  void Busy(string heading,string status){busy=true;close.Enabled=false;primary.Enabled=false;primary.Text="Please wait…";primary.AccessibleName="Please wait";title.Text=heading;subtitle.Visible=false;version.Top=(int)Math.Round(151*dpiScale);platform.Top=version.Top;stage.Text=status;stage.Visible=true;percent.Text="";percent.Visible=false;progress.Visible=false;transfer.Visible=false;location.Visible=false;error.Visible=false;}
  void Ready(){busy=false;installed=true;timer.Stop();title.Text="SYTER is installed.";subtitle.Text="Everything is ready. Open your journal.";subtitle.Visible=true;version.Top=(int)Math.Round(193*dpiScale);platform.Top=version.Top;stage.Visible=percent.Visible=progress.Visible=transfer.Visible=false;location.Top=(int)Math.Round(233*dpiScale);location.Text=Path.GetDirectoryName(installedExe);location.Visible=true;close.Enabled=true;primary.Enabled=true;primary.Text="Launch SYTER →";primary.AccessibleName="Launch SYTER";}
  void Failure(Exception ex){busy=false;timer.Stop();title.Text="Let’s try that again.";subtitle.Text="The same SYTER. A dedicated desktop app.";subtitle.Visible=true;version.Top=platform.Top=(int)Math.Round(193*dpiScale);stage.Visible=percent.Visible=progress.Visible=transfer.Visible=location.Visible=false;error.Text=retryLaunch?"SYTER was installed but could not open. Try launching it again.":"Installation could not finish. Close SYTER if it is running, then try again.";error.Visible=true;close.Enabled=primary.Enabled=true;primary.Text="Try again →";primary.AccessibleName="Try again";Debug.WriteLine(ex);}
  async void Primary(object sender,EventArgs e){
   if(busy)return;
   if(installed||retryLaunch){try{Busy("Opening SYTER…","Launch");Process.Start(new ProcessStartInfo(installedExe){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(installedExe)});busy=false;Close();}catch(Exception ex){retryLaunch=true;Failure(ex);}return;}
   try{
    Busy("Preparing SYTER…","Preparing and verifying installer");
    temporary=Path.Combine(Path.GetTempPath(),"syter-setup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temporary);payload=Path.Combine(temporary,"setup.exe");
    await Task.Run((Action)PreparePayload);
    session=Guid.NewGuid().ToString();lastProcessed=-1;lastStage="";
    Busy("Installing SYTER…","Preparing installation");timer.Start();
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
    stage.Text=finishing?"Registering SYTER and shortcuts":copied>0||raw=="copying"?"Installing files":"Unpacking files";
    double value=100.0*done/totalWork;percent.Text=Math.Floor(value)+"%";percent.Visible=true;
    progress.Percent=value;progress.Finishing=finishing;progress.Visible=true;progress.Invalidate();
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
