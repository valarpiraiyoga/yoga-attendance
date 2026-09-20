/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Student / Instructor forms submit a profile photo (up to 2 MB, see
    // lib/storage/profile-photo-rules.js) inside the Server Action's
    // multipart body. The 1 MB default would reject it; 3 MB leaves room for
    // the multipart overhead and the other form fields.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
