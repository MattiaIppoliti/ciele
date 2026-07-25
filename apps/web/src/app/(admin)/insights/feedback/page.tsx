import { MessageSquareText } from "lucide-react";
import { ComingSoon } from "@/components/insights/coming-soon";

export default function FeedbackGradingPage() {
  return (
    <ComingSoon
      title="Feedback & grading"
      description="Review rated answers and grade AI responses to improve your assistants."
      icon={MessageSquareText}
    />
  );
}
