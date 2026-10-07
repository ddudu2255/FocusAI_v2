import type { Metadata } from "next";
import { StatsView } from "@/components/stats-view";

export const metadata: Metadata = {
  title: "통계",
};

export default function StatsPage() {
  return <StatsView />;
}
