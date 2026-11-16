using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace LeonGold
{
    /// «حساب من» notifications without Web Push (WebView2 has none): the app registers with the party's session and
    /// fetches its inbox from the server (notify.mjs: /api/portal/push/app, /inbox). Same as the Android app.
    class Inbox
    {
        const string API = "https://api.leongold.net";
        readonly string stateFile;
        string token = "", dev = ""; long last;
        public Inbox(string root)
        {
            stateFile = Path.Combine(root, "inbox.txt");
            try { var l = File.ReadAllLines(stateFile); dev = l[0]; token = l[1]; last = long.Parse(l[2]); } catch { }
            if (dev.Length == 0) { dev = Guid.NewGuid().ToString(); Save(); }
        }
        void Save() { try { File.WriteAllLines(stateFile, new[] { dev, token, last.ToString() }); } catch { } }

        /// the page's session changed (sign in / sign out); runs off the UI thread
        public void Session(string t)
        {
            t = (t ?? "").Trim(); if (t.Length > 200) return;
            lock (this)
            {
                if (t == token) return;
                if (token.Length > 0) Call("POST", "/api/portal/push/app/off", token, "{\"dev\":\"" + dev + "\"}");
                if (t.Length == 0) { token = ""; last = 0; Save(); return; }
                string r = Call("POST", "/api/portal/push/app", t, "{\"dev\":\"" + dev + "\"}");
                if (r != null && r.Contains("\"ok\":true")) { token = t; last = Num(r, "last"); Save(); }
            }
        }

        public class Msg { public long Id; public string Title, Body, Url; }

        /// what came after the last shown message (oldest first)
        public Msg[] Poll()
        {
            lock (this)
            {
                if (token.Length == 0) return new Msg[0];
                string r;
                try { r = Call("GET", "/api/portal/push/inbox?after=" + last, token, null, true); }
                catch (UnauthorizedAccessException) { token = ""; Save(); return new Msg[0]; }
                if (r == null) return new Msg[0];
                var list = new System.Collections.Generic.List<Msg>();
                foreach (Match m in Regex.Matches(r, "\\{\"id\":(\\d+),\"title\":(\"(?:[^\"\\\\]|\\\\.)*\"),\"body\":(\"(?:[^\"\\\\]|\\\\.)*\"),\"url\":(\"(?:[^\"\\\\]|\\\\.)*\")\\}"))
                    list.Add(new Msg { Id = long.Parse(m.Groups[1].Value), Title = Str(m.Groups[2].Value), Body = Str(m.Groups[3].Value), Url = Str(m.Groups[4].Value) });
                long l2 = Num(r, "last"); if (l2 > last) { last = l2; Save(); }
                return list.ToArray();
            }
        }

        static long Num(string json, string key) { var m = Regex.Match(json, "\"" + key + "\":(\\d+)"); return m.Success ? long.Parse(m.Groups[1].Value) : 0; }
        static string Str(string q) => Regex.Unescape(q.Substring(1, q.Length - 2));

        static string Call(string method, string path, string tok, string body, bool throw401 = false)
        {
            try
            {
                var h = (HttpWebRequest)WebRequest.Create(API + path);
                h.Method = method; h.Timeout = 20000; h.Headers["Authorization"] = "Bearer " + tok;
                if (body != null)
                {
                    var b = Encoding.UTF8.GetBytes(body); h.ContentType = "application/json"; h.ContentLength = b.Length;
                    using (var s = h.GetRequestStream()) s.Write(b, 0, b.Length);
                }
                using (var r = (HttpWebResponse)h.GetResponse())
                using (var rd = new StreamReader(r.GetResponseStream(), Encoding.UTF8)) return rd.ReadToEnd();
            }
            catch (WebException e) when (throw401 && e.Response is HttpWebResponse x && x.StatusCode == HttpStatusCode.Unauthorized)
            { throw new UnauthorizedAccessException(); }
            catch { return null; }
        }
    }
}
