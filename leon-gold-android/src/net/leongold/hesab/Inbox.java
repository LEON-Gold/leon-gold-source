package net.leongold.hesab;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.net.Uri;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Notifications without Google: the app registers with the party's «حساب من» session, then every ~15 min fetches its inbox. */
public class Inbox extends JobService {
  static final String API = "https://api.leongold.net", CH = "hesab";
  static final int JOB = 1;

  static SharedPreferences prefs(Context c) { return c.getSharedPreferences("inbox", MODE_PRIVATE); }

  /** the page's session token changed (sign in, sign out); runs off the UI thread */
  static synchronized void session(Context c, String token) {
    SharedPreferences p = prefs(c);
    String old = p.getString("token", ""), dev = p.getString("dev", "");
    if (token == null) token = "";
    if (token.equals(old)) return;
    if (dev.isEmpty()) { dev = UUID.randomUUID().toString(); p.edit().putString("dev", dev).apply(); }
    try {
      if (!old.isEmpty()) call("POST", "/api/portal/push/app/off", old, "{\"dev\":\"" + dev + "\"}");
    } catch (Exception e) { }
    if (token.isEmpty()) { p.edit().remove("token").remove("last").apply(); return; }
    try {
      JSONObject r = call("POST", "/api/portal/push/app", token, "{\"dev\":\"" + dev + "\"}");
      if (r != null && r.optBoolean("ok")) {
        p.edit().putString("token", token).putLong("last", r.optLong("last")).apply();
        schedule(c);
      }
    } catch (Exception e) { }
  }

  static void schedule(Context c) {
    JobScheduler js = c.getSystemService(JobScheduler.class);
    if (js.getPendingJob(JOB) != null) return;
    js.schedule(new JobInfo.Builder(JOB, new ComponentName(c, Inbox.class))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setPeriodic(15 * 60 * 1000L)
        .setPersisted(true).build());
  }

  static JSONObject call(String method, String path, String token, String body) throws Exception {
    HttpURLConnection h = (HttpURLConnection) new URL(API + path).openConnection();
    h.setConnectTimeout(15000); h.setReadTimeout(20000); h.setRequestMethod(method);
    h.setRequestProperty("Authorization", "Bearer " + token);
    if (body != null) {
      h.setDoOutput(true); h.setRequestProperty("Content-Type", "application/json");
      try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
    }
    int code = h.getResponseCode();
    if (code == 401) throw new SecurityException("signed out");
    if (code != 200) return null;
    try (InputStream in = h.getInputStream()) {
      ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[4096]; int n;
      while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
      return new JSONObject(b.toString("UTF-8"));
    } finally { h.disconnect(); }
  }

  /** fetch and show what came after the last shown message */
  static void poll(Context c) {
    SharedPreferences p = prefs(c);
    String token = p.getString("token", "");
    if (token.isEmpty()) return;
    try {
      JSONObject r = call("GET", "/api/portal/push/inbox?after=" + p.getLong("last", 0), token, null);
      if (r == null) return;
      JSONArray items = r.optJSONArray("items");
      for (int i = 0; items != null && i < items.length(); i++) show(c, items.getJSONObject(i));
      p.edit().putLong("last", r.optLong("last", p.getLong("last", 0))).apply();
    } catch (SecurityException e) {
      p.edit().remove("token").apply(); // the session ended: stop until the party signs in again
    } catch (Exception e) { }
  }

  static void channel(Context c) {
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    if (nm.getNotificationChannel(CH) == null) {
      NotificationChannel ch = new NotificationChannel(CH, "حساب من", NotificationManager.IMPORTANCE_DEFAULT);
      ch.setDescription("سفارش‌ها، ویترین و پیام‌های لئون گلد");
      nm.createNotificationChannel(ch);
    }
  }

  static void show(Context c, JSONObject m) {
    channel(c);
    int id = m.optInt("id");
    Intent open = new Intent(c, MainActivity.class).putExtra("url", m.optString("url")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new Notification.Builder(c, CH)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle(m.optString("title"))
        .setContentText(m.optString("body"))
        .setStyle(new Notification.BigTextStyle().bigText(m.optString("body")))
        .setContentIntent(pi).setAutoCancel(true).build();
    c.getSystemService(NotificationManager.class).notify(id, n);
  }

  @Override public boolean onStartJob(JobParameters params) {
    new Thread(() -> { poll(this); jobFinished(params, false); }).start();
    return true;
  }
  @Override public boolean onStopJob(JobParameters params) { return true; }
}
