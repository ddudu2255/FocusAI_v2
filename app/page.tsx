import type { Metadata } from "next";
import { HomeView } from "@/components/home-view";

export const metadata: Metadata = {
  title: "홈",
};

export default function HomePage() {
  return <HomeView />;
}
