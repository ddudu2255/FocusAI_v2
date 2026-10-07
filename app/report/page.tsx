import type { Metadata } from "next";
import { ReportView } from "@/components/report-view";

export const metadata: Metadata = {
  title: "리포트",
};

export default function ReportPage() {
  return <ReportView />;
}
