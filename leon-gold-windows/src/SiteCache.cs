using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace LeonGold
{
    /// The site's own files come from GitHub Pages, slow from Iran. Kept on the PC: hashed build files (/_next/static/)
    /// once; everything else is shown from the PC at once and its fresh copy fetched behind it for next time.
    /// The account and ledger data (api.leongold.net) never pass through here: always live.
    class SiteCache
    {
        readonly string dir;
        readonly ConcurrentDictionary<string, bool> refreshing = new ConcurrentDictionary<string, bool>();
        public SiteCache(string root) { dir = Path.Combine(root, "site-cache"); Directory.CreateDirectory(dir); }

        public static bool Cacheable(Uri u)
        {
            if (!Config.Ours(u)) return false;
            string p = u.AbsolutePath;
            return !p.Contains("/api/") && !p.EndsWith("/sw.js") && !p.EndsWith(".webmanifest") && !p.EndsWith(".json") && !p.EndsWith(".apk");
        }
        static bool Immutable(string path) => path.Contains("/_next/static/");
        static string Key(Uri u) => "https://" + u.Host + u.AbsolutePath;   // ?t=orders opens the same page
        string File_(string k)
        {
            using (var sha = SHA256.Create())
            {
                var d = sha.ComputeHash(Encoding.UTF8.GetBytes(k)); var s = new StringBuilder();
                for (int i = 0; i < 16; i++) s.Append(d[i].ToString("x2"));
                return Path.Combine(dir, s.ToString());
            }
        }

        /// the cached copy, or null; a page's refresh starts behind it
        public bool TryGet(Uri u, out string file, out string type)
        {
            string k = Key(u); file = File_(k); type = null;
            if (!File.Exists(file)) return false;
            type = File.Exists(file + ".type") ? File.ReadAllText(file + ".type") : "application/octet-stream";
            if (!Immutable(u.AbsolutePath)) RefreshLater(k, file);
            return true;
        }

        public Task<bool> FetchAsync(Uri u) { string k = Key(u); return Task.Run(() => Fetch(k, File_(k))); }

        void RefreshLater(string k, string file)
        {
            if (!refreshing.TryAdd(k, true)) return;
            Task.Run(() => { try { Fetch(k, file); } finally { bool _; refreshing.TryRemove(k, out _); } });
        }

        static bool Fetch(string k, string file)
        {
            try
            {
                var h = (HttpWebRequest)WebRequest.Create(k);
                h.Timeout = 20000; h.ReadWriteTimeout = 30000;
                h.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                using (var r = (HttpWebResponse)h.GetResponse())
                {
                    if (r.StatusCode != HttpStatusCode.OK) return false;
                    string tmp = file + ".part";
                    using (var s = r.GetResponseStream()) using (var w = File.Create(tmp)) s.CopyTo(w);
                    File.WriteAllText(file + ".type", string.IsNullOrEmpty(r.ContentType) ? "application/octet-stream" : r.ContentType);
                    if (File.Exists(file)) File.Delete(file);
                    File.Move(tmp, file);
                    return true;
                }
            }
            catch { return false; }
        }
    }
}
