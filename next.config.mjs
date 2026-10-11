/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: hasil build ada di folder `out/`.
  // Data diambil di sisi client (dummy localStorage sekarang, Supabase nanti),
  // jadi tetap bisa di-deploy ke Cloudflare Workers/Pages, Vercel, maupun Netlify.
  output: "export",

  images: {
    unoptimized: true,
  },

  // /login -> /login/index.html : aman untuk semua static host.
  trailingSlash: true,
};

export default nextConfig;
