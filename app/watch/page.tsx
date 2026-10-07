import type { Metadata } from "next";
import { WatchView } from "@/components/watch-view";

export const metadata: Metadata = {
  title: "개입",
};

export default function WatchPage() {
  return <WatchView />;
}
