import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "KB 우리 아이 자산관리",
  description:
    "AI 포트폴리오 에이전트와 증여세·세금·수수료 규칙 엔진을 결합한 자녀 자산관리 프로토타입",
};

export default function Home() {
  return <Dashboard />;
}
