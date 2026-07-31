import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KB 우리 아이 자산관리",
  description:
    "고정 샘플 자산과 금융 규칙을 바탕으로 AI가 KB금융그룹 중심 포트폴리오를 제안하는 프로토타입",
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
