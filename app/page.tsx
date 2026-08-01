import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "KB 우리 아이 자산관리",
  description:
    "AI 포트폴리오 분석과 증여세·세금·수수료 기준을 결합한 자녀 자산관리 서비스",
};

export default function Home() {
  return <Dashboard />;
}
