import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KB 우리 아이 자산관리",
  description:
    "부모가 KB스타뱅킹에서 자녀의 KB국민은행 예·적금과 KB증권 투자계좌를 통합 관리하는 프로토타입",
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
