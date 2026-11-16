package net.leongold.hesab;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;

/** «حساب من» panel in a full-screen WebView: login stays (cookies/localStorage), photo upload works, other links open outside. */
public class MainActivity extends Activity {
  private static final int PICK = 1;
  private WebView web;
  private SiteCache cache;
  private final long born = android.os.SystemClock.elapsedRealtime();
  private LinearLayout offline;
  private ValueCallback<Uri[]> pending;
  private String home;
  // the site's «add to home screen» sheet makes no sense inside the app: mark it put off and close it if it shows
  // hands the «حساب من» session to the app (for its notifications) whenever it changes; the page has no other way in
  private static final String WATCH_SESSION = "(function(){if(window.__lgw)return;window.__lgw=1;var l=null;function f(){var t='';"
      + "try{t=localStorage.getItem('leon-hesab')||''}catch(e){}if(t!==l){l=t;try{LeonApp.session(t)}catch(e){}}}f();setInterval(f,3000);})()";
  private volatile boolean pageOurs = false;
  /** our own pages: https on leongold.net or the GitHub Pages copy (the one place the test build changes) */
  static boolean ours(Uri u) {
    String h = u.getHost() == null ? "" : u.getHost();
    return "https".equals(u.getScheme()) && (h.equals("leongold.net") || h.endsWith(".leongold.net") || h.equals("leon-gold.github.io"));
  }
  private static final String NO_HOME_HINT = "(function(){try{sessionStorage.setItem('hs-a2hs-later','1')}catch(e){}"
      + "var n=0,t=setInterval(function(){var b=document.querySelector('.hs-a2hs-later');if(b){b.click();}if(++n>40)clearInterval(t);},150);})()";

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    home = getString(R.string.start_url);
    FrameLayout root = new FrameLayout(this);
    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#0c1d15"));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(true);
    s.setAllowFileAccess(false);
    s.setSafeBrowsingEnabled(true);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    WebView.setWebContentsDebuggingEnabled(false);
    // marks the app so the site can tell it apart from a browser (e.g. skip «add to home screen»)
    s.setUserAgentString(s.getUserAgentString() + " LeonGoldApp/1.0");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

    cache = new SiteCache(this);
    web.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        WebResourceResponse x = cache.get(r);
        return x != null ? x : super.shouldInterceptRequest(v, r);
      }
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (ours(u)) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
        return true; // tel:, whatsapp, telegram, maps, other sites
      }
      @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        if (r.isForMainFrame()) offline.setVisibility(View.VISIBLE);
      }
      @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap f) {
        pageOurs = ours(Uri.parse(url));
      }
      @Override public void onPageFinished(WebView v, String url) {
        CookieManager.getInstance().flush();
        android.util.Log.i("LeonGold", "page ready in " + (android.os.SystemClock.elapsedRealtime() - born) + " ms");
        v.evaluateJavascript(NO_HOME_HINT, null);
        v.evaluateJavascript(WATCH_SESSION, null);
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        if (pending != null) pending.onReceiveValue(null);
        pending = cb;
        try { startActivityForResult(p.createIntent(), PICK); }
        catch (Exception e) { pending = null; return false; }
        return true;
      }
    });

    offline = new LinearLayout(this);
    offline.setOrientation(LinearLayout.VERTICAL);
    offline.setGravity(Gravity.CENTER);
    offline.setBackgroundColor(Color.parseColor("#0c1d15"));
    TextView t = new TextView(this);
    t.setText(R.string.offline); t.setTextColor(Color.parseColor("#e8d9b0")); t.setTextSize(17);
    t.setGravity(Gravity.CENTER); t.setPadding(48, 0, 48, 32);
    Button retry = new Button(this);
    retry.setText(R.string.retry);
    retry.setOnClickListener(x -> { offline.setVisibility(View.GONE); web.reload(); });
    android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
    g.setColor(Color.parseColor("#d8b46a")); g.setCornerRadius(80);
    retry.setBackground(g); retry.setTextColor(Color.parseColor("#1a140a")); retry.setAllCaps(false); retry.setTextSize(16);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    retry.setPadding(96, 24, 96, 24);
    offline.addView(t); offline.addView(retry, lp);
    offline.setVisibility(View.GONE);

    web.addJavascriptInterface(new Object() {
      @JavascriptInterface public void session(String token) {
        if (!pageOurs) return; // only our own pages may hand over a session
        final String t = token == null ? "" : token.trim();
        if (t.length() > 200) return;
        new Thread(() -> Inbox.session(getApplicationContext(), t)).start();
      }
    }, "LeonApp");
    if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[]{ android.Manifest.permission.POST_NOTIFICATIONS }, 2);
    Inbox.channel(this);

    root.addView(web); root.addView(offline);
    root.setBackgroundColor(Color.parseColor("#0c1d15"));
    // Android 15 draws apps under the status and navigation bars: keep the page clear of them (and of the keyboard)
    root.setOnApplyWindowInsetsListener((v, in) -> {
      if (android.os.Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
        v.setPadding(i.left, i.top, i.right, i.bottom);
      } else v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(), in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
      return WindowInsets.CONSUMED;
    });
    setContentView(root);
    if (b != null) web.restoreState(b); else web.loadUrl(fromNotice(getIntent()));
  }

  // a tapped notification opens its own section, only on our own site
  private String fromNotice(Intent i) {
    String u = i == null ? null : i.getStringExtra("url");
    if (u == null) return home;
    // always the app's own address (its session lives there), with only the section the message points to
    String t = Uri.parse(u).getQueryParameter("t");
    return t != null && t.matches("[a-z]{1,20}") ? home + "?t=" + t : home;
  }
  @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); if (i.getStringExtra("url") != null) web.loadUrl(fromNotice(i)); }

  @Override protected void onActivityResult(int req, int res, Intent data) {
    if (req == PICK && pending != null) {
      pending.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
      pending = null;
    } else super.onActivityResult(req, res, data);
  }

  @Override public void onBackPressed() {
    if (offline.getVisibility() == View.VISIBLE) offline.setVisibility(View.GONE);
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }

  @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
  @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
