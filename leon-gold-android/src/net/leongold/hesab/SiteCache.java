package net.leongold.hesab;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/**
 * The site's own files (pages, scripts, styles, fonts, pictures) come from GitHub Pages, far and slow from Iran.
 * The app keeps them on the phone: hashed build files (/_next/static/) never change, so once is enough; a page is shown
 * from the phone at once and its fresh copy is fetched behind it for next time. A first copy ships inside the APK
 * (assets/site/, made by prefetch.sh). The account data itself (api.leongold.net) is never touched here: always live.
 */
class SiteCache {
  private final File dir;
  private final Context ctx;
  private final ExecutorService bg = Executors.newSingleThreadExecutor();
  private final Set<String> refreshing = Collections.synchronizedSet(new HashSet<>());

  SiteCache(Context c) { ctx = c; dir = new File(c.getCacheDir(), "site"); dir.mkdirs(); }

  static boolean cacheable(Uri u) {
    String h = u.getHost() == null ? "" : u.getHost(), p = u.getPath() == null ? "" : u.getPath();
    if (!"https".equals(u.getScheme())) return false;
    if (!(h.equals("leon-gold.github.io") || h.equals("leongold.net") || h.equals("www.leongold.net"))) return false;
    return !p.contains("/api/") && !p.endsWith("/sw.js") && !p.endsWith(".webmanifest") && !p.endsWith(".json");
  }
  private static boolean immutable(String path) { return path.contains("/_next/static/"); }
  private static boolean page(String path) { return path.endsWith("/") || path.endsWith(".html") || !path.substring(path.lastIndexOf('/') + 1).contains("."); }

  /** the key: the address without its query (?t=orders opens the same page) */
  private static String key(Uri u) { return u.getScheme() + "://" + u.getHost() + u.getPath(); }
  private File file(String k) {
    try {
      byte[] d = MessageDigest.getInstance("SHA-256").digest(k.getBytes("UTF-8"));
      StringBuilder s = new StringBuilder(); for (int i = 0; i < 16; i++) s.append(String.format("%02x", d[i]));
      return new File(dir, s.toString());
    } catch (Exception e) { throw new RuntimeException(e); }
  }

  WebResourceResponse get(WebResourceRequest r) {
    if (!"GET".equals(r.getMethod())) return null;
    Uri u = r.getUrl();
    if (!cacheable(u)) return null;
    String k = key(u), path = u.getPath() == null ? "/" : u.getPath();
    File f = file(k);
    if (f.exists()) {
      if (!immutable(path)) refreshLater(k, f);
      return serve(f);
    }
    // the copy shipped in the APK
    WebResourceResponse shipped = fromAssets(k, f);
    if (shipped != null) { if (!immutable(path)) refreshLater(k, f); return shipped; }
    // not on the phone yet: fetch now, keep it, show it
    if (fetch(k, f)) return serve(f);
    return null; // let the WebView try (its offline page appears on failure)
  }

  private void refreshLater(String k, File f) {
    if (!refreshing.add(k)) return;
    bg.execute(() -> { try { fetch(k, f); } finally { refreshing.remove(k); } });
  }

  /** download into f (type on the first line of a side file); false when it failed or was not a 200 */
  private boolean fetch(String k, File f) {
    HttpURLConnection h = null;
    try {
      h = (HttpURLConnection) new URL(k).openConnection();
      h.setConnectTimeout(15000); h.setReadTimeout(30000);
      if (h.getResponseCode() != 200) return false;
      String type = h.getContentType() == null ? "application/octet-stream" : h.getContentType();
      File tmp = new File(f.getPath() + ".part");
      try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
        byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n);
      }
      try (Writer w = new OutputStreamWriter(new FileOutputStream(f.getPath() + ".type"), "UTF-8")) { w.write(type); }
      return tmp.renameTo(f);
    } catch (Exception e) { return false; }
    finally { if (h != null) h.disconnect(); }
  }

  private WebResourceResponse fromAssets(String k, File f) {
    String rel = "site/" + k.replaceFirst("^https://", "");
    if (rel.endsWith("/")) rel += "index.html";
    try (InputStream in = ctx.getAssets().open(rel)) {
      File tmp = new File(f.getPath() + ".part");
      try (OutputStream out = new FileOutputStream(tmp)) { byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); }
      try (Writer w = new OutputStreamWriter(new FileOutputStream(f.getPath() + ".type"), "UTF-8")) { w.write(guess(rel)); }
      return tmp.renameTo(f) ? serve(f) : null;
    } catch (IOException e) { return null; }
  }

  private static String guess(String p) {
    if (p.endsWith(".html")) return "text/html; charset=utf-8";
    if (p.endsWith(".js")) return "application/javascript";
    if (p.endsWith(".css")) return "text/css";
    if (p.endsWith(".woff2")) return "font/woff2";
    if (p.endsWith(".webp")) return "image/webp";
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".svg")) return "image/svg+xml";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
    return "application/octet-stream";
  }

  private WebResourceResponse serve(File f) {
    try {
      String type = "application/octet-stream";
      File t = new File(f.getPath() + ".type");
      if (t.exists()) try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(t), "UTF-8"))) { String l = r.readLine(); if (l != null) type = l; }
      String mime = type.split(";")[0].trim(), enc = null;
      int i = type.toLowerCase().indexOf("charset=");
      if (i >= 0) enc = type.substring(i + 8).trim();
      else if (mime.startsWith("text/") || mime.contains("javascript")) enc = "utf-8";
      WebResourceResponse res = new WebResourceResponse(mime, enc, new FileInputStream(f));
      Map<String, String> hd = new HashMap<>(); hd.put("Cache-Control", "no-cache"); hd.put("Access-Control-Allow-Origin", "*");
      res.setResponseHeaders(hd);
      return res;
    } catch (Exception e) { return null; }
  }
}
