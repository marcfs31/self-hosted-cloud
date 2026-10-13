import type { MetadataRoute } from "next";

// The manifest is static, so it cannot follow the visitor's language; the name is the same in all.
// The colours repeat --color-bg and --color-accent of globals.css (a manifest cannot use CSS).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cloud",
    short_name: "Cloud",
    description: "Your self-hosted cloud",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2457d6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: "files", accept: ["*/*"] }] },
    },
  };
}
