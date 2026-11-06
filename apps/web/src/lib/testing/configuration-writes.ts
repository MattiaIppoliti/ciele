import ts from "typescript";
/** Visitor Conversations/messages/feedback/escalations and background-job state are
 * outside configuration audit scope. Personal profile and OAuth nonce state are
 * also excluded. Every exception below identifies one method on one surface. */
export const CONFIGURATION_WRITE_EXCEPTIONS: Record<string,string> = {
  "app/actions.ts#signOutAction.update": "Session sign-out marks operator presence Away; runtime presence is not configuration.",
  "app/actions.ts#createOrganizationAction.createOrganization": "Bootstrap creates its first membership, then explicitly records organization.create in the new Organization.",
  "app/actions.ts#updateProfileAction.updateProfile": "Personal profile, shared across Organizations, is not Organization configuration.",
  "app/actions.ts#uploadProfileAvatarAction.updateProfile": "Personal avatar belongs to the Member, not to an Organization.",
  "app/actions.ts#requeueIngest.updateSource": "Operational ingestion retry state; durable ingestion jobs keep their own ledger.",
  "app/actions.ts#reembedKnowledgeAction.deleteChunksByConcept": "Operational index rebuild; changes no authored knowledge or configuration.",
  "app/api/applications/oauth/[provider]/callback/route.ts#GET.consumeApplicationOAuthNonce": "One-use OAuth protocol replay protection, before the audited authorization operation.",
  "app/api/applications/oauth/[provider]/start/route.ts#beginOAuth.createApplicationOAuthNonce": "Expiring OAuth protocol nonce, not a saved Connection.",
  "app/api/chat/reactions/route.ts#POST.setMessageReaction": "Message reaction is conversation content, not configuration.",
  "app/api/cron/check-assistant-availability/route.ts#module.recordAssistantAvailability": "Background availability ledger.",
  "app/api/widget/[assistantId]/conversation-feedback/route.ts#POST.updateConversationMetadata": "Visitor-side Conversation feedback.",
  "app/api/widget/[assistantId]/feedback/route.ts#POST.setMessageFeedback": "Visitor-side message feedback.",
  "app/api/widget/[assistantId]/memories/route.ts#DELETE.deleteMemory": "Visitor removes their own conversational memory.",
};
export interface ConfigurationWrite { key: string; line: number; audited: boolean; exception?: string }
const mutation = /^(create|update|delete|remove|set|clear|save|requeue|enqueue|commit|append|upsert|apply|mark|revoke|grant|unlink|link|record|restore|claim|start|stop|cancel|accept|release|acquire|begin|finish|complete|open|close|consume|touch|reserve|settle|heartbeat|sweep|write|insert)/;
/** Source-only drift guard: runtime values and request inputs never enter it. */
export function configurationWrites(file: string,text: string): ConfigurationWrite[] {
  if (!text.includes('"use server"') && !text.includes("'use server'") && !file.endsWith("/route.ts")) return [];
  const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const records: ConfigurationWrite[] = [];
  const aliases = new Set<string>();
  function dbTarget(text: string) { return /\b(db|\w+Db)\b/.test(text) || aliases.has(text); }
  function visit(node: ts.Node,owner: string,audited: boolean) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer.getText(source);
      if (dbTarget(initializer) || /\b(getDb|getServiceDb|createDb|createOrgPinnedDb|getMockDb)\s*\(/.test(initializer)) aliases.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name) owner=node.name.text;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) owner=node.name.text;
    if (ts.isCallExpression(node)) {
      const name=node.expression.getText(source);
      if (name === "defineOperation") audited=true;
      if (name === "orgMutation") {
        const options=node.arguments[0];
        audited=Boolean(options && ts.isObjectLiteralExpression(options) && options.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source)==="operation"));
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method=node.expression.name.text;
        const target=node.expression.expression.getText(source);
        if (dbTarget(target) && mutation.test(method)) {
          const key=`${file}#${owner}.${method}`;
          records.push({ key,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,audited,exception:CONFIGURATION_WRITE_EXCEPTIONS[key] });
        }
      }
    }
    ts.forEachChild(node,child => visit(child,owner,audited));
  }
  visit(source,"module",false);
  return records;
}
