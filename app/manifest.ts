import type { MetadataRoute } from 'next';

/** 홈 화면에 앱처럼 설치 (PWA) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '차오름학원',
    short_name: '차오름',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f6f9',
    theme_color: '#1c2b4a',
    lang: 'ko',
  };
}
