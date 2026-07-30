import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "KB 우리 아이 자산관리",
  description:
    "KB스타뱅킹에서 자녀의 KB국민은행·KB증권 자산을 함께 관리하는 공모전 데모",
};

export default function Home() {
  return <Dashboard />;
}
