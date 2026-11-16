using System;
using System.IO;

namespace LeonGold
{
    /// The two apps differ only here (APP is set by the build: LEDGER or HESAB)
    class Config
    {
        public string Title, Start, Folder;
        public bool Inbox, Tray;
        public const string Version = "1.1";
        public static readonly string[] Hosts = { "leon-gold.github.io", "leongold.net", "www.leongold.net" };
        public static string DataRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LeonGold");
#if HESAB
        public static readonly Config Current = new Config {
            Title = "حساب من · لئون گلد", Start = "https://leongold.net/hesab/", Folder = "Hesab",
            Inbox = true, Tray = true };
#else
        public static readonly Config Current = new Config {
            Title = "دفتر لئون گلد", Start = "https://leon-gold.github.io/leon-gold-app/", Folder = "Ledger",
            Inbox = false, Tray = false };
#endif
        public string Data => Path.Combine(DataRoot, Folder);

        public static bool Ours(Uri u)
        {
            if (u == null || u.Scheme != "https") return false;
            foreach (var h in Hosts) if (u.Host.Equals(h, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }
    }
}
