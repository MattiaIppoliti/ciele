import { FeedbackProvider } from "@agent-hub/ui/feedback";

/**
 * The embedded widget's own layout, and it exists for one reason: the two
 * chat cues (#817).
 *
 * The widget used to inherit only the root layout, which mounts no feedback
 * provider, and that was the whole mechanism keeping it silent on customer
 * sites. The product owner decided it should answer a Visitor after all, so
 * the provider is mounted here rather than moved up to the root: this segment
 * and this segment only, so the auth pages and anything else outside the two
 * route groups stay silent by the same construction as before.
 *
 * What sounds inside it is deliberately two moments, not the console's set:
 * the message going and the answer coming back. The composer, the launcher and
 * every button in the widget carry no feedback attributes, because a Visitor
 * on somebody else's page did not choose Ciele and the bar for making noise
 * there is higher than in a console someone signed into.
 */
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return <FeedbackProvider>{children}</FeedbackProvider>;
}
