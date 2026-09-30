import type { MetadataRoute } from "next";

/** Thêm vào màn hình chính (Android/Chrome); iOS dùng apple-icon.png + appleWebApp.title trong layout */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The 12A Coffee",
    short_name: "12A Coffee",
    description: "Vote pha cà phê chung và quỹ cà phê nội bộ",
    start_url: "/",
    display: "standalone",
    background_color: "#f5eddd",
    theme_color: "#6f4428",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
