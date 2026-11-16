using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LeonGold
{
    /// The window: the page full size in Windows' own WebView2; its own data folder (sign-in and the ledger's offline
    /// data live there); other sites open in the default browser; site files from the PC (SiteCache).
    class Shell : Form
    {
        readonly Config cfg;
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        readonly Panel offline = new Panel { Dock = DockStyle.Fill, Visible = false };
        readonly SiteCache cache;
        Inbox inbox;
        NotifyIcon tray;
        bool quitting, loading = true;
        static readonly Color Bg = Color.FromArgb(0x0c, 0x1d, 0x15), Gold = Color.FromArgb(0xd8, 0xb4, 0x6a), Ivory = Color.FromArgb(0xe8, 0xd9, 0xb0);

        public Shell(Config c)
        {
            cfg = c; cache = new SiteCache(c.Data);
            Text = c.Title; BackColor = Bg; RightToLeft = RightToLeft.Yes; RightToLeftLayout = true;
            Icon = new Icon(Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico"));
            StartPosition = FormStartPosition.CenterScreen; MinimumSize = new Size(420, 560);
            var wa = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(1280, wa.Width * 9 / 10), Math.Min(860, wa.Height * 9 / 10));
            web.DefaultBackgroundColor = Bg;
            BuildOffline();
            Controls.Add(web); Controls.Add(offline);
            if (c.Tray) SetupTray();
            Load += async (s, e) => await Start();
        }

        async Task Start()
        {
            try
            {
                CoreWebView2Environment.SetLoaderDllFolderPath(Program.LoaderFolder());
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(cfg.Data, "WebView2"),
                    new CoreWebView2EnvironmentOptions { Language = "fa" });
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                if (MessageBox.Show("برای اجرای برنامه، «Microsoft Edge WebView2» لازم است (روی ویندوز ۱۰ و ۱۱ معمولاً هست).\nصفحه‌ی دانلودش باز شود؟\n\n" + ex.Message,
                        cfg.Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button1, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign) == DialogResult.Yes)
                    Open("https://developer.microsoft.com/microsoft-edge/webview2/");
                quitting = true; Close(); return;
            }
            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.UserAgent = core.Settings.UserAgent + " LeonGoldApp/" + Config.Version + " Windows";

            // our pages stay inside, everything else goes to the default browser
            core.NavigationStarting += (s, e) =>
            {
                Uri u; if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out u)) return;
                if (Config.Ours(u) || u.Scheme == "about" || u.Scheme == "data" || u.Scheme == "blob") return;
                e.Cancel = true; Open(e.Uri);
            };
            core.NewWindowRequested += (s, e) =>
            {
                Uri u; Uri.TryCreate(e.Uri, UriKind.Absolute, out u);
                e.Handled = true;
                if (u != null && Config.Ours(u)) core.Navigate(e.Uri);   // same window
                else if (u != null) Open(e.Uri);
            };
            core.NavigationStarting += (s, e) => loading = true;
            core.NavigationCompleted += (s, e) =>
            {
                loading = false;
                if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled) offline.Visible = true;
            };

            // site files from the PC; page and service-worker requests alike
            foreach (var pat in new[] { "https://leon-gold.github.io/*", "https://leongold.net/*" })
            {
                // service-worker requests too where the WebView2 on this PC can (newer versions); else page requests only
                try { core.AddWebResourceRequestedFilter(pat, CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All); }
                catch { core.AddWebResourceRequestedFilter(pat, CoreWebView2WebResourceContext.All); }
            }
            core.WebResourceRequested += OnRequest;

            if (cfg.Inbox) StartInbox();
            core.Navigate(cfg.Start);
        }

        void OnRequest(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            Uri u; if (e.Request.Method != "GET" || !Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out u) || !SiteCache.Cacheable(u)) return;
            string file, type;
            if (cache.TryGet(u, out file, out type)) { e.Response = Respond(file, type); return; }
            var d = e.GetDeferral();
            cache.FetchAsync(u).ContinueWith(t => BeginInvoke((Action)(() =>
            {
                try { if (t.Result && cache.TryGet(u, out file, out type)) e.Response = Respond(file, type); }
                catch { }
                finally { d.Complete(); }
            })));
        }

        CoreWebView2WebResourceResponse Respond(string file, string type)
        {
            var s = new MemoryStream(File.ReadAllBytes(file));
            return web.CoreWebView2.Environment.CreateWebResourceResponse(s, 200, "OK",
                "Content-Type: " + type + "\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *");
        }

        // ---------- «حساب من»: notifications ----------
        void StartInbox()
        {
            inbox = new Inbox(cfg.Data);
            string seen = null;
            var watch = new Timer { Interval = 3000 };
            watch.Tick += async (s, e) =>
            {
                // only a settled page answers: while one loads, its storage reads as empty, which is not a sign-out
                if (web.CoreWebView2 == null || loading) return;
                Uri u; if (!Uri.TryCreate(web.CoreWebView2.Source, UriKind.Absolute, out u) || !Config.Ours(u)) return;
                string tok;
                try { tok = await web.CoreWebView2.ExecuteScriptAsync("(function(){try{return localStorage.getItem('leon-hesab')||''}catch(e){return null}})()"); }
                catch { return; }
                if (loading || tok == null || tok == "null" || !tok.StartsWith("\"")) return;
                tok = tok.Trim('"');
                if (tok == seen) return; seen = tok;
                await Task.Run(() => inbox.Session(tok));
            };
            watch.Start();
            var poll = new Timer { Interval = 5 * 60 * 1000 };
            poll.Tick += async (s, e) => await PollNow();
            poll.Start();
            Shown += async (s, e) => { await Task.Delay(8000); await PollNow(); };
        }

        string lastUrl;
        async Task PollNow()
        {
            var list = await Task.Run(() => inbox.Poll());
            if (list.Length == 0 || tray == null) return;
            var m = list[list.Length - 1];
            lastUrl = m.Url;
            tray.BalloonTipTitle = list.Length == 1 ? m.Title : "لئون گلد";
            tray.BalloonTipText = list.Length == 1 ? m.Body : string.Join("؛ ", list.Select(x => x.Title));
            tray.ShowBalloonTip(10000);
        }

        void SetupTray()
        {
            tray = new NotifyIcon { Icon = Icon, Text = cfg.Title, Visible = true };
            var menu = new ContextMenuStrip { RightToLeft = RightToLeft.Yes };
            menu.Items.Add("باز کردن", null, (s, e) => ShowMe(null));
            menu.Items.Add("خروج", null, (s, e) => { quitting = true; tray.Visible = false; Close(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => ShowMe(null);
            tray.BalloonTipClicked += (s, e) => ShowMe(lastUrl);
            // closing the window keeps it beside the clock, so notifications still come; «خروج» from there ends it
            FormClosing += (s, e) =>
            {
                if (quitting || e.CloseReason != CloseReason.UserClosing) { tray.Visible = false; return; }
                e.Cancel = true; Hide();
                tray.BalloonTipTitle = cfg.Title; tray.BalloonTipText = "برنامه کنار ساعت باز می‌ماند تا اعلان‌ها برسد. برای بستن کامل: راست‌کلیک ← خروج.";
                if (!hinted) { tray.ShowBalloonTip(6000); hinted = true; }
            };
        }
        bool hinted;

        void ShowMe(string url)
        {
            Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate();
            if (url == null || web.CoreWebView2 == null) return;
            Uri u; if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return;
            // always the app's own address (its session lives there), with only the section the message points to
            var q = System.Web.HttpUtility.ParseQueryString(u.Query)["t"];
            web.CoreWebView2.Navigate(q != null && System.Text.RegularExpressions.Regex.IsMatch(q, "^[a-z]{1,20}$") ? cfg.Start + "?t=" + q : cfg.Start);
        }

        // ---------- no internet ----------
        void BuildOffline()
        {
            offline.BackColor = Bg;
            var t = new Label { Text = "اینترنت وصل نیست. دوباره امتحان کن.", ForeColor = Ivory, Font = new Font("Segoe UI", 13f),
                AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Dock = DockStyle.Top, Height = 60, RightToLeft = RightToLeft.Yes };
            var b = new Button { Text = "تلاش دوباره", BackColor = Gold, ForeColor = Color.FromArgb(0x1a, 0x14, 0x0a), FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 11f, FontStyle.Bold), Size = new Size(180, 46), RightToLeft = RightToLeft.Yes };
            b.FlatAppearance.BorderSize = 0;
            b.Click += (s, e) => { offline.Visible = false; web.CoreWebView2?.Reload(); };
            var box = new Panel { Size = new Size(420, 130), BackColor = Bg };
            box.Controls.Add(t); b.Location = new Point((420 - 180) / 2, 70); box.Controls.Add(b);
            offline.Controls.Add(box);
            offline.Resize += (s, e) => box.Location = new Point((offline.Width - box.Width) / 2, (offline.Height - box.Height) / 2);
        }

        static void Open(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }
    }
}
