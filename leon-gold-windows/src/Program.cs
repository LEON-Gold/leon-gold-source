using System;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace LeonGold
{
    // One exe, nothing to install: the WebView2 libraries ride inside it as resources and are loaded from there;
    // the browser engine itself is Windows' own Edge WebView2 (already on Windows 10/11).
    static class Program
    {
        [STAThread]
        static void Main()
        {
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                string name = new AssemblyName(e.Name).Name + ".dll";
                using (var r = Assembly.GetExecutingAssembly().GetManifestResourceStream("lib." + name))
                {
                    if (r == null) return null;
                    var b = new byte[r.Length]; r.Read(b, 0, b.Length); return Assembly.Load(b);
                }
            };
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Run();
        }

        // kept apart so no WebView2 type is touched before the resolver above is in place
        static void Run()
        {
            Application.Run(new Shell(Config.Current));
        }

        /// the native loader for this machine's CPU, written next to the app's data once per version
        public static string LoaderFolder()
        {
            string arch = Environment.Is64BitProcess ? (IsArm() ? "arm64" : "x64") : "x86";
            string dir = Path.Combine(Config.DataRoot, "bin", Config.Version, arch);
            string file = Path.Combine(dir, "WebView2Loader.dll");
            if (!File.Exists(file))
            {
                Directory.CreateDirectory(dir);
                using (var r = Assembly.GetExecutingAssembly().GetManifestResourceStream("native." + arch + ".WebView2Loader.dll"))
                using (var w = File.Create(file)) r.CopyTo(w);
            }
            return dir;
        }
        static bool IsArm()
        {
            string a = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "";
            string b = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? "";
            return a.ToUpper().Contains("ARM") || b.ToUpper().Contains("ARM");
        }
    }
}
