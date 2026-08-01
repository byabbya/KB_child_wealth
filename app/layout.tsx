import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KB 우리 아이 자산관리",
  description:
    "샘플 자산과 금융 기준을 바탕으로 AI가 KB금융그룹 중심 포트폴리오를 제안하는 자녀 자산관리 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
