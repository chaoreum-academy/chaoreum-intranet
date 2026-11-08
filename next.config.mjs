/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '5mb' } }, // 학생명단 붙여넣기 · 시험지 파일(4MB까지, Vercel 요청 한도 4.5MB)
};
export default nextConfig;
