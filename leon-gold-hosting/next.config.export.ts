// Copied over next.config.ts in the build copy of the site (build.sh renames the site's own file to
// next.config.site.ts). Keeps every setting of the site and only turns it into a static export at the
// domain root: the site at /, the panel at /panel/, «حساب من» at /hesab/; the ledger is added at /daftar/.
import type { NextConfig } from "next";
import site from "./next.config.site";

// partial prerendering cannot run in a static export
const { cacheComponents: _c, partialPrefetching: _p, ...rest } = site as NextConfig & { partialPrefetching?: boolean };

const nextConfig: NextConfig = {
  ...rest,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
