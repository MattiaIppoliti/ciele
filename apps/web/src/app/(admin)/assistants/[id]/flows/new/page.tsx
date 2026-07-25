import { FlowBuilderPage } from "../flow-builder-page";

export default async function NewFlowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FlowBuilderPage assistantId={id} flowId={null} />;
}
