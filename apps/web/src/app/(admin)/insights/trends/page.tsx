import { TrendingUp } from "lucide-react";
import { ComingSoon } from "@/components/insights/coming-soon";

export default function TrendsPage() {
  return (
    <ComingSoon
      title="Trends"
      description="Spot topics your users ask about most and how they shift over time."
      icon={TrendingUp}
    />
  );
}
