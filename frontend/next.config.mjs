/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || "http://localhost:5000";

const nextConfig = {
  // The browser only talks to this origin; /api and /uploads are forwarded to the Express API.
  // This keeps session cookies first-party and avoids CORS problems.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/uploads/:path*", destination: `${backend}/uploads/:path*` },
    ];
  },
  // *.localhost lets you try store subdomains such as demo.localhost:3000 during development.
  allowedDevOrigins: ["*.localhost"],
};

export default nextConfig;
