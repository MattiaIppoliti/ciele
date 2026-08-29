import { FlowBuilderPage } from "../flow-builder-page";

export default async function EditFlowPage({
  params,
}: {
  params: Promise<{ id: string; flowId: string }>;
}) {
  const { id, flowId } = await params;
  return <FlowBuilderPage assistantId={id} flowId={flowId} />;
}
