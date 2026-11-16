# Copies «حساب من»'s page and every build file it reaches (scripts, styles, fonts, its pictures) into assets/site/<host>/<path>,
# so the app's first start does not wait for GitHub Pages (SiteCache.java reads them). Run by build.sh; needs the network.
import re, sys, os, urllib.request, shutil
START = sys.argv[1]  # e.g. https://leon-gold.github.io/leon-gold-app/site/hesab/
OUT = "assets/site"
m = re.match(r"https://([^/]+)(/.*)", START); host, start_path = m.group(1), m.group(2)
base = re.match(r"(.*/)hesab/", start_path).group(1)   # the site's base path: "/" on leongold.net (was /leon-gold-app/site/)
shutil.rmtree(OUT, ignore_errors=True)
todo, seen, total = [start_path], set(), 0
REF = re.compile(r"""(?:"|'|\(|\s)((?:%s|/)?(?:_next/static/[\w./~-]+?\.(?:js|css|woff2?|ttf|webp|png|svg|jpg))|%s[\w./-]+?\.(?:webp|png|svg|jpg|woff2))(?=["')\s?#])""" % (re.escape(base), re.escape(base)))
while todo:
    p = todo.pop()
    if p in seen: continue
    seen.add(p)
    try: data = urllib.request.urlopen("https://" + host + p, timeout=60).read()
    except Exception as e: print("skip", p, e); continue
    rel = p + ("index.html" if p.endswith("/") else "")
    dest = os.path.join(OUT, host + rel); os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "wb").write(data); total += len(data)
    if rel.endswith((".html", ".js", ".css")):
        for r in REF.findall(data.decode("utf-8", "ignore")):
            if r.startswith("_next/"): r = base + r
            elif not r.startswith("/"): continue
            if r.startswith(base) and r not in seen: todo.append(r)
print("prefetched %d files, %.1f MB" % (len(seen), total / 1e6))
